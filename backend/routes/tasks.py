"""Tasks, checkins, dashboard summary, daily tip."""
import logging
from datetime import date, timedelta

from flask import Blueprint, jsonify, request, abort, g

from db import db, row_to_dict, rows_to_dicts
from auth import login_required
from llm import get_llm, LLMError, DAILY_TIP_PROMPT
from llm_audit import llm_audit
from background import submit as bg_submit

logger = logging.getLogger(__name__)
bp = Blueprint("tasks", __name__)


# ---------- 任务 ----------
@bp.get("/api/tasks")
@login_required
def list_tasks():
    """
    返回模板任务, 如果 query 里带 week_start=YYYY-MM-DD,
    会 LEFT JOIN task_overrides 并返回 override 字段.

    响应里每条 task 多了这些字段:
    - override_action: None | 'skip' | 'replace'
    - override_title / description / minutes: 如果是 replace
    - effective_title / description / minutes: 她实际看到的版本
                                                 (replace 用她的, 否则用模板的)

    这样前端渲染逻辑非常简单 — 用 effective_* 就行.
    """
    week = request.args.get("week", type=int)
    day = request.args.get("day", type=int)
    week_start = request.args.get("week_start")  # YYYY-MM-DD, 可选

    clauses = ["t.owner_user_id = ?"]
    args: list = [g.owner_id]
    if week:
        clauses.append("t.week = ?")
        args.append(week)
    if day:
        clauses.append("t.day_of_week = ?")
        args.append(day)
    where_sql = " AND ".join(clauses)

    if week_start:
        query = f"""
            SELECT t.*,
                   o.action        AS override_action,
                   o.custom_title  AS override_title,
                   o.custom_description AS override_description,
                   o.custom_minutes     AS override_minutes
            FROM tasks t
            LEFT JOIN task_overrides o
                ON o.task_id = t.id
                AND o.owner_user_id = t.owner_user_id
                AND o.week_start = ?
            WHERE {where_sql}
            ORDER BY t.week, t.day_of_week, t.id
        """
        query_args = [week_start] + args
    else:
        query = f"SELECT * FROM tasks t WHERE {where_sql} ORDER BY t.week, t.day_of_week, t.id"
        query_args = args

    with db() as conn:
        rows = conn.execute(query, query_args).fetchall()

    out = []
    for r in rows:
        d = row_to_dict(r)
        action = d.get("override_action")
        # 计算 effective_* 字段 — 前端直接用
        if action == "replace":
            d["effective_title"] = d.get("override_title") or d["title"]
            d["effective_description"] = (
                d.get("override_description") if d.get("override_description") is not None
                else d["description"]
            )
            d["effective_minutes"] = d.get("override_minutes") or d["minutes"]
        else:
            d["effective_title"] = d["title"]
            d["effective_description"] = d["description"]
            d["effective_minutes"] = d["minutes"]
        out.append(d)
    return jsonify(out)


# ---------- 任务覆盖 (阶段 3: 她可以 skip / replace 模板任务) ----------
@bp.post("/api/tasks/<int:task_id>/override")
@login_required
def upsert_task_override(task_id):
    """
    请求体:
    {
      "week_start": "YYYY-MM-DD",   # 必填, 归属哪一周
      "action": "skip" | "replace",
      "custom_title": "...",         # action=replace 时可选
      "custom_description": "...",   # 同上
      "custom_minutes": 30           # 同上
    }
    """
    payload = request.get_json(force=True) or {}
    week_start = payload.get("week_start")
    action = payload.get("action")
    if not week_start or len(week_start) != 10:
        return jsonify({"error": "invalid_week_start"}), 400
    if action not in ("skip", "replace"):
        return jsonify({"error": "invalid_action"}), 400

    with db() as conn:
        task = conn.execute(
            "SELECT owner_user_id FROM tasks WHERE id = ?", (task_id,)
        ).fetchone()
        if not task:
            abort(404)
        if task["owner_user_id"] != g.owner_id:
            abort(403)

        if action == "skip":
            conn.execute(
                """INSERT INTO task_overrides
                   (owner_user_id, task_id, week_start, action)
                   VALUES (?, ?, ?, 'skip')
                   ON CONFLICT(owner_user_id, task_id, week_start) DO UPDATE SET
                       action = 'skip',
                       custom_title = NULL,
                       custom_description = NULL,
                       custom_minutes = NULL""",
                (g.owner_id, task_id, week_start),
            )
        else:  # replace
            custom_title = payload.get("custom_title")
            if not custom_title:
                return jsonify({"error": "custom_title_required"}), 400
            conn.execute(
                """INSERT INTO task_overrides
                   (owner_user_id, task_id, week_start, action,
                    custom_title, custom_description, custom_minutes)
                   VALUES (?, ?, ?, 'replace', ?, ?, ?)
                   ON CONFLICT(owner_user_id, task_id, week_start) DO UPDATE SET
                       action = 'replace',
                       custom_title = excluded.custom_title,
                       custom_description = excluded.custom_description,
                       custom_minutes = excluded.custom_minutes""",
                (
                    g.owner_id, task_id, week_start,
                    custom_title,
                    payload.get("custom_description"),
                    payload.get("custom_minutes"),
                ),
            )
    return {"ok": True}


@bp.delete("/api/tasks/<int:task_id>/override")
@login_required
def delete_task_override(task_id):
    """取消某一周对某个任务的覆盖 (恢复成模板)."""
    week_start = request.args.get("week_start")
    if not week_start:
        return jsonify({"error": "week_start_required"}), 400
    with db() as conn:
        conn.execute(
            """DELETE FROM task_overrides
               WHERE owner_user_id = ? AND task_id = ? AND week_start = ?""",
            (g.owner_id, task_id, week_start),
        )
    return {"ok": True}


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


# ---------- 每日一句话建议 ----------
def _run_daily_tip_bg(tip_id: int, context: dict, owner_id: int):
    """后台: 调 LLM 写一句建议. 失败就把错误记到 row 上."""
    try:
        llm = get_llm()
        prompt = DAILY_TIP_PROMPT.format(**context)
        with llm_audit("daily_tip", owner_id=owner_id, model=llm.model) as audit:
            audit.set_prompt_chars(len(prompt))
            content = llm.chat(
                [{"role": "user", "content": prompt}],
                temperature=0.6,
                max_tokens=300,
            )
            audit.set_response_chars(len(content))
        # 去掉 LLM 可能加的引号或空白
        content = content.strip().strip('"').strip("'").strip()
        with db() as conn:
            conn.execute(
                """UPDATE daily_tips
                   SET content = ?, status = 'done', error_message = NULL
                   WHERE id = ?""",
                (content, tip_id),
            )
        logger.info("daily tip done for id %s", tip_id)
    except Exception as e:
        logger.exception("daily tip failed for id %s", tip_id)
        with db() as conn:
            conn.execute(
                "UPDATE daily_tips SET status='failed', error_message=? WHERE id=?",
                (str(e)[:500], tip_id),
            )


def _collect_tip_context(conn, owner_id: int) -> dict:
    """收集今天建议 prompt 需要的指标. 复用 dashboard_summary 的部分查询."""
    today = date.today()

    # 学生名
    u = conn.execute("SELECT display_name FROM users WHERE id = ?", (owner_id,)).fetchone()
    student_name = u["display_name"] if u else "同学"

    # 连续打卡 (60 天窗口)
    window = (today - timedelta(days=60)).isoformat()
    days_rows = conn.execute(
        """SELECT DISTINCT checkin_date FROM checkins c
           JOIN tasks t ON c.task_id = t.id
           WHERE t.owner_user_id = ? AND c.completed = 1
             AND c.checkin_date >= ?""",
        (owner_id, window),
    ).fetchall()
    checked = {r["checkin_date"] for r in days_rows}
    streak = 0
    cursor = today
    if today.isoformat() not in checked and (today - timedelta(days=1)).isoformat() in checked:
        cursor = today - timedelta(days=1)
    while cursor.isoformat() in checked:
        streak += 1
        cursor -= timedelta(days=1)

    # 本月
    month_start = today.replace(day=1).isoformat()
    month_days = conn.execute(
        """SELECT COUNT(DISTINCT c.checkin_date) AS d FROM checkins c
           JOIN tasks t ON c.task_id = t.id
           WHERE t.owner_user_id = ? AND c.completed = 1
             AND c.checkin_date >= ?""",
        (owner_id, month_start),
    ).fetchone()["d"]

    # 错题
    m = conn.execute(
        """SELECT COUNT(*) AS total,
                  SUM(CASE WHEN mastered = 1 THEN 1 ELSE 0 END) AS mastered
           FROM mistakes WHERE owner_user_id = ?""",
        (owner_id,),
    ).fetchone()

    # 最近 3 道错题知识点
    recent = conn.execute(
        """SELECT knowledge_point, subject, reason FROM mistakes
           WHERE owner_user_id = ? AND mastered = 0
           ORDER BY created_at DESC LIMIT 3""",
        (owner_id,),
    ).fetchall()
    weak_points = "; ".join(
        f"{r['subject'] or '?'} - {r['knowledge_point'] or r['reason'] or '?'}"
        for r in recent
    ) or "暂无"

    # 本周训练
    week_ago = (today - timedelta(days=6)).isoformat()
    p = conn.execute(
        """SELECT COUNT(pi.id) AS total,
                  SUM(CASE WHEN pi.is_correct IS NOT NULL THEN 1 ELSE 0 END) AS graded,
                  SUM(CASE WHEN pi.is_correct = 1 THEN 1 ELSE 0 END) AS correct
           FROM practice_items pi JOIN practice_sets ps ON pi.set_id = ps.id
           WHERE ps.owner_user_id = ? AND date(ps.created_at) >= ?""",
        (owner_id, week_ago),
    ).fetchone()

    return {
        "student_name": student_name,
        "streak_days": streak,
        "month_days": month_days,
        "mistakes_total": m["total"] or 0,
        "mistakes_mastered": m["mastered"] or 0,
        "practice_total": p["total"] or 0,
        "practice_graded": p["graded"] or 0,
        "practice_correct": p["correct"] or 0,
        "weak_points": weak_points,
    }


@bp.get("/api/dashboard/daily-tip")
@login_required
def get_daily_tip():
    """
    获取/触发今日一句话建议.

    行为:
    - 如果今天的 tip 已存在 (done/generating/failed), 直接返回
    - 如果不存在, 且 LLM 未配置 -> 不生成, 返回 {exists:false, skipped:true}
    - 如果不存在, 且 LLM 已配置 -> 创建 generating 占位并异步启动, 返回 status=generating

    前端调用一次即可. 需要更新时, 轮询这个端点直到 status != 'generating'.
    """
    today_str = date.today().isoformat()

    with db() as conn:
        row = conn.execute(
            "SELECT * FROM daily_tips WHERE owner_user_id = ? AND tip_date = ?",
            (g.owner_id, today_str),
        ).fetchone()

        if row:
            return jsonify(row_to_dict(row))

        # 不存在 → 检查 LLM 是否可用
        if not get_llm().configured():
            return jsonify({"exists": False, "skipped": True, "reason": "llm_not_configured"})

        # 创建占位
        context = _collect_tip_context(conn, g.owner_id)
        cur = conn.execute(
            """INSERT INTO daily_tips (owner_user_id, tip_date, content, status)
               VALUES (?, ?, '', 'generating')""",
            (g.owner_id, today_str),
        )
        tip_id = cur.lastrowid
        row = conn.execute("SELECT * FROM daily_tips WHERE id = ?", (tip_id,)).fetchone()

    bg_submit(_run_daily_tip_bg, tip_id, context, g.owner_id)
    return jsonify(row_to_dict(row)), 202


@bp.delete("/api/dashboard/daily-tip")
@login_required
def delete_today_tip():
    """删今天的 tip, 让下次 GET 重新生成 (调试用)."""
    today_str = date.today().isoformat()
    with db() as conn:
        conn.execute(
            "DELETE FROM daily_tips WHERE owner_user_id = ? AND tip_date = ?",
            (g.owner_id, today_str),
        )
    return {"ok": True}
