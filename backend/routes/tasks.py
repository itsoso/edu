"""Tasks, checkins, dashboard summary."""
from datetime import date, timedelta

from flask import Blueprint, jsonify, request, abort, g

from db import db, rows_to_dicts
from auth import login_required

bp = Blueprint("tasks", __name__)


# ---------- 任务 ----------
@bp.get("/api/tasks")
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


# ---------- 打卡 ----------
@bp.get("/api/checkins")
@login_required
def list_checkins():
    date_arg = request.args.get("date")
    with db() as conn:
        if date_arg:
            rows = conn.execute(
                """SELECT c.* FROM checkins c JOIN tasks t ON c.task_id = t.id
                   WHERE t.owner_user_id = ? AND c.checkin_date = ?""",
                (g.owner_id, date_arg),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT c.* FROM checkins c JOIN tasks t ON c.task_id = t.id
                   WHERE t.owner_user_id = ?
                   ORDER BY c.checkin_date DESC""",
                (g.owner_id,),
            ).fetchall()
    return jsonify(rows_to_dicts(rows))


@bp.post("/api/checkins")
@login_required
def upsert_checkin():
    payload = request.get_json(force=True) or {}
    task_id = payload.get("task_id")
    date_str = payload.get("checkin_date")
    if not task_id or not date_str:
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
                (task_id, date_str, payload.get("duration_minutes"), payload.get("note")),
            )
        else:
            conn.execute(
                "DELETE FROM checkins WHERE task_id = ? AND checkin_date = ?",
                (task_id, date_str),
            )
    return {"ok": True}


@bp.get("/api/checkins/stats")
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


# ---------- Dashboard 汇总 ----------
@bp.get("/api/dashboard/summary")
@login_required
def dashboard_summary():
    today = date.today()
    today_str = today.isoformat()

    with db() as conn:
        # 连续打卡: 只看最近 60 天, 够用且保证 O(1)
        recent_window_start = (today - timedelta(days=60)).isoformat()
        days_rows = conn.execute(
            """SELECT DISTINCT checkin_date FROM checkins c
               JOIN tasks t ON c.task_id = t.id
               WHERE t.owner_user_id = ? AND c.completed = 1
                 AND c.checkin_date >= ?
               ORDER BY checkin_date DESC""",
            (g.owner_id, recent_window_start),
        ).fetchall()
        checked_days = {r["checkin_date"] for r in days_rows}
        streak = 0
        cursor = today
        # 允许今天还没打卡的情况: 如果今天没打卡但昨天打了, streak 从昨天算
        if today_str not in checked_days and (today - timedelta(days=1)).isoformat() in checked_days:
            cursor = today - timedelta(days=1)
        while cursor.isoformat() in checked_days:
            streak += 1
            cursor = cursor - timedelta(days=1)

        # 本月打卡
        month_start = today.replace(day=1).isoformat()
        month_stats = conn.execute(
            """SELECT COUNT(*) AS n,
                      COUNT(DISTINCT c.checkin_date) AS days
               FROM checkins c JOIN tasks t ON c.task_id = t.id
               WHERE t.owner_user_id = ? AND c.completed = 1
                 AND c.checkin_date >= ?""",
            (g.owner_id, month_start),
        ).fetchone()

        # 最近 7 天训练统计
        week_ago = (today - timedelta(days=6)).isoformat()
        practice_stats = conn.execute(
            """SELECT
                  COUNT(pi.id) AS total,
                  SUM(CASE WHEN pi.is_correct IS NOT NULL THEN 1 ELSE 0 END) AS graded,
                  SUM(CASE WHEN pi.is_correct = 1 THEN 1 ELSE 0 END) AS correct
               FROM practice_items pi
               JOIN practice_sets ps ON pi.set_id = ps.id
               WHERE ps.owner_user_id = ?
                 AND date(ps.created_at) >= ?""",
            (g.owner_id, week_ago),
        ).fetchone()

        # 错题本掌握率
        mistake_totals = conn.execute(
            """SELECT COUNT(*) AS n,
                      SUM(CASE WHEN mastered = 1 THEN 1 ELSE 0 END) AS mastered
               FROM mistakes WHERE owner_user_id = ?""",
            (g.owner_id,),
        ).fetchone()

        # 最近 14 天每日打卡数, 用于前端画日历/热力图
        start_14 = (today - timedelta(days=13)).isoformat()
        calendar_rows = conn.execute(
            """SELECT c.checkin_date AS date, COUNT(*) AS done
               FROM checkins c JOIN tasks t ON c.task_id = t.id
               WHERE t.owner_user_id = ? AND c.completed = 1
                 AND c.checkin_date >= ?
               GROUP BY c.checkin_date ORDER BY c.checkin_date""",
            (g.owner_id, start_14),
        ).fetchall()
        by_date = {r["date"]: r["done"] for r in calendar_rows}
        calendar = []
        for i in range(14):
            d = (today - timedelta(days=13 - i)).isoformat()
            calendar.append({"date": d, "done": by_date.get(d, 0)})

    return jsonify({
        "streak_days": streak,
        "month_checkins": month_stats["n"] or 0,
        "month_distinct_days": month_stats["days"] or 0,
        "practice": {
            "total": practice_stats["total"] or 0,
            "graded": practice_stats["graded"] or 0,
            "correct": practice_stats["correct"] or 0,
        },
        "mistakes": {
            "total": mistake_totals["n"] or 0,
            "mastered": mistake_totals["mastered"] or 0,
        },
        "calendar_14d": calendar,
        "today": today_str,
    })
