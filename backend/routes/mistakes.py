"""Mistakes (错题本)."""
from flask import Blueprint, jsonify, request, abort, g

from db import db, rows_to_dicts
from auth import login_required

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
                correct_answer, reason, knowledge_point)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                g.owner_id,
                payload["subject"],
                payload.get("exam_name"),
                payload.get("question_text"),
                payload.get("wrong_answer"),
                payload.get("correct_answer"),
                payload["reason"],
                payload.get("knowledge_point"),
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
                  "correct_answer", "reason", "knowledge_point"):
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
