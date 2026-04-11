"""Flask backend for 教育模块 (edu) — 多租户版本.

所有 /api/* 接口(除 auth)都需要登录. 数据按 owner_user_id(学生 id)隔离.
学生看自己的数据, 家长看所绑定学生的数据.
"""
import json
import uuid
from pathlib import Path
from flask import Flask, jsonify, request, abort, g, session, send_from_directory
from flask_cors import CORS
from werkzeug.utils import secure_filename

from db import db, init_db, row_to_dict, rows_to_dicts
from auth import (
    get_secret_key, authenticate, create_student, create_parent,
    load_current_user, public_user, login_required, student_only, get_owner_student_id,
)
from plan_template import install_plan_for_student
from llm import (
    get_llm, LLMError,
    EXTRACT_MISTAKES_PROMPT, FULL_ANALYSIS_PROMPT,
    GENERATE_PRACTICE_PROMPT, GRADE_PRACTICE_PROMPT,
)

BASE_DIR = Path(__file__).resolve().parent.parent
CONTENT_DIR = BASE_DIR / "content"
UPLOAD_DIR = Path(__file__).resolve().parent / "data" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

MAX_UPLOAD_BYTES = 8 * 1024 * 1024  # 8 MB
ALLOWED_IMAGE_EXT = {"jpg", "jpeg", "png", "webp"}

SUBJECTS = ["科学", "英语", "数学", "语文", "社会"]
FULL_MARKS = {"科学": 150, "英语": 120, "数学": 120, "语文": 120, "社会": 100}

import os as _os

# 任何启动路径(flask dev / gunicorn / server.py)都确保 schema 是最新的.
# CREATE TABLE IF NOT EXISTS 是幂等的.
init_db()

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES
app.config["SECRET_KEY"] = get_secret_key()
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_HTTPONLY"] = True
# 生产环境 (EDU_ENV=prod) 走 HTTPS 时强制 Secure cookie
if _os.environ.get("EDU_ENV") == "prod":
    app.config["SESSION_COOKIE_SECURE"] = True
    app.config["PREFERRED_URL_SCHEME"] = "https"
    # 生产环境由 nginx 统一域名, 同源无需 CORS
    CORS(app, supports_credentials=True)
else:
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


# ---------- 试卷上传 + 分析 ----------
def _upload_to_dict(row):
    d = row_to_dict(row)
    if not d:
        return None
    if d.get("extracted_json"):
        try:
            d["extracted"] = json.loads(d["extracted_json"])
        except Exception:
            d["extracted"] = None
    d.pop("extracted_json", None)
    if d.get("analysis_json"):
        try:
            d["analysis"] = json.loads(d["analysis_json"])
        except Exception:
            d["analysis"] = None
    d.pop("analysis_json", None)
    # 前端用的相对 URL
    d["image_url"] = f"/api/uploads/{d['id']}/file"
    return d


@app.get("/api/llm/status")
@login_required
def llm_status():
    return jsonify({"configured": get_llm().configured(), "model": get_llm().model})


@app.post("/api/uploads")
@login_required
def upload_exam_image():
    if "file" not in request.files:
        abort(400, "file required")
    f = request.files["file"]
    if not f.filename:
        abort(400, "empty filename")
    orig = secure_filename(f.filename) or "upload"
    ext = orig.rsplit(".", 1)[-1].lower() if "." in orig else ""
    if ext not in ALLOWED_IMAGE_EXT:
        return jsonify({"error": "unsupported_image"}), 400

    user_dir = UPLOAD_DIR / str(g.owner_id)
    user_dir.mkdir(parents=True, exist_ok=True)
    uid = uuid.uuid4().hex[:12]
    disk_name = f"{uid}.{ext}"
    disk_path = user_dir / disk_name
    f.save(disk_path)

    rel = f"{g.owner_id}/{disk_name}"
    with db() as conn:
        cur = conn.execute(
            """INSERT INTO exam_uploads (owner_user_id, file_path, file_name, exam_name, status)
               VALUES (?, ?, ?, ?, 'uploaded')""",
            (g.owner_id, rel, orig, request.form.get("exam_name")),
        )
        upload_id = cur.lastrowid
        row = conn.execute("SELECT * FROM exam_uploads WHERE id = ?", (upload_id,)).fetchone()
    return jsonify(_upload_to_dict(row)), 201


@app.get("/api/uploads")
@login_required
def list_uploads():
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM exam_uploads WHERE owner_user_id = ? ORDER BY created_at DESC",
            (g.owner_id,),
        ).fetchall()
    return jsonify([_upload_to_dict(r) for r in rows])


@app.get("/api/uploads/<int:upload_id>")
@login_required
def get_upload(upload_id):
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM exam_uploads WHERE id = ? AND owner_user_id = ?",
            (upload_id, g.owner_id),
        ).fetchone()
    if not row:
        abort(404)
    return jsonify(_upload_to_dict(row))


@app.get("/api/uploads/<int:upload_id>/file")
@login_required
def get_upload_file(upload_id):
    with db() as conn:
        row = conn.execute(
            "SELECT file_path FROM exam_uploads WHERE id = ? AND owner_user_id = ?",
            (upload_id, g.owner_id),
        ).fetchone()
    if not row:
        abort(404)
    p = UPLOAD_DIR / row["file_path"]
    if not p.exists():
        abort(404)
    return send_from_directory(UPLOAD_DIR, row["file_path"])


@app.delete("/api/uploads/<int:upload_id>")
@login_required
def delete_upload(upload_id):
    with db() as conn:
        row = conn.execute(
            "SELECT file_path FROM exam_uploads WHERE id = ? AND owner_user_id = ?",
            (upload_id, g.owner_id),
        ).fetchone()
        if not row:
            abort(404)
        try:
            (UPLOAD_DIR / row["file_path"]).unlink(missing_ok=True)
        except Exception:
            pass
        conn.execute("DELETE FROM exam_uploads WHERE id = ?", (upload_id,))
    return {"ok": True}


def _get_upload_or_403(conn, upload_id):
    row = conn.execute(
        "SELECT * FROM exam_uploads WHERE id = ? AND owner_user_id = ?",
        (upload_id, g.owner_id),
    ).fetchone()
    if not row:
        abort(404)
    return row


@app.post("/api/uploads/<int:upload_id>/extract")
@login_required
def extract_mistakes_from_upload(upload_id):
    """调用 vision LLM 抽取错题列表. 同步返回 JSON."""
    with db() as conn:
        row = _get_upload_or_403(conn, upload_id)
    path = UPLOAD_DIR / row["file_path"]
    try:
        llm = get_llm()
        raw = llm.vision_chat(EXTRACT_MISTAKES_PROMPT, [path], max_tokens=3500)
        from llm import _parse_json_loose
        data = _parse_json_loose(raw)
    except LLMError as e:
        with db() as conn:
            conn.execute(
                "UPDATE exam_uploads SET status='failed', error_message=? WHERE id=?",
                (str(e), upload_id),
            )
        return jsonify({"error": "llm_error", "detail": str(e)}), 502

    subject = (data.get("subject") if isinstance(data, dict) else None) or None
    with db() as conn:
        conn.execute(
            """UPDATE exam_uploads
               SET status='extracted', extracted_json=?, subject=COALESCE(subject, ?)
               WHERE id=?""",
            (json.dumps(data, ensure_ascii=False), subject, upload_id),
        )
        row = conn.execute("SELECT * FROM exam_uploads WHERE id = ?", (upload_id,)).fetchone()
    return jsonify(_upload_to_dict(row))


@app.post("/api/uploads/<int:upload_id>/analyze")
@login_required
def full_analysis_of_upload(upload_id):
    with db() as conn:
        row = _get_upload_or_403(conn, upload_id)
    path = UPLOAD_DIR / row["file_path"]
    try:
        llm = get_llm()
        raw = llm.vision_chat(FULL_ANALYSIS_PROMPT, [path], max_tokens=2500)
        from llm import _parse_json_loose
        data = _parse_json_loose(raw)
    except LLMError as e:
        return jsonify({"error": "llm_error", "detail": str(e)}), 502

    with db() as conn:
        conn.execute(
            "UPDATE exam_uploads SET analysis_json=?, status=? WHERE id=?",
            (
                json.dumps(data, ensure_ascii=False),
                "analyzed" if row["status"] != "extracted" else "analyzed",
                upload_id,
            ),
        )
        row = conn.execute("SELECT * FROM exam_uploads WHERE id = ?", (upload_id,)).fetchone()
    return jsonify(_upload_to_dict(row))


@app.post("/api/uploads/<int:upload_id>/save-mistakes")
@login_required
def save_extracted_mistakes(upload_id):
    """把 extract 结果里选中的错题批量写入 mistakes 表."""
    payload = request.get_json(force=True) or {}
    indices = payload.get("indices")  # [0, 2, 3]
    if indices is None:
        return jsonify({"error": "indices required"}), 400

    with db() as conn:
        row = _get_upload_or_403(conn, upload_id)
        if not row["extracted_json"]:
            return jsonify({"error": "not_extracted"}), 400
        try:
            data = json.loads(row["extracted_json"])
        except Exception:
            return jsonify({"error": "bad_extracted_json"}), 500
        subject = row["subject"] or data.get("subject") or "其他"
        mistakes_list = data.get("mistakes") or []
        saved_ids = []
        for i in indices:
            if 0 <= i < len(mistakes_list):
                m = mistakes_list[i]
                cur = conn.execute(
                    """INSERT INTO mistakes
                       (owner_user_id, subject, exam_name, question_text, wrong_answer,
                        correct_answer, reason, knowledge_point)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        g.owner_id,
                        subject,
                        row["exam_name"],
                        m.get("question_text"),
                        m.get("wrong_answer"),
                        m.get("correct_answer"),
                        m.get("reason_guess") or "其他",
                        m.get("knowledge_point"),
                    ),
                )
                saved_ids.append(cur.lastrowid)
    return jsonify({"saved": len(saved_ids), "ids": saved_ids})


# ---------- 二次训练: 出题 + 作答 + 批改 ----------
def _set_to_dict(conn, s_row):
    d = row_to_dict(s_row)
    items = conn.execute(
        "SELECT * FROM practice_items WHERE set_id = ? ORDER BY id",
        (d["id"],),
    ).fetchall()
    d["items"] = rows_to_dicts(items)
    return d


@app.get("/api/practice")
@login_required
def list_practice_sets():
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM practice_sets WHERE owner_user_id = ? ORDER BY created_at DESC",
            (g.owner_id,),
        ).fetchall()
        out = [_set_to_dict(conn, r) for r in rows]
    return jsonify(out)


@app.get("/api/practice/<int:set_id>")
@login_required
def get_practice_set(set_id):
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM practice_sets WHERE id = ? AND owner_user_id = ?",
            (set_id, g.owner_id),
        ).fetchone()
        if not row:
            abort(404)
        return jsonify(_set_to_dict(conn, row))


@app.post("/api/mistakes/<int:mid>/generate-practice")
@login_required
def generate_practice_from_mistake(mid):
    payload = request.get_json(force=True) or {}
    count = max(1, min(int(payload.get("count", 3)), 6))

    with db() as conn:
        mrow = conn.execute(
            "SELECT * FROM mistakes WHERE id = ? AND owner_user_id = ?",
            (mid, g.owner_id),
        ).fetchone()
    if not mrow:
        abort(404)

    prompt = GENERATE_PRACTICE_PROMPT.format(
        count=count,
        subject=mrow["subject"] or "",
        knowledge_point=mrow["knowledge_point"] or "待定",
        question_text=mrow["question_text"] or "(无)",
        reason=mrow["reason"] or "",
    )
    try:
        llm = get_llm()
        raw = llm.chat(
            [{"role": "system", "content": "你是一位资深初中教师, 擅长出类题。"},
             {"role": "user", "content": prompt}],
            temperature=0.4, max_tokens=2500, response_format_json=True,
        )
        from llm import _parse_json_loose
        data = _parse_json_loose(raw)
    except LLMError as e:
        return jsonify({"error": "llm_error", "detail": str(e)}), 502

    items = data.get("items") if isinstance(data, dict) else None
    if not items:
        return jsonify({"error": "no_items", "raw": raw[:200] if isinstance(raw, str) else ""}), 502

    with db() as conn:
        cur = conn.execute(
            """INSERT INTO practice_sets (owner_user_id, source_mistake_id, title, subject, knowledge_point)
               VALUES (?, ?, ?, ?, ?)""",
            (
                g.owner_id,
                mid,
                f"{mrow['subject'] or '训练'} · {mrow['knowledge_point'] or '类题'}",
                mrow["subject"],
                mrow["knowledge_point"],
            ),
        )
        set_id = cur.lastrowid
        for it in items:
            conn.execute(
                """INSERT INTO practice_items
                   (set_id, question_text, expected_answer, solution_steps, difficulty)
                   VALUES (?, ?, ?, ?, ?)""",
                (
                    set_id,
                    it.get("question_text", ""),
                    it.get("expected_answer"),
                    it.get("solution_steps"),
                    it.get("difficulty"),
                ),
            )
        row = conn.execute("SELECT * FROM practice_sets WHERE id = ?", (set_id,)).fetchone()
        return jsonify(_set_to_dict(conn, row))


@app.post("/api/practice/items/<int:item_id>/grade")
@login_required
def grade_practice_item(item_id):
    payload = request.get_json(force=True) or {}
    student_answer = (payload.get("student_answer") or "").strip()
    if not student_answer:
        return jsonify({"error": "empty_answer"}), 400

    with db() as conn:
        item = conn.execute(
            """SELECT pi.*, ps.owner_user_id
               FROM practice_items pi JOIN practice_sets ps ON pi.set_id = ps.id
               WHERE pi.id = ?""",
            (item_id,),
        ).fetchone()
    if not item:
        abort(404)
    if item["owner_user_id"] != g.owner_id:
        abort(403)

    prompt = GRADE_PRACTICE_PROMPT.format(
        question_text=item["question_text"],
        expected_answer=item["expected_answer"] or "(未提供)",
        student_answer=student_answer,
    )
    try:
        llm = get_llm()
        raw = llm.chat(
            [{"role": "system", "content": "你是严谨但友善的初中老师, 批改要中肯。"},
             {"role": "user", "content": prompt}],
            temperature=0.1, max_tokens=600, response_format_json=True,
        )
        from llm import _parse_json_loose
        data = _parse_json_loose(raw)
    except LLMError as e:
        return jsonify({"error": "llm_error", "detail": str(e)}), 502

    is_correct = 1 if data.get("correct") else 0
    score = int(data.get("score") or (100 if is_correct else 0))
    feedback = data.get("feedback") or ""

    with db() as conn:
        conn.execute(
            """UPDATE practice_items
               SET student_answer = ?, is_correct = ?, score = ?, feedback = ?,
                   graded_at = CURRENT_TIMESTAMP
               WHERE id = ?""",
            (student_answer, is_correct, score, feedback, item_id),
        )
        row = conn.execute("SELECT * FROM practice_items WHERE id = ?", (item_id,)).fetchone()
    return jsonify(row_to_dict(row))


@app.delete("/api/practice/<int:set_id>")
@login_required
def delete_practice_set(set_id):
    with db() as conn:
        row = conn.execute(
            "SELECT owner_user_id FROM practice_sets WHERE id = ?", (set_id,)
        ).fetchone()
        if not row:
            abort(404)
        if row["owner_user_id"] != g.owner_id:
            abort(403)
        conn.execute("DELETE FROM practice_sets WHERE id = ?", (set_id,))
    return {"ok": True}


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
