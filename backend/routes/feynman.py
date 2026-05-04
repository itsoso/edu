"""费曼模式 API (P3)."""
import json
import logging

from flask import Blueprint, jsonify, request, g

from auth import login_required
from constants import SUBJECTS
from db import db
from agent_feynman import start_session, add_turn, finish_session

bp = Blueprint("feynman", __name__)
log = logging.getLogger(__name__)

VALID_SOURCE_TABLES = {"mistakes", "practice_items", "manual"}
MAX_KP_LEN = 80
MAX_NOTE_LEN = 120


@bp.post("/api/feynman/start")
@login_required
def start():
    """body: { source_table?, source_id?, subject?, knowledge_point?, learned_from? }

    - 传 source_table='mistakes'|'practice_items' + source_id: drill-against-source 模式
    - 传 subject + knowledge_point (+ learned_from): 主动声明知识点, source_table 视为 'manual'
    - 全不传: 空 manual session (保留向后兼容)
    """
    body = request.get_json(silent=True) or {}
    source_table = body.get("source_table")
    source_id = body.get("source_id")
    subject = body.get("subject")
    knowledge_point = body.get("knowledge_point")
    learned_from = body.get("learned_from")

    # 主动声明: 收到 kp/subject 任一时, 统一走 manual 路径并强校验
    has_manual_input = bool(
        (subject is not None and str(subject).strip())
        or (knowledge_point is not None and str(knowledge_point).strip())
        or (learned_from is not None and str(learned_from).strip())
    )
    if has_manual_input:
        if source_table and source_table != "manual":
            return jsonify({"error": "manual_fields_require_manual_source"}), 400
        source_table = "manual"
        subj = (subject or "").strip()
        kp = (knowledge_point or "").strip()
        note = (learned_from or "").strip()
        if subj not in SUBJECTS:
            return jsonify({"error": "invalid_subject"}), 400
        if not kp:
            return jsonify({"error": "knowledge_point_required"}), 400
        if len(kp) > MAX_KP_LEN:
            return jsonify({"error": "knowledge_point_too_long"}), 400
        if len(note) > MAX_NOTE_LEN:
            return jsonify({"error": "learned_from_too_long"}), 400
        subject, knowledge_point, learned_from = subj, kp, (note or None)
    else:
        subject = knowledge_point = learned_from = None

    if source_table and source_table not in VALID_SOURCE_TABLES:
        return jsonify({"error": "invalid_source_table"}), 400
    if source_id is not None:
        try:
            source_id = int(source_id)
        except (TypeError, ValueError):
            return jsonify({"error": "invalid_source_id"}), 400

    result = start_session(
        g.owner_id, source_table, source_id,
        subject=subject,
        knowledge_point=knowledge_point,
        learned_from=learned_from,
    )
    return jsonify(result)


@bp.post("/api/feynman/<int:session_id>/turn")
@login_required
def turn(session_id: int):
    """body: { student_answer }"""
    body = request.get_json(silent=True) or {}
    answer = body.get("student_answer", "")
    result = add_turn(g.owner_id, session_id, answer)
    if "error" in result:
        return jsonify(result), 400 if result["error"] in ("empty_answer", "session_finished") else 404
    return jsonify(result)


@bp.post("/api/feynman/<int:session_id>/finish")
@login_required
def finish(session_id: int):
    """学生主动结束."""
    result = finish_session(g.owner_id, session_id, manual=True)
    if "error" in result:
        return jsonify(result), 404 if result["error"] == "not_found" else 400
    return jsonify(result)


@bp.get("/api/feynman/recent-kps")
@login_required
def recent_kps():
    """最近主动声明过的知识点 (manual session), 去重后按最近一次时间倒序.

    用于 FeynmanNew 表单上的 "最近讲过的" chips — 既能让学生快速重讲同一 kp,
    也避免同一 kp 因打字差异分裂 mastery (勾股定理 vs 毕氏定理).

    返回: [{subject, knowledge_point, session_count, last_spoken_at, last_understood}]
    last_understood = 最近一次 session 的 assessment.understood == 'understood'
    """
    try:
        limit = int(request.args.get("limit", 12))
    except (TypeError, ValueError):
        limit = 12
    limit = max(1, min(limit, 50))
    with db() as conn:
        rows = conn.execute("""
            SELECT manual_subject AS subject,
                   manual_knowledge_point AS kp,
                   COUNT(*) AS session_count,
                   MAX(COALESCE(finished_at, created_at)) AS last_spoken_at,
                   MAX(id) AS last_id
            FROM feynman_sessions
            WHERE owner_user_id = ?
              AND source_table = 'manual'
              AND manual_subject IS NOT NULL
              AND manual_knowledge_point IS NOT NULL
              AND manual_knowledge_point != ''
            GROUP BY manual_subject, manual_knowledge_point
            ORDER BY last_spoken_at DESC, last_id DESC
            LIMIT ?
        """, (g.owner_id, limit)).fetchall()

        out = []
        for r in rows:
            # 取这个 (subject, kp) 下最近一次 session 的 understood 标签
            latest = conn.execute("""
                SELECT ai_assessment_json
                FROM feynman_sessions
                WHERE owner_user_id = ?
                  AND source_table = 'manual'
                  AND manual_subject = ?
                  AND manual_knowledge_point = ?
                ORDER BY COALESCE(finished_at, created_at) DESC
                LIMIT 1
            """, (g.owner_id, r["subject"], r["kp"])).fetchone()
            last_understood = False
            if latest and latest["ai_assessment_json"]:
                try:
                    a = json.loads(latest["ai_assessment_json"])
                    last_understood = a.get("understood") == "understood"
                except json.JSONDecodeError:
                    pass
            out.append({
                "subject": r["subject"],
                "knowledge_point": r["kp"],
                "session_count": r["session_count"],
                "last_spoken_at": r["last_spoken_at"],
                "last_understood": last_understood,
            })
    return jsonify(out)


@bp.get("/api/feynman/sessions")
@login_required
def list_sessions():
    """历史 session 列表 (轻量, 不含 conversation)."""
    limit = max(1, min(int(request.args.get("limit", 30)), 100))
    with db() as conn:
        rows = conn.execute("""
            SELECT id, source_table, source_id, topic_seed, status, turn_count,
                   ai_assessment_json, created_at, finished_at,
                   manual_subject, manual_knowledge_point
            FROM feynman_sessions
            WHERE owner_user_id = ?
            ORDER BY created_at DESC
            LIMIT ?
        """, (g.owner_id, limit)).fetchall()
    out = []
    for r in rows:
        a = None
        try:
            a = json.loads(r["ai_assessment_json"]) if r["ai_assessment_json"] else None
        except json.JSONDecodeError:
            pass
        out.append({
            "id": r["id"],
            "source_table": r["source_table"],
            "source_id": r["source_id"],
            "topic_seed": r["topic_seed"],
            "status": r["status"],
            "turn_count": r["turn_count"],
            "assessment": a,
            "created_at": r["created_at"],
            "finished_at": r["finished_at"],
            "manual_subject": r["manual_subject"],
            "manual_knowledge_point": r["manual_knowledge_point"],
        })
    return jsonify(out)


@bp.get("/api/feynman/<int:session_id>")
@login_required
def get_session(session_id: int):
    """单个 session 完整数据 (含 conversation, 用于回看)."""
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM feynman_sessions WHERE id = ? AND owner_user_id = ?",
            (session_id, g.owner_id),
        ).fetchone()
    if not row:
        return jsonify({"error": "not_found"}), 404
    convo = []
    try:
        convo = json.loads(row["conversation_json"])
    except json.JSONDecodeError:
        pass
    assessment = None
    try:
        assessment = json.loads(row["ai_assessment_json"]) if row["ai_assessment_json"] else None
    except json.JSONDecodeError:
        pass
    return jsonify({
        "id": row["id"],
        "source_table": row["source_table"],
        "source_id": row["source_id"],
        "topic_seed": row["topic_seed"],
        "status": row["status"],
        "turn_count": row["turn_count"],
        "conversation": convo,
        "assessment": assessment,
        "created_at": row["created_at"],
        "finished_at": row["finished_at"],
        "manual_subject": row["manual_subject"],
        "manual_knowledge_point": row["manual_knowledge_point"],
    })


@bp.delete("/api/feynman/<int:session_id>")
@login_required
def delete_session(session_id: int):
    """删除一个 session (包括 conversation)."""
    with db() as conn:
        row = conn.execute(
            "SELECT owner_user_id FROM feynman_sessions WHERE id = ?", (session_id,),
        ).fetchone()
        if not row:
            return jsonify({"error": "not_found"}), 404
        if row["owner_user_id"] != g.owner_id:
            return jsonify({"error": "forbidden"}), 403
        conn.execute("DELETE FROM feynman_sessions WHERE id = ?", (session_id,))
    return jsonify({"ok": True})
