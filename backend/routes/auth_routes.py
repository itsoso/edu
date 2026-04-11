"""Auth + health check endpoints."""
from flask import Blueprint, jsonify, request, abort, session, g

from db import db
from auth import (
    authenticate, create_student, create_parent,
    load_current_user, public_user, login_required,
)
from plan_template import install_plan_for_student

bp = Blueprint("auth", __name__)


@bp.get("/api/health")
def health():
    return {"ok": True}


@bp.post("/api/auth/register")
def register():
    data = request.get_json(force=True) or {}
    role = data.get("role")
    username = (data.get("username") or "").strip().lower()
    password = data.get("password") or ""
    display_name = (data.get("display_name") or "").strip()
    if not username or not password or not display_name or role not in ("student", "parent"):
        abort(400, "missing fields")
    if len(password) < 6:
        return jsonify({"error": "password_too_short"}), 400
    try:
        with db() as conn:
            if role == "student":
                info = create_student(
                    conn, username, password, display_name,
                    stage=data.get("stage"),
                )
                # 自动为新学生克隆 4 周计划模板
                install_plan_for_student(conn, info["id"])
                session["user_id"] = info["id"]
                user = load_current_user(conn)
            else:
                code = (data.get("join_code") or "").strip().upper()
                if not code:
                    return jsonify({"error": "join_code_required"}), 400
                info = create_parent(conn, username, password, display_name, code)
                session["user_id"] = info["id"]
                user = load_current_user(conn)
        return jsonify({"user": public_user(user)})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400


@bp.post("/api/auth/login")
def login():
    data = request.get_json(force=True) or {}
    username = (data.get("username") or "").strip().lower()
    password = data.get("password") or ""
    with db() as conn:
        user = authenticate(conn, username, password)
    if not user:
        return jsonify({"error": "invalid_credentials"}), 401
    session["user_id"] = user["id"]
    return jsonify({"user": public_user(user)})


@bp.post("/api/auth/logout")
def logout():
    session.clear()
    return {"ok": True}


@bp.delete("/api/auth/me")
@login_required
def delete_me():
    """删除当前账号 + 级联删除所有数据.

    要求在 body 里附带 {"password": "当前密码"} 二次确认.
    学生账号被删后, 绑定它的家长账号变成孤立 (student_id → NULL).
    """
    data = request.get_json(force=True) or {}
    password = data.get("password") or ""
    username = g.current_user["username"]

    with db() as conn:
        user = authenticate(conn, username, password)
        if not user or user["id"] != g.current_user["id"]:
            return jsonify({"error": "wrong_password"}), 401
        conn.execute("DELETE FROM users WHERE id = ?", (user["id"],))

    session.clear()
    return {"ok": True}


@bp.get("/api/auth/me")
def me():
    with db() as conn:
        user = load_current_user(conn)
        if not user:
            return jsonify({"user": None}), 200
        resp = {"user": public_user(user)}
        # 如果是家长, 附带绑定的学生简要信息
        if user["role"] == "parent" and user.get("student_id"):
            srow = conn.execute(
                "SELECT id, display_name, stage FROM users WHERE id = ?",
                (user["student_id"],),
            ).fetchone()
            if srow:
                resp["bound_student"] = {
                    "id": srow["id"],
                    "display_name": srow["display_name"],
                    "stage": srow["stage"],
                }
    return jsonify(resp)
