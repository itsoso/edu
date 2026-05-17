"""Agent API (P2 Tutor + 后续 agents 共用)."""
import json
import logging
from datetime import date

from flask import Blueprint, jsonify, request, g

from auth import login_required
from db import db, rows_to_dicts
from agent_tutor import (
    maybe_generate_for_user,
    _get_active_suggestion,
    _row_to_suggestion,
)

bp = Blueprint("agent", __name__)
log = logging.getLogger(__name__)


def _build_next_mistake_action(conn, owner_id: int):
    row = conn.execute(
        """SELECT
               m.id,
               m.subject,
               m.reason,
               m.knowledge_point,
               COALESCE(kp.repeat_count, 0) AS repeat_count
           FROM mistakes m
           LEFT JOIN (
             SELECT knowledge_point, COUNT(*) AS repeat_count
             FROM mistakes
             WHERE owner_user_id = ?
               AND mastered = 0
               AND knowledge_point IS NOT NULL
               AND TRIM(knowledge_point) != ''
             GROUP BY knowledge_point
           ) kp ON kp.knowledge_point = m.knowledge_point
           WHERE m.owner_user_id = ? AND m.mastered = 0
           ORDER BY
             CASE WHEN COALESCE(kp.repeat_count, 0) > 1 THEN 1 ELSE 0 END DESC,
             COALESCE(kp.repeat_count, 0) DESC,
             datetime(m.created_at) DESC,
             m.id DESC
           LIMIT 1""",
        (owner_id, owner_id),
    ).fetchone()
    if not row:
        return None

    topic = row["knowledge_point"] or row["reason"] or "这道题"
    return {
        "kind": "mistake",
        "title": "先补这道错题",
        "description": f"{row['subject']} · {topic}",
        "cta_label": "去错题本",
        "cta_path": "/mistakes",
        "subject": row["subject"],
        "knowledge_point": row["knowledge_point"],
        "source_mistake_id": row["id"],
    }


def _build_next_practice_action(conn, owner_id: int):
    row = conn.execute(
        """SELECT
               ps.id,
               ps.title,
               ps.subject,
               ps.knowledge_point,
               COUNT(pi.id) AS item_count,
               SUM(CASE WHEN pi.is_correct IS NOT NULL THEN 1 ELSE 0 END) AS graded_count,
               SUM(CASE WHEN pi.is_correct = 1 THEN 1 ELSE 0 END) AS correct_count,
               SUM(CASE WHEN pi.is_correct = 0 THEN 1 ELSE 0 END) AS wrong_count,
               AVG(CASE WHEN pi.score IS NOT NULL THEN pi.score END) AS avg_score
           FROM practice_sets ps
           JOIN practice_items pi ON pi.set_id = ps.id
           WHERE ps.owner_user_id = ?
             AND ps.status = 'done'
           GROUP BY ps.id, ps.title, ps.subject, ps.knowledge_point, ps.created_at
           HAVING graded_count < item_count OR correct_count < item_count
           ORDER BY
             COALESCE(wrong_count, 0) DESC,
             COALESCE(avg_score, 101) ASC,
             (item_count - graded_count) DESC,
             datetime(ps.created_at) DESC,
             ps.id DESC
           LIMIT 1""",
        (owner_id,),
    ).fetchone()
    if not row:
        return None

    remaining = max((row["item_count"] or 0) - (row["graded_count"] or 0), 0)
    wrong = max((row["graded_count"] or 0) - (row["correct_count"] or 0), 0)
    if remaining > 0 and wrong > 0:
        detail = f"还有 {remaining} 题没做，{wrong} 题要重练"
    elif remaining > 0:
        detail = f"还有 {remaining} 题没做"
    elif wrong > 0:
        detail = f"还有 {wrong} 题做错了，先补一下"
    else:
        detail = "这组训练还没完全稳住"

    return {
        "kind": "practice",
        "title": "先把这组训练做完",
        "description": f"{row['title']} · {detail}",
        "cta_label": "继续训练",
        "cta_path": f"/practice?set={row['id']}",
        "subject": row["subject"],
        "knowledge_point": row["knowledge_point"],
        "practice_set_id": row["id"],
    }


def _build_next_task_action(conn, owner_id: int):
    today = date.today()
    today_str = today.isoformat()
    today_dow = today.isoweekday()

    row = conn.execute(
        """SELECT t.id, t.subject, t.title, t.description, t.minutes
           FROM tasks t
           LEFT JOIN checkins c
             ON c.task_id = t.id
            AND c.checkin_date = ?
            AND c.completed = 1
           WHERE t.owner_user_id = ?
             AND t.day_of_week = ?
             AND c.id IS NULL
           ORDER BY t.week, t.id
           LIMIT 1""",
        (today_str, owner_id, today_dow),
    ).fetchone()
    if not row:
        return None

    minutes = row["minutes"] or 15
    return {
        "kind": "task",
        "title": row["title"] or "完成今天任务",
        "description": f"{row['subject'] or '今日任务'} · 先做 {minutes} 分钟",
        "cta_label": "去完成",
        "cta_path": "/assignments",
        "subject": row["subject"],
        "task_id": row["id"],
    }


@bp.get("/api/agent/next-action")
@login_required
def get_next_action():
    with db() as conn:
        action = (
            _build_next_mistake_action(conn, g.owner_id)
            or _build_next_practice_action(conn, g.owner_id)
            or _build_next_task_action(conn, g.owner_id)
        )
    if not action:
        return jsonify({"exists": False})
    return jsonify({"exists": True, "action": action})


@bp.get("/api/agent/suggestion/today")
@login_required
def get_today_suggestion():
    """读当前 active 建议. 如果没有, 不自动触发生成 (cron 负责)."""
    with db() as conn:
        s = _get_active_suggestion(conn, g.owner_id)
    if not s:
        return jsonify({"exists": False})
    return jsonify({"exists": True, "suggestion": s})


@bp.post("/api/agent/suggestion/refresh")
@login_required
def refresh_suggestion():
    """主动触发一次 — 让用户能手动 "再来一条"."""
    # 先把现有的 mark expired (用户主动放弃)
    with db() as conn:
        existing = _get_active_suggestion(conn, g.owner_id)
        if existing:
            conn.execute("""
                UPDATE agent_actions
                SET user_response = 'expired',
                    response_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (existing["id"],))
    result = maybe_generate_for_user(g.owner_id, force=True)
    return jsonify(result)


@bp.post("/api/agent/suggestion/<int:action_id>/accept")
@login_required
def accept_suggestion(action_id: int):
    """记 user_response='accepted' + 执行 action.

    返回 { ok, action_result } — frontend 据此跳转或刷新.
    """
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM agent_actions WHERE id = ?", (action_id,),
        ).fetchone()
        if not row:
            return jsonify({"error": "not_found"}), 404
        if row["owner_user_id"] != g.owner_id:
            return jsonify({"error": "forbidden"}), 403
        if row["user_response"] is not None:
            return jsonify({"error": "already_responded", "current": row["user_response"]}), 400

        try:
            payload = json.loads(row["payload_json"] or "{}")
        except json.JSONDecodeError:
            payload = {}
        accept_action = payload.get("accept_action") or {}

        # 标 accepted (无论 action 执行成功与否, accepting 这个意图记下来)
        conn.execute("""
            UPDATE agent_actions
            SET user_response = 'accepted', response_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (action_id,))

    # 执行 action (已脱离 db context, accept 的事务先落地)
    action_result = _execute_action(g.owner_id, accept_action)
    return jsonify({"ok": True, "action": accept_action, "result": action_result})


@bp.post("/api/agent/suggestion/<int:action_id>/dismiss")
@login_required
def dismiss_suggestion(action_id: int):
    """记 user_response='dismissed' + 可选 reason."""
    body = request.get_json(silent=True) or {}
    reason = (body.get("reason") or "").strip()[:200]

    with db() as conn:
        row = conn.execute(
            "SELECT owner_user_id, user_response FROM agent_actions WHERE id = ?", (action_id,),
        ).fetchone()
        if not row:
            return jsonify({"error": "not_found"}), 404
        if row["owner_user_id"] != g.owner_id:
            return jsonify({"error": "forbidden"}), 403
        if row["user_response"] is not None:
            return jsonify({"error": "already_responded"}), 400

        # reason 存到 rationale 后追加 (rationale 字段就用来存 audit 信息)
        conn.execute("""
            UPDATE agent_actions
            SET user_response = 'dismissed', response_at = CURRENT_TIMESTAMP,
                rationale = COALESCE(rationale, '') || ?
            WHERE id = ?
        """, (f"\n[dismissed reason] {reason}" if reason else "", action_id))
    return jsonify({"ok": True})


@bp.post("/api/agent/snooze")
@login_required
def snooze_agent():
    """暂停 agent N 天. body: { days: 7 } 0=取消暂停."""
    body = request.get_json(silent=True) or {}
    days = body.get("days", 7)
    try:
        days = int(days)
    except (TypeError, ValueError):
        return jsonify({"error": "invalid_days"}), 400
    if days < 0 or days > 90:
        return jsonify({"error": "out_of_range"}), 400

    import datetime as dt
    if days == 0:
        until = None
    else:
        until = (dt.date.today() + dt.timedelta(days=days)).isoformat()

    with db() as conn:
        existing = conn.execute(
            "SELECT 1 FROM profile_settings WHERE owner_user_id = ?", (g.owner_id,),
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE profile_settings SET agent_snoozed_until = ?, updated_at = CURRENT_TIMESTAMP "
                "WHERE owner_user_id = ?",
                (until, g.owner_id),
            )
        else:
            conn.execute(
                "INSERT INTO profile_settings (owner_user_id, agent_snoozed_until) VALUES (?, ?)",
                (g.owner_id, until),
            )
    return jsonify({"ok": True, "snoozed_until": until})


@bp.get("/api/agent/actions")
@login_required
def list_my_agent_actions():
    """查自己的 agent action 历史 (audit). 限 100 条."""
    with db() as conn:
        rows = conn.execute("""
            SELECT id, agent_name, action_type, suggestion_id, payload_json,
                   rationale, user_response, response_at, created_at
            FROM agent_actions
            WHERE owner_user_id = ?
            ORDER BY created_at DESC
            LIMIT 100
        """, (g.owner_id,)).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        try:
            payload = json.loads(d.pop("payload_json") or "{}")
            d["kind"] = payload.get("kind")
            d["wording"] = payload.get("wording")
            d["evidence_refs"] = payload.get("evidence_refs")
            d["accept_action"] = payload.get("accept_action")
        except json.JSONDecodeError:
            pass
        out.append(d)
    return jsonify(out)


# ============================================================
# 内部: 执行 accept_action
# ============================================================

def _execute_action(user_id: int, action: dict) -> dict:
    """根据 accept_action 类型执行. 返回结果 (frontend 用来导航)."""
    typ = action.get("type")
    if typ == "generate_practice":
        from routes.practice import _create_practice_set_for_mistake
        mid = action.get("source_mistake_id")
        count = action.get("count", 3)
        if not mid:
            return {"error": "no_source_mistake"}
        try:
            set_id = _create_practice_set_for_mistake(user_id, mid, count)
            if set_id is None:
                return {"error": "mistake_not_found"}
            return {"practice_set_id": set_id, "navigate_to": "Practice"}
        except Exception as e:
            log.warning("execute generate_practice failed: %s", e)
            return {"error": str(e)}
    if typ == "navigate":
        return {
            "navigate_to": action.get("navigate_to"),
            "filter": action.get("filter"),
        }
    if typ == "acknowledge":
        return {"ok": True}
    return {"error": "unknown_action_type"}
