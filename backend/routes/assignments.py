"""家长布置任务 / 学生待办.

模型理解:
- 一条 assignment 表示一个待完成的事 (做作文/做练习/读一章书).
- 由家长(parent)布置给绑定的孩子, 或学生自己给自己加 (self-assigned).
- 学生看到是"我的待办"; 家长看到是"我布置的".

权限边界:
- 家长账号: 只能给自己绑定的 student 布置, 只能改/删自己布置的.
- 学生账号: 看到所有发给自己的 (含自己加的), 可标记完成 / 删除自己加的.

设计点:
- 不和具体的 mistake / essay 表硬绑定: 留 description 自由文本说就够了, 灵活.
"""
import re
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request, abort, g

from db import db, row_to_dict, rows_to_dicts
from auth import login_required

bp = Blueprint("assignments", __name__)

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
VALID_KINDS = {"practice", "essay", "reading", "custom"}


def _serialize(row):
    d = row_to_dict(row)
    if not d:
        return None
    return d


def _resolve_target_student(payload: dict):
    """给当前 user 决定这条任务的 student_id.

    家长: 必须是自己绑定的 student.
    学生: 强制等于自己 (忽略 payload 里的 student_id).
    """
    me = g.current_user
    if me["role"] == "student":
        return me["id"]
    # parent
    bound = me.get("student_id")
    if not bound:
        return None
    # 家长可指定 student_id, 但只允许等于自己绑定的孩子
    requested = payload.get("student_id")
    if requested is None:
        return bound
    try:
        rid = int(requested)
    except (TypeError, ValueError):
        return None
    return bound if rid == bound else None


@bp.get("/api/assignments")
@login_required
def list_assignments():
    """列表.

    Query:
      status: 'pending' | 'completed' | 'cancelled' | (空=全部)
      mine_assigned: '1' = 仅看自己布置的 (家长视角); 默认看自己作为接收方
    """
    me = g.current_user
    status = request.args.get("status")
    mine_assigned = request.args.get("mine_assigned") == "1"

    where = []
    args: list = []

    if mine_assigned:
        where.append("a.assigner_user_id = ?")
        args.append(me["id"])
    else:
        # 默认: 我作为接收人 (学生视角); 家长这种视角等于看自己绑定孩子的所有任务
        if me["role"] == "student":
            where.append("a.student_id = ?")
            args.append(me["id"])
        else:
            sid = me.get("student_id")
            if not sid:
                return jsonify([])
            where.append("a.student_id = ?")
            args.append(sid)

    if status:
        where.append("a.status = ?")
        args.append(status)
    where_sql = " AND ".join(where) if where else "1=1"

    with db() as conn:
        rows = conn.execute(
            f"""SELECT a.*, u.display_name AS assigner_name
                FROM assignments a
                LEFT JOIN users u ON u.id = a.assigner_user_id
                WHERE {where_sql}
                ORDER BY
                  CASE WHEN a.status='pending' THEN 0 ELSE 1 END,
                  COALESCE(a.due_date, '9999'),
                  a.created_at DESC""",
            args,
        ).fetchall()
    return jsonify(rows_to_dicts(rows))


@bp.post("/api/assignments")
@login_required
def create_assignment():
    payload = request.get_json(force=True) or {}
    title = (payload.get("title") or "").strip()
    if not title:
        return jsonify({"error": "title_required"}), 400
    if len(title) > 100:
        return jsonify({"error": "title_too_long"}), 400

    description = (payload.get("description") or "").strip() or None
    kind = payload.get("kind") or "custom"
    if kind not in VALID_KINDS:
        return jsonify({"error": "invalid_kind"}), 400

    due = payload.get("due_date")
    if due:
        if not isinstance(due, str) or not DATE_RE.match(due):
            return jsonify({"error": "invalid_due_date"}), 400
    else:
        due = None

    sid = _resolve_target_student(payload)
    if sid is None:
        return jsonify({"error": "no_bound_student"}), 400

    with db() as conn:
        cur = conn.execute(
            """INSERT INTO assignments
                 (student_id, assigner_user_id, kind, title, description, due_date)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (sid, g.current_user["id"], kind, title, description, due),
        )
        row = conn.execute(
            "SELECT * FROM assignments WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
    return jsonify(_serialize(row)), 201


@bp.patch("/api/assignments/<int:aid>")
@login_required
def update_assignment(aid):
    """更新状态 / 标题 / 描述 / 截止日.

    权限: 学生可改自己作为接收方的; 家长可改自己布置的.
    """
    payload = request.get_json(force=True) or {}
    me = g.current_user
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM assignments WHERE id = ?", (aid,)
        ).fetchone()
        if not row:
            abort(404)
        # 权限校验
        if me["role"] == "student":
            if row["student_id"] != me["id"]:
                abort(403)
        else:
            if row["assigner_user_id"] != me["id"]:
                abort(403)

        fields, args = [], []
        if "status" in payload:
            st = payload["status"]
            if st not in ("pending", "completed", "cancelled"):
                return jsonify({"error": "invalid_status"}), 400
            if me["role"] == "student" and st == "cancelled":
                abort(403)
            fields.append("status = ?")
            args.append(st)
            if st == "completed":
                fields.append("completed_at = ?")
                args.append(datetime.now(timezone.utc).isoformat(timespec="seconds"))
            else:
                fields.append("completed_at = NULL")
        # 仅家长可改 meta
        if me["role"] == "parent":
            if "title" in payload:
                t = (payload.get("title") or "").strip()
                if not t:
                    return jsonify({"error": "title_required"}), 400
                fields.append("title = ?")
                args.append(t)
            if "description" in payload:
                d = (payload.get("description") or "").strip() or None
                fields.append("description = ?")
                args.append(d)
            if "due_date" in payload:
                due = payload["due_date"]
                if due is not None and (not isinstance(due, str) or not DATE_RE.match(due)):
                    return jsonify({"error": "invalid_due_date"}), 400
                fields.append("due_date = ?")
                args.append(due or None)
        if not fields:
            return jsonify({"error": "nothing_to_update"}), 400
        args.append(aid)
        conn.execute(
            f"UPDATE assignments SET {', '.join(fields)} WHERE id = ?", args
        )
        out = conn.execute(
            "SELECT * FROM assignments WHERE id = ?", (aid,)
        ).fetchone()
    return jsonify(_serialize(out))


@bp.delete("/api/assignments/<int:aid>")
@login_required
def delete_assignment(aid):
    me = g.current_user
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM assignments WHERE id = ?", (aid,)
        ).fetchone()
        if not row:
            abort(404)
        # 学生只能删自己加的 (assigner_user_id=自己); 家长只能删自己布置的
        if row["assigner_user_id"] != me["id"]:
            abort(403)
        conn.execute("DELETE FROM assignments WHERE id = ?", (aid,))
    return {"ok": True}
