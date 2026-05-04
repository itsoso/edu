"""Coach API (P6 周日战略复盘)."""
import json
import logging

from flask import Blueprint, jsonify, request, g

from auth import login_required
from db import db, rows_to_dicts
from agent_coach import generate_for_user, _current_week_start

bp = Blueprint("coach", __name__)
log = logging.getLogger(__name__)


def _student_id_for(user_id: int) -> int | None:
    with db() as conn:
        row = conn.execute("SELECT role, student_id FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        return None
    if row["role"] == "student":
        return user_id
    if row["role"] == "parent":
        return row["student_id"]
    return None


@bp.get("/api/coach/this-week")
@login_required
def get_this_week():
    target = _student_id_for(g.owner_id)
    if target is None:
        return jsonify({"exists": False})
    week_start = _current_week_start()
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM coach_reviews WHERE owner_user_id = ? AND week_start = ?",
            (target, week_start),
        ).fetchone()
    if not row:
        return jsonify({"exists": False, "week_start": week_start})
    return _row_to_response(row)


@bp.get("/api/coach/week/<week_start>")
@login_required
def get_week(week_start: str):
    target = _student_id_for(g.owner_id)
    if target is None:
        return jsonify({"exists": False})
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM coach_reviews WHERE owner_user_id = ? AND week_start = ?",
            (target, week_start),
        ).fetchone()
    if not row:
        return jsonify({"exists": False, "week_start": week_start})
    return _row_to_response(row)


@bp.get("/api/coach/history")
@login_required
def list_history():
    target = _student_id_for(g.owner_id)
    if target is None:
        return jsonify([])
    with db() as conn:
        rows = conn.execute("""
            SELECT week_start, status, build_method, build_cost_usd, created_at
            FROM coach_reviews
            WHERE owner_user_id = ?
            ORDER BY week_start DESC LIMIT 30
        """, (target,)).fetchall()
    return jsonify(rows_to_dicts(rows))


@bp.post("/api/coach/this-week/regenerate")
@login_required
def regenerate_this_week():
    target = _student_id_for(g.owner_id)
    if target is None or target != g.owner_id:
        return jsonify({"error": "students_only"}), 403
    result = generate_for_user(g.owner_id, build_method="manual")
    return jsonify(result)


@bp.delete("/api/coach/week/<week_start>")
@login_required
def delete_week(week_start: str):
    target = _student_id_for(g.owner_id)
    if target is None or target != g.owner_id:
        return jsonify({"error": "students_only"}), 403
    with db() as conn:
        conn.execute(
            "DELETE FROM coach_reviews WHERE owner_user_id = ? AND week_start = ?",
            (g.owner_id, week_start),
        )
    return jsonify({"ok": True})


def _row_to_response(row):
    highlights = None
    metrics = None
    try:
        highlights = json.loads(row["highlights_json"]) if row["highlights_json"] else None
    except json.JSONDecodeError:
        pass
    try:
        metrics = json.loads(row["metrics_json"]) if row["metrics_json"] else None
    except json.JSONDecodeError:
        pass
    return jsonify({
        "exists": True,
        "week_start": row["week_start"],
        "status": row["status"],
        "content_md": row["content_md"],
        "highlights": highlights,
        "metrics": metrics,
        "error_message": row["error_message"],
        "build_method": row["build_method"],
        "build_cost_usd": row["build_cost_usd"],
        "created_at": row["created_at"],
    })
