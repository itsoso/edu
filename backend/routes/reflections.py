"""Reflections — 她的声音. 主观表达的持久层.

⚠️⚠️⚠️ 这个模块永远不能 import llm 或 llm_audit.
⚠️⚠️⚠️ reflections 表的任何内容永远不能进入任何 LLM prompt.
⚠️⚠️⚠️ 违反这条规则就破坏了整个阶段 2 的设计意图.

设计见 改进计划 阶段 2:
- 一旦 AI 开始分析主观表达, 她会为了被 AI 理解而写, 不是为了她自己
- 这是她和自己的对话, 不是给系统分析的素材

Kinds:
- mistake_note:  related_id = mistake.id (一题一条, upsert)
- exam_feeling:  related_id = exam.id    (一考一条, upsert)
- weekly_note:   related_key = 周一日期 YYYY-MM-DD (一周一条, upsert)
- free_write:    不绑定, 时间流展示
"""
from flask import Blueprint, jsonify, request, abort, g

from db import db, row_to_dict, rows_to_dicts
from auth import login_required

bp = Blueprint("reflections", __name__)

VALID_KINDS = {"mistake_note", "exam_feeling", "weekly_note", "free_write"}


@bp.get("/api/reflections")
@login_required
def list_reflections():
    """
    查询参数:
      kind:        (可选) 过滤 kind
      related_id:  (可选) 过滤绑定的业务 id
      related_key: (可选) 过滤绑定的业务 key
      limit / offset: 分页, 默认 50 / 0

    响应: reflection 数组, 按 created_at DESC
    """
    kind = request.args.get("kind")
    related_id = request.args.get("related_id", type=int)
    related_key = request.args.get("related_key")
    try:
        limit = max(1, min(int(request.args.get("limit", 50)), 200))
        offset = max(0, int(request.args.get("offset", 0)))
    except ValueError:
        limit, offset = 50, 0

    if kind and kind not in VALID_KINDS:
        return jsonify({"error": "invalid_kind"}), 400

    clauses = ["owner_user_id = ?"]
    args: list = [g.owner_id]
    if kind:
        clauses.append("kind = ?")
        args.append(kind)
    if related_id is not None:
        clauses.append("related_id = ?")
        args.append(related_id)
    if related_key:
        clauses.append("related_key = ?")
        args.append(related_key)
    where = " AND ".join(clauses)

    with db() as conn:
        rows = conn.execute(
            f"SELECT * FROM reflections WHERE {where} "
            "ORDER BY created_at DESC LIMIT ? OFFSET ?",
            args + [limit, offset],
        ).fetchall()
    return jsonify(rows_to_dicts(rows))


@bp.post("/api/reflections")
@login_required
def upsert_reflection():
    """
    创建或更新一条反思.

    对于 mistake_note / exam_feeling / weekly_note,
    如果已有同 (owner, kind, related_id/key) 的条目, 执行更新.
    free_write 始终插入新条目.

    请求体:
    {
      "kind": "...",
      "related_id": 123,        // 可选
      "related_key": "2026-04-06",  // 可选
      "content": "..."
    }
    """
    payload = request.get_json(force=True) or {}
    kind = payload.get("kind")
    content = (payload.get("content") or "").strip()

    if kind not in VALID_KINDS:
        return jsonify({"error": "invalid_kind"}), 400
    if not content:
        return jsonify({"error": "empty_content"}), 400
    if len(content) > 2000:
        return jsonify({"error": "content_too_long"}), 400

    related_id = payload.get("related_id")
    related_key = payload.get("related_key")

    with db() as conn:
        # 对于需要唯一性的 kind, 先查再 upsert
        if kind in ("mistake_note", "exam_feeling", "weekly_note"):
            if related_id is not None:
                existing = conn.execute(
                    """SELECT id FROM reflections
                       WHERE owner_user_id = ? AND kind = ? AND related_id = ?""",
                    (g.owner_id, kind, related_id),
                ).fetchone()
            elif related_key:
                existing = conn.execute(
                    """SELECT id FROM reflections
                       WHERE owner_user_id = ? AND kind = ? AND related_key = ?""",
                    (g.owner_id, kind, related_key),
                ).fetchone()
            else:
                return jsonify({"error": "related_id_or_key_required"}), 400

            if existing:
                conn.execute(
                    """UPDATE reflections
                       SET content = ?, updated_at = CURRENT_TIMESTAMP
                       WHERE id = ?""",
                    (content, existing["id"]),
                )
                row = conn.execute(
                    "SELECT * FROM reflections WHERE id = ?", (existing["id"],)
                ).fetchone()
                return jsonify(row_to_dict(row))

        # free_write 或者 upsert 的 insert 分支
        cur = conn.execute(
            """INSERT INTO reflections
               (owner_user_id, kind, related_id, related_key, content)
               VALUES (?, ?, ?, ?, ?)""",
            (g.owner_id, kind, related_id, related_key, content),
        )
        row = conn.execute(
            "SELECT * FROM reflections WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
    return jsonify(row_to_dict(row)), 201


@bp.delete("/api/reflections/<int:ref_id>")
@login_required
def delete_reflection(ref_id):
    with db() as conn:
        row = conn.execute(
            "SELECT owner_user_id FROM reflections WHERE id = ?", (ref_id,)
        ).fetchone()
        if not row:
            abort(404)
        if row["owner_user_id"] != g.owner_id:
            abort(403)
        conn.execute("DELETE FROM reflections WHERE id = ?", (ref_id,))
    return {"ok": True}


@bp.get("/api/reflections/stats")
@login_required
def reflections_stats():
    """简单统计: 按 kind 聚合. 用于 Dashboard / Settings 显示 "你已经写了 X 字"."""
    with db() as conn:
        rows = conn.execute(
            """SELECT kind,
                      COUNT(*) AS count,
                      COALESCE(SUM(LENGTH(content)), 0) AS total_chars
               FROM reflections
               WHERE owner_user_id = ?
               GROUP BY kind""",
            (g.owner_id,),
        ).fetchall()
    return jsonify(rows_to_dicts(rows))
