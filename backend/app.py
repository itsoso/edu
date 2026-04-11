"""Flask backend for 教育模块 (edu) — 多租户版本.

所有 /api/* 接口(除 auth)都需要登录. 数据按 owner_user_id(学生 id)隔离.
学生看自己的数据, 家长看所绑定学生的数据.
"""
from pathlib import Path
from flask import Flask, jsonify, request, abort, g, session
from flask_cors import CORS

from db import db, init_db, row_to_dict, rows_to_dicts
from auth import (
    get_secret_key, authenticate, create_student, create_parent,
    load_current_user, public_user, login_required, student_only, get_owner_student_id,
)
from plan_template import install_plan_for_student

BASE_DIR = Path(__file__).resolve().parent.parent
CONTENT_DIR = BASE_DIR / "content"

SUBJECTS = ["科学", "英语", "数学", "语文", "社会"]
FULL_MARKS = {"科学": 150, "英语": 120, "数学": 120, "语文": 120, "社会": 100}

app = Flask(__name__)
app.config["SECRET_KEY"] = get_secret_key()
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_HTTPONLY"] = True
CORS(app, supports_credentials=True, origins=["http://127.0.0.1:5173", "http://localhost:5173"])


# ---------- Auth ----------
@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/auth/register")
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


@app.post("/api/auth/login")
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


@app.post("/api/auth/logout")
def logout():
    session.clear()
    return {"ok": True}


@app.get("/api/auth/me")
def me():
    with db() as conn:
        user = load_current_user(conn)
    if not user:
        return jsonify({"user": None}), 200
    resp = {"user": public_user(user)}
    # 如果是家长, 附带绑定的学生简要信息
    if user["role"] == "parent" and user.get("student_id"):
        with db() as conn:
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


# ---------- 考试 & 成绩 ----------
@app.get("/api/exams")
@login_required
def list_exams():
    with db() as conn:
        rows = conn.execute(
            """SELECT e.*, GROUP_CONCAT(s.subject || ':' || s.score, '|') AS scores_raw
               FROM exams e LEFT JOIN scores s ON s.exam_id = e.id
               WHERE e.owner_user_id = ?
               GROUP BY e.id
               ORDER BY e.sort_order ASC, e.id ASC""",
            (g.owner_id,),
        ).fetchall()
    exams = []
    for r in rows:
        d = row_to_dict(r)
        raw = d.pop("scores_raw", None) or ""
        score_map = {}
        if raw:
            for piece in raw.split("|"):
                if ":" in piece:
                    sub, sc = piece.split(":", 1)
                    try:
                        score_map[sub] = float(sc)
                    except ValueError:
                        pass
        d["scores"] = score_map
        exams.append(d)
    return jsonify(exams)


@app.post("/api/exams")
@login_required
def create_exam():
    payload = request.get_json(force=True) or {}
    name = payload.get("exam_name")
    if not name:
        abort(400, "exam_name required")
    scores = payload.get("scores") or {}
    with db() as conn:
        max_order = conn.execute(
            "SELECT COALESCE(MAX(sort_order), 0) AS m FROM exams WHERE owner_user_id = ?",
            (g.owner_id,),
        ).fetchone()["m"]
        total = payload.get("total")
        if total is None and scores:
            total = sum(v for v in scores.values() if v is not None)
        cur = conn.execute(
            """INSERT INTO exams
               (owner_user_id, exam_name, exam_date, stage, total, class_rank, grade_rank, notes, sort_order)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                g.owner_id,
                name,
                payload.get("exam_date"),
                payload.get("stage"),
                total,
                payload.get("class_rank"),
                payload.get("grade_rank"),
                payload.get("notes"),
                max_order + 1,
            ),
        )
        exam_id = cur.lastrowid
        for subject, score in scores.items():
            if score is None:
                continue
            conn.execute(
                "INSERT INTO scores (exam_id, subject, score, full_mark) VALUES (?, ?, ?, ?)",
                (exam_id, subject, score, FULL_MARKS.get(subject)),
            )
    return jsonify({"id": exam_id}), 201


@app.delete("/api/exams/<int:exam_id>")
@login_required
def delete_exam(exam_id):
    with db() as conn:
        row = conn.execute(
            "SELECT owner_user_id FROM exams WHERE id = ?", (exam_id,)
        ).fetchone()
        if not row:
            abort(404)
        if row["owner_user_id"] != g.owner_id:
            abort(403)
        conn.execute("DELETE FROM exams WHERE id = ?", (exam_id,))
    return {"ok": True}


@app.get("/api/scores/trend")
@login_required
def scores_trend():
    with db() as conn:
        exams = conn.execute(
            """SELECT id, exam_name, stage, total, grade_rank, sort_order
               FROM exams WHERE owner_user_id = ?
               ORDER BY sort_order""",
            (g.owner_id,),
        ).fetchall()
        scores = conn.execute(
            """SELECT s.exam_id, s.subject, s.score, s.full_mark
               FROM scores s JOIN exams e ON e.id = s.exam_id
               WHERE e.owner_user_id = ?""",
            (g.owner_id,),
        ).fetchall()
    by_exam = {}
    for s in scores:
        by_exam.setdefault(s["exam_id"], {})[s["subject"]] = {
            "score": s["score"], "full_mark": s["full_mark"],
        }
    series = []
    for e in exams:
        series.append({
            "exam_id": e["id"],
            "exam_name": e["exam_name"],
            "stage": e["stage"],
            "total": e["total"],
            "grade_rank": e["grade_rank"],
            "subjects": by_exam.get(e["id"], {}),
        })
    return jsonify(series)


# ---------- 任务 & 打卡 ----------
@app.get("/api/tasks")
@login_required
def list_tasks():
    week = request.args.get("week", type=int)
    day = request.args.get("day", type=int)
    query = "SELECT * FROM tasks WHERE owner_user_id = ?"
    args = [g.owner_id]
    if week:
        query += " AND week = ?"
        args.append(week)
    if day:
        query += " AND day_of_week = ?"
        args.append(day)
    query += " ORDER BY week, day_of_week, id"
    with db() as conn:
        rows = conn.execute(query, args).fetchall()
    return jsonify(rows_to_dicts(rows))


@app.get("/api/checkins")
@login_required
def list_checkins():
    date = request.args.get("date")
    with db() as conn:
        if date:
            rows = conn.execute(
                """SELECT c.* FROM checkins c JOIN tasks t ON c.task_id = t.id
                   WHERE t.owner_user_id = ? AND c.checkin_date = ?""",
                (g.owner_id, date),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT c.* FROM checkins c JOIN tasks t ON c.task_id = t.id
                   WHERE t.owner_user_id = ?
                   ORDER BY c.checkin_date DESC""",
                (g.owner_id,),
            ).fetchall()
    return jsonify(rows_to_dicts(rows))


@app.post("/api/checkins")
@login_required
def upsert_checkin():
    payload = request.get_json(force=True) or {}
    task_id = payload.get("task_id")
    date = payload.get("checkin_date")
    if not task_id or not date:
        abort(400, "task_id and checkin_date required")
    with db() as conn:
        task = conn.execute(
            "SELECT owner_user_id FROM tasks WHERE id = ?", (task_id,)
        ).fetchone()
        if not task:
            abort(404)
        if task["owner_user_id"] != g.owner_id:
            abort(403)
        completed = 1 if payload.get("completed", True) else 0
        if completed:
            conn.execute(
                """INSERT INTO checkins (task_id, checkin_date, completed, duration_minutes, note)
                   VALUES (?, ?, 1, ?, ?)
                   ON CONFLICT(task_id, checkin_date) DO UPDATE SET
                       completed = 1,
                       duration_minutes = excluded.duration_minutes,
                       note = excluded.note""",
                (task_id, date, payload.get("duration_minutes"), payload.get("note")),
            )
        else:
            conn.execute(
                "DELETE FROM checkins WHERE task_id = ? AND checkin_date = ?",
                (task_id, date),
            )
    return {"ok": True}


@app.get("/api/checkins/stats")
@login_required
def checkins_stats():
    with db() as conn:
        rows = conn.execute(
            """SELECT c.checkin_date AS date,
                      COUNT(*) AS done,
                      SUM(COALESCE(c.duration_minutes, 0)) AS minutes
               FROM checkins c JOIN tasks t ON c.task_id = t.id
               WHERE t.owner_user_id = ? AND c.completed = 1
               GROUP BY c.checkin_date
               ORDER BY c.checkin_date DESC""",
            (g.owner_id,),
        ).fetchall()
    return jsonify(rows_to_dicts(rows))


# ---------- 错题本 ----------
@app.get("/api/mistakes")
@login_required
def list_mistakes():
    subject = request.args.get("subject")
    mastered = request.args.get("mastered")
    query = "SELECT * FROM mistakes WHERE owner_user_id = ?"
    args = [g.owner_id]
    if subject:
        query += " AND subject = ?"
        args.append(subject)
    if mastered is not None:
        query += " AND mastered = ?"
        args.append(int(mastered))
    query += " ORDER BY created_at DESC"
    with db() as conn:
        rows = conn.execute(query, args).fetchall()
    return jsonify(rows_to_dicts(rows))


@app.post("/api/mistakes")
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


@app.put("/api/mistakes/<int:mid>")
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


@app.delete("/api/mistakes/<int:mid>")
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


@app.get("/api/mistakes/stats")
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


# ---------- Markdown 内容 (公共资源, 无需登录) ----------
@app.get("/api/content/<name>")
def get_content(name):
    if not all(c.isalnum() or c in "-_" for c in name):
        abort(400, "invalid name")
    path = CONTENT_DIR / f"{name}.md"
    if not path.exists():
        abort(404)
    return {"name": name, "content": path.read_text(encoding="utf-8")}


@app.get("/api/content")
def list_content():
    items = []
    if CONTENT_DIR.exists():
        for p in sorted(CONTENT_DIR.glob("*.md")):
            items.append({"name": p.stem, "title": p.stem})
    return jsonify(items)


if __name__ == "__main__":
    init_db()
    app.run(host="127.0.0.1", port=5060, debug=True)
