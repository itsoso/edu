"""Externally callable skills API.

The first exposed skill is a read-only schedule query for agent callers such as
OpenClaw or Hermes. Invocation uses the existing login/Bearer auth boundary.
"""
import datetime as dt

from flask import Blueprint, jsonify, request, g

from auth import login_required
from db import db, rows_to_dicts
from routes.schedule import DATE_RE

bp = Blueprint("skills", __name__)


SCHEDULE_QUERY_SKILL = {
    "name": "schedule.query",
    "description": "Query the authenticated user's course schedule by date and optional child name.",
    "input_schema": {
        "type": "object",
        "properties": {
            "date": {
                "type": "string",
                "format": "date",
                "description": "Date to query in YYYY-MM-DD format.",
            },
            "child": {
                "type": "string",
                "description": "Optional child name filter.",
            },
        },
        "required": ["date"],
        "additionalProperties": False,
    },
}


@bp.get("/api/skills")
def list_skills():
    return jsonify({"skills": [SCHEDULE_QUERY_SKILL]})


@bp.post("/api/skills/<skill_name>/invoke")
@login_required
def invoke_skill(skill_name):
    if skill_name != "schedule.query":
        return jsonify({"error": "skill_not_found"}), 404
    return _invoke_schedule_query()


def _invoke_schedule_query():
    body = request.get_json(silent=True) or {}
    date_text = (body.get("date") or "").strip()
    child = (body.get("child") or "").strip() or None

    if not DATE_RE.match(date_text):
        return jsonify({"error": "invalid_date"}), 400

    try:
        query_date = dt.date.fromisoformat(date_text)
    except ValueError:
        return jsonify({"error": "invalid_date"}), 400

    weekday = query_date.isoweekday()
    sql = (
        "SELECT * FROM courses WHERE owner_user_id = ? AND ("
        "  specific_date = ? OR (specific_date IS NULL AND weekday = ?)"
        ")"
    )
    args = [g.owner_id, date_text, weekday]
    if child:
        sql += " AND child_name = ?"
        args.append(child)
    sql += " ORDER BY start_time ASC, sort_order ASC, id ASC"

    with db() as conn:
        rows = conn.execute(sql, args).fetchall()

    return jsonify({
        "ok": True,
        "skill": "schedule.query",
        "result": {
            "date": date_text,
            "weekday": weekday,
            "child": child,
            "courses": rows_to_dicts(rows),
        },
    })
