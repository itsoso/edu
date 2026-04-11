"""Flask backend for 教育模块 (edu).

Serves REST API on /api/* and static markdown content on /api/content/:name.
"""
from pathlib import Path
from flask import Flask, jsonify, request, abort
from flask_cors import CORS

from db import db, init_db, row_to_dict, rows_to_dicts

BASE_DIR = Path(__file__).resolve().parent.parent
CONTENT_DIR = BASE_DIR / "content"

app = Flask(__name__)
CORS(app)


# ---------- 健康检查 ----------
@app.get("/api/health")
def health():
    return {"ok": True}


# ---------- 考试 & 成绩 ----------
@app.get("/api/exams")
def list_exams():
    with db() as conn:
        rows = conn.execute(
            """SELECT e.*, GROUP_CONCAT(s.subject || ':' || s.score, '|') AS scores_raw
               FROM exams e LEFT JOIN scores s ON s.exam_id = e.id
               GROUP BY e.id
               ORDER BY e.sort_order ASC, e.id ASC"""
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
def create_exam():
    payload = request.get_json(force=True) or {}
    name = payload.get("exam_name")
    if not name:
        abort(400, "exam_name required")
    scores = payload.get("scores") or {}

    with db() as conn:
        # 计算新的 sort_order: 追加到末尾
        max_order = conn.execute("SELECT COALESCE(MAX(sort_order), 0) AS m FROM exams").fetchone()["m"]
        total = payload.get("total")
        if total is None and scores:
            total = sum(v for v in scores.values() if v is not None)
        cur = conn.execute(
            """INSERT INTO exams
               (exam_name, exam_date, stage, total, class_rank, grade_rank, notes, sort_order)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
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
        from seed import FULL_MARKS
        for subject, score in scores.items():
            if score is None:
                continue
            conn.execute(
                "INSERT INTO scores (exam_id, subject, score, full_mark) VALUES (?, ?, ?, ?)",
                (exam_id, subject, score, FULL_MARKS.get(subject)),
            )
    return jsonify({"id": exam_id}), 201


@app.delete("/api/exams/<int:exam_id>")
def delete_exam(exam_id):
    with db() as conn:
        conn.execute("DELETE FROM exams WHERE id = ?", (exam_id,))
    return {"ok": True}


@app.get("/api/scores/trend")
def scores_trend():
    """Returns per-subject score series across all exams, ordered by sort_order."""
    with db() as conn:
        exams = conn.execute(
            "SELECT id, exam_name, stage, total, grade_rank, sort_order FROM exams ORDER BY sort_order"
        ).fetchall()
        scores = conn.execute(
            "SELECT exam_id, subject, score, full_mark FROM scores"
        ).fetchall()

    by_exam = {}
    for s in scores:
        by_exam.setdefault(s["exam_id"], {})[s["subject"]] = {
            "score": s["score"],
            "full_mark": s["full_mark"],
        }

    series = []
    for e in exams:
        row = {
            "exam_id": e["id"],
            "exam_name": e["exam_name"],
            "stage": e["stage"],
            "total": e["total"],
            "grade_rank": e["grade_rank"],
        }
        row["subjects"] = by_exam.get(e["id"], {})
        series.append(row)
    return jsonify(series)


# ---------- 任务 & 打卡 ----------
@app.get("/api/tasks")
def list_tasks():
    week = request.args.get("week", type=int)
    day = request.args.get("day", type=int)
    query = "SELECT * FROM tasks"
    clauses = []
    args = []
    if week:
        clauses.append("week = ?")
        args.append(week)
    if day:
        clauses.append("day_of_week = ?")
        args.append(day)
    if clauses:
        query += " WHERE " + " AND ".join(clauses)
    query += " ORDER BY week, day_of_week, id"
    with db() as conn:
        rows = conn.execute(query, args).fetchall()
    return jsonify(rows_to_dicts(rows))


@app.get("/api/checkins")
def list_checkins():
    date = request.args.get("date")
    with db() as conn:
        if date:
            rows = conn.execute(
                "SELECT * FROM checkins WHERE checkin_date = ?", (date,)
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM checkins ORDER BY checkin_date DESC").fetchall()
    return jsonify(rows_to_dicts(rows))


@app.post("/api/checkins")
def upsert_checkin():
    payload = request.get_json(force=True) or {}
    task_id = payload.get("task_id")
    date = payload.get("checkin_date")
    if not task_id or not date:
        abort(400, "task_id and checkin_date required")
    completed = 1 if payload.get("completed", True) else 0
    with db() as conn:
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
def checkins_stats():
    """Returns daily aggregation: {date: {done, total_minutes}}"""
    with db() as conn:
        rows = conn.execute(
            """SELECT checkin_date AS date,
                      COUNT(*) AS done,
                      SUM(COALESCE(duration_minutes, 0)) AS minutes
               FROM checkins
               WHERE completed = 1
               GROUP BY checkin_date
               ORDER BY checkin_date DESC"""
        ).fetchall()
    return jsonify(rows_to_dicts(rows))


# ---------- 错题本 ----------
@app.get("/api/mistakes")
def list_mistakes():
    subject = request.args.get("subject")
    mastered = request.args.get("mastered")
    query = "SELECT * FROM mistakes"
    clauses = []
    args = []
    if subject:
        clauses.append("subject = ?")
        args.append(subject)
    if mastered is not None:
        clauses.append("mastered = ?")
        args.append(int(mastered))
    if clauses:
        query += " WHERE " + " AND ".join(clauses)
    query += " ORDER BY created_at DESC"
    with db() as conn:
        rows = conn.execute(query, args).fetchall()
    return jsonify(rows_to_dicts(rows))


@app.post("/api/mistakes")
def create_mistake():
    payload = request.get_json(force=True) or {}
    if not payload.get("subject") or not payload.get("reason"):
        abort(400, "subject and reason required")
    with db() as conn:
        cur = conn.execute(
            """INSERT INTO mistakes
               (subject, exam_name, question_text, wrong_answer, correct_answer,
                reason, knowledge_point)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
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
def update_mistake(mid):
    payload = request.get_json(force=True) or {}
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
    if not fields:
        return {"ok": True}
    args.append(mid)
    with db() as conn:
        conn.execute(f"UPDATE mistakes SET {', '.join(fields)} WHERE id = ?", args)
    return {"ok": True}


@app.delete("/api/mistakes/<int:mid>")
def delete_mistake(mid):
    with db() as conn:
        conn.execute("DELETE FROM mistakes WHERE id = ?", (mid,))
    return {"ok": True}


@app.get("/api/mistakes/stats")
def mistakes_stats():
    with db() as conn:
        by_reason = conn.execute(
            """SELECT reason, COUNT(*) AS n
               FROM mistakes GROUP BY reason ORDER BY n DESC"""
        ).fetchall()
        by_subject = conn.execute(
            """SELECT subject, COUNT(*) AS n,
                      SUM(CASE WHEN mastered = 1 THEN 1 ELSE 0 END) AS mastered_n
               FROM mistakes GROUP BY subject ORDER BY n DESC"""
        ).fetchall()
    return jsonify({
        "by_reason": rows_to_dicts(by_reason),
        "by_subject": rows_to_dicts(by_subject),
    })


# ---------- Markdown 内容 ----------
@app.get("/api/content/<name>")
def get_content(name):
    # 防目录穿越: 只允许字母数字/横线/下划线
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
