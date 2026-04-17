"""Auth helpers: session cookie (web) + bearer token (mobile).

两种认证方式共存:
- Web: Flask session cookie (HttpOnly, 同源)
- Mobile (RN): Bearer token in Authorization header
  - Token 生成: itsdangerous URLSafeTimedSerializer 签名 user_id
  - 有效期: 30 天 (移动端不频繁重登)
  - 客户端 (RN) 把 token 存在 expo-secure-store
"""
import os
import secrets
from functools import wraps
from pathlib import Path
from flask import session, jsonify, request, g
from werkzeug.security import generate_password_hash, check_password_hash
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired

from db import db, row_to_dict

SECRET_FILE = Path(__file__).parent / "data" / ".secret_key"


def get_secret_key() -> str:
    """Load secret key, generate + persist on first run."""
    if SECRET_FILE.exists():
        return SECRET_FILE.read_text().strip()
    SECRET_FILE.parent.mkdir(parents=True, exist_ok=True)
    key = secrets.token_urlsafe(48)
    SECRET_FILE.write_text(key)
    return key


def generate_join_code() -> str:
    # 6 位大写字母 + 数字，家长注册时凭此绑定学生
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # 去掉易混字符
    return "".join(secrets.choice(alphabet) for _ in range(6))


# ---------- 创建用户 ----------
def create_student(conn, username: str, password: str, display_name: str,
                   stage: str | None = None) -> dict:
    existing = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if existing:
        raise ValueError("username_taken")
    pw_hash = generate_password_hash(password)
    # 生成不重复的 join_code
    for _ in range(10):
        code = generate_join_code()
        if not conn.execute("SELECT 1 FROM users WHERE join_code = ?", (code,)).fetchone():
            break
    else:
        raise RuntimeError("could_not_generate_join_code")
    cur = conn.execute(
        """INSERT INTO users (username, password_hash, display_name, role, join_code, stage)
           VALUES (?, ?, ?, 'student', ?, ?)""",
        (username, pw_hash, display_name, code, stage),
    )
    uid = cur.lastrowid
    return {"id": uid, "join_code": code}


def create_parent(conn, username: str, password: str, display_name: str,
                  join_code: str) -> dict:
    student = conn.execute(
        "SELECT id FROM users WHERE role = 'student' AND join_code = ?",
        (join_code.upper(),),
    ).fetchone()
    if not student:
        raise ValueError("invalid_join_code")
    existing = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if existing:
        raise ValueError("username_taken")
    pw_hash = generate_password_hash(password)
    cur = conn.execute(
        """INSERT INTO users (username, password_hash, display_name, role, student_id)
           VALUES (?, ?, ?, 'parent', ?)""",
        (username, pw_hash, display_name, student["id"]),
    )
    return {"id": cur.lastrowid, "student_id": student["id"]}


# ---------- 认证 ----------
def authenticate(conn, username: str, password: str):
    row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if not row or not check_password_hash(row["password_hash"], password):
        return None
    return row_to_dict(row)


TOKEN_MAX_AGE_SECONDS = 30 * 24 * 3600  # 30 天
TOKEN_SALT = "edu-mobile-token-v1"


def _get_serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(get_secret_key(), salt=TOKEN_SALT)


def issue_token(user_id: int) -> str:
    """为移动端签发 bearer token (有效期 30 天)."""
    return _get_serializer().dumps({"uid": user_id})


def verify_token(token: str) -> int | None:
    """验证 bearer token, 返回 user_id 或 None."""
    try:
        data = _get_serializer().loads(token, max_age=TOKEN_MAX_AGE_SECONDS)
        return data.get("uid") if isinstance(data, dict) else None
    except (BadSignature, SignatureExpired):
        return None


def _extract_bearer_token() -> str | None:
    """从 Authorization: Bearer <token> 头提取 token."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    return None


def get_current_user_id() -> int | None:
    """优先 bearer token (移动端), 其次 session cookie (web)."""
    token = _extract_bearer_token()
    if token:
        uid = verify_token(token)
        if uid:
            return uid
    return session.get("user_id")


def load_current_user(conn):
    uid = get_current_user_id()
    if not uid:
        return None
    row = conn.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    return row_to_dict(row)


def get_owner_student_id(user: dict) -> int:
    """返回当前用户"操作的学生"id.
    - 学生: 自己
    - 家长: 绑定的学生
    """
    if user["role"] == "student":
        return user["id"]
    return user["student_id"]


def public_user(user: dict) -> dict:
    """去掉密码哈希等敏感字段, 用于返回给前端."""
    if not user:
        return None
    return {
        "id": user["id"],
        "username": user["username"],
        "display_name": user["display_name"],
        "role": user["role"],
        "student_id": user.get("student_id"),
        "join_code": user.get("join_code") if user["role"] == "student" else None,
        "stage": user.get("stage"),
    }


# ---------- 装饰器 ----------
def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not get_current_user_id():
            return jsonify({"error": "unauthorized"}), 401
        with db() as conn:
            user = load_current_user(conn)
            if not user:
                session.clear()
                return jsonify({"error": "unauthorized"}), 401
            g.current_user = user
            g.owner_id = get_owner_student_id(user)
        return fn(*args, **kwargs)
    return wrapper


def student_only(fn):
    """仅学生本人可调用 (家长不行). 用于修改计划等操作."""
    @wraps(fn)
    @login_required
    def wrapper(*args, **kwargs):
        if g.current_user["role"] != "student":
            return jsonify({"error": "student_only"}), 403
        return fn(*args, **kwargs)
    return wrapper
