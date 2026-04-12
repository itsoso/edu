"""Exams & scores trend."""
from flask import Blueprint, jsonify, request, abort, g

from db import db, row_to_dict
from auth import login_required
from constants import FULL_MARKS

bp = Blueprint("exams", __name__)


@bp.get("/api/exams")
@login_required
def list_exams():
    try:
        limit = max(1, min(int(request.args.get("limit", 50)), 200))
        offset = max(0, int(request.args.get("offset", 0)))
    except ValueError:
        limit, offset = 50, 0

    with db() as conn:
        total = conn.execute(
            "SELECT COUNT(*) FROM exams WHERE owner_user_id = ?",
            (g.owner_id,),
        ).fetchone()[0]
        rows = conn.execute(
            """SELECT e.*, GROUP_CONCAT(s.subject || ':' || s.score, '|') AS scores_raw
               FROM exams e LEFT JOIN scores s ON s.exam_id = e.id
               WHERE e.owner_user_id = ?
               GROUP BY e.id
               ORDER BY e.sort_order ASC, e.id ASC
               LIMIT ? OFFSET ?""",
            (g.owner_id, limit, offset),
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
    resp = jsonify(exams)
    resp.headers["X-Total-Count"] = str(total)
    resp.headers["Access-Control-Expose-Headers"] = "X-Total-Count"
    return resp


@bp.post("/api/exams")
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


@bp.delete("/api/exams/<int:exam_id>")
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


@bp.get("/api/scores/trend")
@login_required
def scores_trend():
    try:
        limit = max(1, min(int(request.args.get("limit", 50)), 200))
        offset = max(0, int(request.args.get("offset", 0)))
    except ValueError:
        limit, offset = 50, 0

    with db() as conn:
        total = conn.execute(
            "SELECT COUNT(*) FROM exams WHERE owner_user_id = ?",
            (g.owner_id,),
        ).fetchone()[0]
        exams = conn.execute(
            """SELECT id, exam_name, stage, total, grade_rank, sort_order
               FROM exams WHERE owner_user_id = ?
               ORDER BY sort_order
               LIMIT ? OFFSET ?""",
            (g.owner_id, limit, offset),
        ).fetchall()
        exam_ids = [e["id"] for e in exams]
        if exam_ids:
            placeholders = ",".join("?" * len(exam_ids))
            scores = conn.execute(
                f"""SELECT s.exam_id, s.subject, s.score, s.full_mark
                   FROM scores s
                   WHERE s.exam_id IN ({placeholders})""",
                exam_ids,
            ).fetchall()
        else:
            scores = []
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
    resp = jsonify(series)
    resp.headers["X-Total-Count"] = str(total)
    resp.headers["Access-Control-Expose-Headers"] = "X-Total-Count"
    return resp
