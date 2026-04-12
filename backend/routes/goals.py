"""Weekly goals — 她每周一自己设定的学习目标.

设计见 改进计划 阶段 3:
- 元学习的核心是"识别自己当下该学什么"
- 没有 goal 时系统不强塞, 让她感受到选择的空间
- 月度复盘会统计她设了几次 goal — 这是 agency 指标

每个 owner + week_start 唯一, 重复 POST 覆盖.
"""
from flask import Blueprint, jsonify, request, abort, g

from db import db, row_to_dict, rows_to_dicts
from auth import login_required

bp = Blueprint("goals", __name__)

VALID_FOCUS_TYPES = {"redo_mistakes", "learn_new", "challenge", "custom"}


@bp.get("/api/goals/weekly")
@login_required
def list_weekly_goals():
    """查最近 N 周的 goals, 默认 12 周."""
    try:
        limit = max(1, min(int(request.args.get("limit", 12)), 52))
    except ValueError:
        limit = 12
    with db() as conn:
        rows = conn.execute(
            """SELECT * FROM weekly_goals
               WHERE owner_user_id = ?
               ORDER BY week_start DESC LIMIT ?""",
            (g.owner_id, limit),
        ).fetchall()
    return jsonify(rows_to_dicts(rows))


@bp.get("/api/goals/weekly/<week_start>")
@login_required
def get_weekly_goal(week_start):
    """拿某一周的 goal. 没设就返回 {exists:false}."""
    if not _is_iso_date(week_start):
        return jsonify({"error": "invalid_week_start"}), 400
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM weekly_goals WHERE owner_user_id = ? AND week_start = ?",
            (g.owner_id, week_start),
        ).fetchone()
    if not row:
        return jsonify({"exists": False, "week_start": week_start}), 200
    d = row_to_dict(row)
    d["exists"] = True
    return jsonify(d)


@bp.post("/api/goals/weekly")
@login_required
def upsert_weekly_goal():
    """创建/更新本周目标."""
    payload = request.get_json(force=True) or {}
    week_start = payload.get("week_start")
    goal_text = (payload.get("goal_text") or "").strip()
    focus_type = payload.get("focus_type")

    if not _is_iso_date(week_start):
        return jsonify({"error": "invalid_week_start"}), 400
    if not goal_text:
        return jsonify({"error": "empty_goal_text"}), 400
    if len(goal_text) > 500:
        return jsonify({"error": "goal_text_too_long"}), 400
    if focus_type and focus_type not in VALID_FOCUS_TYPES:
        return jsonify({"error": "invalid_focus_type"}), 400

    with db() as conn:
        conn.execute(
            """INSERT INTO weekly_goals (owner_user_id, week_start, goal_text, focus_type)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(owner_user_id, week_start) DO UPDATE SET
                   goal_text = excluded.goal_text,
                   focus_type = excluded.focus_type""",
            (g.owner_id, week_start, goal_text, focus_type),
        )
        row = conn.execute(
            "SELECT * FROM weekly_goals WHERE owner_user_id = ? AND week_start = ?",
            (g.owner_id, week_start),
        ).fetchone()
    return jsonify(row_to_dict(row))


@bp.delete("/api/goals/weekly/<week_start>")
@login_required
def delete_weekly_goal(week_start):
    if not _is_iso_date(week_start):
        return jsonify({"error": "invalid_week_start"}), 400
    with db() as conn:
        conn.execute(
            "DELETE FROM weekly_goals WHERE owner_user_id = ? AND week_start = ?",
            (g.owner_id, week_start),
        )
    return {"ok": True}


def _is_iso_date(s):
    if not isinstance(s, str) or len(s) != 10:
        return False
    if s[4] != "-" or s[7] != "-":
        return False
    return True
