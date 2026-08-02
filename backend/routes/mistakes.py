"""Mistakes (错题本)."""
import json
import logging
import uuid

from flask import Blueprint, jsonify, request, abort, g
from werkzeug.utils import secure_filename

from db import db, rows_to_dicts
from auth import login_required
from llm import get_llm, LLMError, SCAN_SOLVE_PROMPT, parse_json_or_retry
from llm_audit import llm_audit
from background import submit as bg_submit
from constants import UPLOAD_DIR, ALLOWED_IMAGE_EXT, MAX_UPLOAD_BYTES

logger = logging.getLogger(__name__)
bp = Blueprint("mistakes", __name__)


@bp.get("/api/mistakes")
@login_required
def list_mistakes():
    """
    Query params:
    - subject / mastered: 过滤
    - limit: 默认 50, 最多 200
    - offset: 默认 0

    响应向后兼容: 仍然返回一个数组, 额外通过响应头 X-Total-Count 给总数.
    (前端老代码直接用数组也不会崩, 新代码可读头加"加载更多".)
    """
    subject = request.args.get("subject")
    mastered = request.args.get("mastered")

    try:
        limit = max(1, min(int(request.args.get("limit", 50)), 200))
        offset = max(0, int(request.args.get("offset", 0)))
    except ValueError:
        limit, offset = 50, 0

    where = ["owner_user_id = ?"]
    args: list = [g.owner_id]
    if subject:
        where.append("subject = ?")
        args.append(subject)
    if mastered is not None:
        where.append("mastered = ?")
        args.append(int(mastered))
    where_sql = " AND ".join(where)

    with db() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) FROM mistakes WHERE {where_sql}", args
        ).fetchone()[0]
        rows = conn.execute(
            f"SELECT * FROM mistakes WHERE {where_sql} "
            "ORDER BY created_at DESC LIMIT ? OFFSET ?",
            args + [limit, offset],
        ).fetchall()

    resp = jsonify(rows_to_dicts(rows))
    resp.headers["X-Total-Count"] = str(total)
    resp.headers["Access-Control-Expose-Headers"] = "X-Total-Count"
    return resp


@bp.post("/api/mistakes")
@login_required
def create_mistake():
    payload = request.get_json(force=True) or {}
    if not payload.get("subject") or not payload.get("reason"):
        abort(400, "subject and reason required")
    with db() as conn:
        cur = conn.execute(
            """INSERT INTO mistakes
               (owner_user_id, subject, exam_name, question_text, wrong_answer,
                correct_answer, reason, knowledge_point, solution_steps)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                g.owner_id,
                payload["subject"],
                payload.get("exam_name"),
                payload.get("question_text"),
                payload.get("wrong_answer"),
                payload.get("correct_answer"),
                payload["reason"],
                payload.get("knowledge_point"),
                payload.get("solution_steps"),
            ),
        )
    return jsonify({"id": cur.lastrowid}), 201


@bp.put("/api/mistakes/<int:mid>")
@login_required
def update_mistake(mid):
    payload = request.get_json(force=True) or {}
    with db() as conn:
        row = conn.execute(
            "SELECT owner_user_id FROM mistakes WHERE id = ?", (mid,)
        ).fetchone()
        if not row:
            abort(404)
        if row["owner_user_id"] != g.owner_id:
            abort(403)
        fields = []
        args = []
        for k in ("subject", "exam_name", "question_text", "wrong_answer",
                  "correct_answer", "reason", "knowledge_point", "solution_steps"):
            if k in payload:
                fields.append(f"{k} = ?")
                args.append(payload[k])
        if "mastered" in payload:
            mastered_val = 1 if payload["mastered"] else 0
            fields.append("mastered = ?")
            args.append(mastered_val)
            if mastered_val:
                fields.append("mastered_at = CURRENT_TIMESTAMP")
            else:
                fields.append("mastered_at = NULL")
        if fields:
            args.append(mid)
            conn.execute(f"UPDATE mistakes SET {', '.join(fields)} WHERE id = ?", args)
    return {"ok": True}


@bp.delete("/api/mistakes/<int:mid>")
@login_required
def delete_mistake(mid):
    with db() as conn:
        row = conn.execute(
            "SELECT owner_user_id FROM mistakes WHERE id = ?", (mid,)
        ).fetchone()
        if not row:
            abort(404)
        if row["owner_user_id"] != g.owner_id:
            abort(403)
        conn.execute("DELETE FROM mistakes WHERE id = ?", (mid,))
    return {"ok": True}


@bp.get("/api/mistakes/stats")
@login_required
def mistakes_stats():
    with db() as conn:
        by_reason = conn.execute(
            """SELECT reason, COUNT(*) AS n
               FROM mistakes WHERE owner_user_id = ?
               GROUP BY reason ORDER BY n DESC""",
            (g.owner_id,),
        ).fetchall()
        by_subject = conn.execute(
            """SELECT subject, COUNT(*) AS n,
                      SUM(CASE WHEN mastered = 1 THEN 1 ELSE 0 END) AS mastered_n
               FROM mistakes WHERE owner_user_id = ?
               GROUP BY subject ORDER BY n DESC""",
            (g.owner_id,),
        ).fetchall()
    return jsonify({
        "by_reason": rows_to_dicts(by_reason),
        "by_subject": rows_to_dicts(by_subject),
    })


@bp.get("/api/mistakes/knowledge-graph")
@login_required
def knowledge_graph():
    """知识点掌握度图谱.

    返回每个知识点的: 错题总数 / 已掌握数 / 关联训练完成率.
    用于 echarts 树状图 / 热力图渲染.
    """
    with db() as conn:
        # 按 (subject, knowledge_point) 聚合
        rows = conn.execute(
            """SELECT subject, knowledge_point,
                      COUNT(*) AS total,
                      SUM(CASE WHEN mastered = 1 THEN 1 ELSE 0 END) AS mastered_n,
                      MAX(created_at) AS last_seen
               FROM mistakes
               WHERE owner_user_id = ?
                 AND knowledge_point IS NOT NULL
                 AND knowledge_point != ''
               GROUP BY subject, knowledge_point
               ORDER BY subject, total DESC""",
            (g.owner_id,),
        ).fetchall()

    nodes = []
    for r in rows:
        total = r["total"] or 0
        mastered = r["mastered_n"] or 0
        # 掌握率 0~1; 0 = 全不会, 1 = 全掌握
        mastery = mastered / total if total else 0
        nodes.append({
            "subject": r["subject"],
            "knowledge_point": r["knowledge_point"],
            "total": total,
            "mastered": mastered,
            "mastery": round(mastery, 2),
            "last_seen": r["last_seen"],
            # 0 = 红 (薄弱), 0.5 = 黄, 1 = 绿 (掌握)
            "weakness_score": round(1 - mastery, 2),
        })
    return jsonify({"nodes": nodes})


# ---------- 拍照解题 ----------
def _set_scan_job_failed(job_id: str, code: str, message: str) -> None:
    with db() as conn:
        conn.execute(
            """UPDATE scan_solve_jobs
               SET status='failed', error_code=?, error_message=?,
                   updated_at=CURRENT_TIMESTAMP
               WHERE id=?""",
            (code, message[:500], job_id),
        )


def _run_scan_solve_bg(
    job_id: str,
    disk_path_str: str,
    owner_id: int,
    save_as_mistake: bool,
) -> None:
    """Run Vision/LLM work outside the request timeout and persist the outcome."""
    from pathlib import Path

    disk_path = Path(disk_path_str)
    try:
        llm = get_llm()
        with llm_audit("scan_solve", owner_id=owner_id, model=llm.model) as audit:
            audit.set_prompt_chars(len(SCAN_SOLVE_PROMPT))
            raw = llm.vision_chat(SCAN_SOLVE_PROMPT, [disk_path], max_tokens=2500)
            audit.set_response_chars(len(raw))
        data = parse_json_or_retry(llm, raw)

        if not isinstance(data, dict):
            _set_scan_job_failed(job_id, "bad_response", "模型返回格式不正确")
            return
        if data.get("error") or not data.get("question_text"):
            _set_scan_job_failed(
                job_id,
                "no_question_detected",
                str(data.get("error") or "未识别到题目"),
            )
            return

        result = {
            "question_text": data.get("question_text", ""),
            "subject": data.get("subject", "其他"),
            "knowledge_point": data.get("knowledge_point") or None,
            "difficulty": data.get("difficulty") or "medium",
            "answer": data.get("answer", ""),
            "solution_steps": data.get("solution_steps", ""),
            "common_mistakes": data.get("common_mistakes") or "",
        }

        with db() as conn:
            if save_as_mistake:
                cur = conn.execute(
                    """INSERT INTO mistakes
                       (owner_user_id, subject, exam_name, question_text,
                        correct_answer, reason, knowledge_point, solution_steps)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        owner_id,
                        result["subject"],
                        "拍照解题",
                        result["question_text"],
                        result["answer"],
                        result["common_mistakes"] or "拍照录入待复习",
                        result["knowledge_point"],
                        result["solution_steps"],
                    ),
                )
                result["mistake_id"] = cur.lastrowid
            conn.execute(
                """UPDATE scan_solve_jobs
                   SET status='done', result_json=?, error_code=NULL,
                       error_message=NULL, updated_at=CURRENT_TIMESTAMP
                   WHERE id=?""",
                (json.dumps(result, ensure_ascii=False), job_id),
            )
    except LLMError as exc:
        _set_scan_job_failed(job_id, "llm_error", str(exc))
    except Exception as exc:
        logger.exception("scan_solve background job failed")
        _set_scan_job_failed(job_id, "scan_failed", str(exc))
    finally:
        try:
            disk_path.unlink(missing_ok=True)
        except OSError:
            logger.warning("could not remove scan-solve upload: %s", disk_path)


@bp.post("/api/mistakes/scan-solve")
@login_required
def scan_solve():
    """Queue Vision OCR + LLM solving and return a polling job immediately.

    multipart/form-data:
      file: 图片
      save_as_mistake: '1' 保存; '0' 仅返回解析结果

    返回 (202): {job_id, status}; GET 同一路径/<job_id> 查询结果.
    """
    if "file" not in request.files:
        abort(400, "file required")
    f = request.files["file"]
    if not f.filename:
        abort(400, "empty filename")

    orig = secure_filename(f.filename) or "question"
    ext = orig.rsplit(".", 1)[-1].lower() if "." in orig else ""
    if ext not in ALLOWED_IMAGE_EXT:
        return jsonify({"error": f"unsupported image ext: .{ext}"}), 400

    user_dir = UPLOAD_DIR / str(g.owner_id) / "scan-solve"
    user_dir.mkdir(parents=True, exist_ok=True)
    uid = uuid.uuid4().hex[:12]
    disk_name = f"{uid}.{ext}"
    disk_path = user_dir / disk_name
    f.save(disk_path)

    if disk_path.stat().st_size > MAX_UPLOAD_BYTES:
        disk_path.unlink(missing_ok=True)
        return jsonify({"error": "file_too_large"}), 400

    save_as_mistake = request.form.get("save_as_mistake", "0") == "1"

    job_id = uuid.uuid4().hex
    with db() as conn:
        conn.execute(
            """INSERT INTO scan_solve_jobs
               (id, owner_user_id, file_path, save_as_mistake)
               VALUES (?, ?, ?, ?)""",
            (job_id, g.owner_id, str(disk_path), int(save_as_mistake)),
        )

    bg_submit(_run_scan_solve_bg, job_id, str(disk_path), g.owner_id, save_as_mistake)
    return jsonify({"job_id": job_id, "status": "processing"}), 202


@bp.get("/api/mistakes/scan-solve/<job_id>")
@login_required
def get_scan_solve_job(job_id: str):
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM scan_solve_jobs WHERE id=? AND owner_user_id=?",
            (job_id, g.owner_id),
        ).fetchone()
    if not row:
        abort(404)
    if row["status"] == "processing":
        return jsonify({"job_id": job_id, "status": "processing"}), 202
    if row["status"] == "failed":
        return jsonify({
            "job_id": job_id,
            "status": "failed",
            "error": row["error_code"] or "scan_failed",
            "detail": row["error_message"] or "拍照解题失败",
        })
    return jsonify({
        "job_id": job_id,
        "status": "done",
        "result": json.loads(row["result_json"] or "{}"),
    })
