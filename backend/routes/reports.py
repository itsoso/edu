"""月度复盘报告: 拉本月数据 → 喂给 LLM → 生成 Markdown.

生成是异步的 (~25s). POST /reports/monthly/:m/generate 立即返回占位记录
(status=generating, content_md=空), 前端轮询 GET /reports/monthly/:m
直到 status=done.
"""
import json
import logging

from flask import Blueprint, jsonify, request, abort, g

from db import db, row_to_dict, rows_to_dicts
from auth import login_required
from llm import get_llm, LLMError, MONTHLY_REPORT_PROMPT
from llm_audit import llm_audit
from background import submit as bg_submit

logger = logging.getLogger(__name__)
bp = Blueprint("reports", __name__)


def _month_bounds(month: str):
    """month='YYYY-MM' → (start_date, next_month_start)"""
    y, m = map(int, month.split("-"))
    start = f"{y:04d}-{m:02d}-01"
    if m == 12:
        end = f"{y+1:04d}-01-01"
    else:
        end = f"{y:04d}-{m+1:02d}-01"
    return start, end


def _collect_monthly_metrics(conn, owner_id: int, month: str) -> dict:
    start, end = _month_bounds(month)

    # 学生名
    user = conn.execute(
        "SELECT display_name FROM users WHERE id = ?", (owner_id,)
    ).fetchone()
    student_name = user["display_name"] if user else "同学"

    # 本月考试 (只算有日期且日期落在当月的)
    exam_rows = conn.execute(
        """SELECT e.*, GROUP_CONCAT(s.subject || ':' || s.score, '|') AS scores_raw
           FROM exams e LEFT JOIN scores s ON s.exam_id = e.id
           WHERE e.owner_user_id = ?
             AND e.exam_date IS NOT NULL
             AND e.exam_date >= ? AND e.exam_date < ?
           GROUP BY e.id ORDER BY e.sort_order""",
        (owner_id, start, end),
    ).fetchall()
    exams = []
    for r in exam_rows:
        scores = {}
        if r["scores_raw"]:
            for piece in r["scores_raw"].split("|"):
                if ":" in piece:
                    k, v = piece.split(":", 1)
                    try:
                        scores[k] = float(v)
                    except ValueError:
                        pass
        exams.append({
            "name": r["exam_name"],
            "date": r["exam_date"],
            "total": r["total"],
            "grade_rank": r["grade_rank"],
            "scores": scores,
        })

    # 本月错题
    mistake_rows = conn.execute(
        """SELECT * FROM mistakes
           WHERE owner_user_id = ?
             AND date(created_at) >= ? AND date(created_at) < ?
           ORDER BY created_at""",
        (owner_id, start, end),
    ).fetchall()

    reason_dist: dict = {}
    subject_dist: dict = {}
    for m in mistake_rows:
        reason_dist[m["reason"]] = reason_dist.get(m["reason"], 0) + 1
        subject_dist[m["subject"]] = subject_dist.get(m["subject"], 0) + 1

    top_mistakes = mistake_rows[:6]

    # 打卡
    checkin_rows = conn.execute(
        """SELECT COUNT(*) AS n FROM checkins c
           JOIN tasks t ON c.task_id = t.id
           WHERE t.owner_user_id = ?
             AND c.checkin_date >= ? AND c.checkin_date < ?
             AND c.completed = 1""",
        (owner_id, start, end),
    ).fetchone()
    checkin_count = checkin_rows["n"] if checkin_rows else 0

    distinct_days = conn.execute(
        """SELECT COUNT(DISTINCT checkin_date) AS d FROM checkins c
           JOIN tasks t ON c.task_id = t.id
           WHERE t.owner_user_id = ?
             AND c.checkin_date >= ? AND c.checkin_date < ?
             AND c.completed = 1""",
        (owner_id, start, end),
    ).fetchone()["d"]

    # 训练
    ps_count = conn.execute(
        """SELECT COUNT(*) AS n FROM practice_sets
           WHERE owner_user_id = ?
             AND date(created_at) >= ? AND date(created_at) < ?""",
        (owner_id, start, end),
    ).fetchone()["n"]
    pi_stats = conn.execute(
        """SELECT COUNT(*) AS total,
                  SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS correct,
                  SUM(CASE WHEN is_correct IS NOT NULL THEN 1 ELSE 0 END) AS graded
           FROM practice_items pi
           JOIN practice_sets ps ON pi.set_id = ps.id
           WHERE ps.owner_user_id = ?
             AND date(ps.created_at) >= ? AND date(ps.created_at) < ?""",
        (owner_id, start, end),
    ).fetchone()
    pi_total = pi_stats["total"] or 0
    pi_correct = pi_stats["correct"] or 0
    pi_graded = pi_stats["graded"] or 0
    pi_rate = f"{pi_correct}/{pi_graded}" if pi_graded else "暂无作答"

    # 主动性 / agency 指标 (阶段 3)
    weekly_goals_set = conn.execute(
        """SELECT COUNT(*) AS n FROM weekly_goals
           WHERE owner_user_id = ?
             AND week_start >= ? AND week_start < ?""",
        (owner_id, start, end),
    ).fetchone()["n"]

    override_stats = conn.execute(
        """SELECT
              SUM(CASE WHEN action = 'skip' THEN 1 ELSE 0 END) AS skipped,
              SUM(CASE WHEN action = 'replace' THEN 1 ELSE 0 END) AS replaced
           FROM task_overrides
           WHERE owner_user_id = ?
             AND week_start >= ? AND week_start < ?""",
        (owner_id, start, end),
    ).fetchone()
    tasks_skipped = override_stats["skipped"] or 0
    tasks_replaced = override_stats["replaced"] or 0

    return {
        "student_name": student_name,
        "month": month,
        "exams": exams,
        "mistakes_count": len(mistake_rows),
        "reason_dist": reason_dist,
        "subject_dist": subject_dist,
        "top_mistakes": [
            {
                "subject": m["subject"],
                "reason": m["reason"],
                "knowledge_point": m["knowledge_point"],
                "question_text": (m["question_text"] or "")[:120],
            }
            for m in top_mistakes
        ],
        "checkin_count": checkin_count,
        "distinct_checkin_days": distinct_days,
        "practice_set_count": ps_count,
        "practice_item_count": pi_total,
        "practice_correct_rate": pi_rate,
        "weekly_goals_set": weekly_goals_set,
        "tasks_skipped": tasks_skipped,
        "tasks_replaced": tasks_replaced,
    }


def _format_metrics_for_prompt(metrics: dict) -> dict:
    exams = metrics["exams"]
    if exams:
        exams_summary = "\n".join(
            f"- {e['name']} ({e['date'] or '日期未记'}): 总分 {e['total'] or '-'}, "
            f"年排 {e['grade_rank'] or '-'}, 各科 {e['scores']}"
            for e in exams
        )
    else:
        exams_summary = "本月无考试记录"

    reason_str = (
        ", ".join(f"{k} {v}" for k, v in metrics["reason_dist"].items())
        if metrics["reason_dist"]
        else "无"
    )
    subject_str = (
        ", ".join(f"{k} {v}" for k, v in metrics["subject_dist"].items())
        if metrics["subject_dist"]
        else "无"
    )

    if metrics["top_mistakes"]:
        top_ex = "\n".join(
            f"  · [{m['subject']}] {m['reason']} — {m['knowledge_point']}: {m['question_text']}"
            for m in metrics["top_mistakes"]
        )
    else:
        top_ex = "  (本月无新增错题)"

    plan_days = metrics["distinct_checkin_days"]
    rate = (
        f"{plan_days} 个有打卡的天 / 共 {metrics['checkin_count']} 个任务"
        if metrics["checkin_count"]
        else "本月无打卡"
    )

    return {
        "student_name": metrics["student_name"],
        "month": metrics["month"],
        "exams_summary": exams_summary,
        "new_mistakes_count": metrics["mistakes_count"],
        "reason_distribution": reason_str,
        "subject_distribution": subject_str,
        "top_mistakes_excerpt": top_ex,
        "plan_days": plan_days,
        "checkin_count": metrics["checkin_count"],
        "completion_rate": rate,
        "practice_set_count": metrics["practice_set_count"],
        "practice_item_count": metrics["practice_item_count"],
        "practice_correct_rate": metrics["practice_correct_rate"],
        "weekly_goals_set": metrics.get("weekly_goals_set", 0),
        "tasks_skipped": metrics.get("tasks_skipped", 0),
        "tasks_replaced": metrics.get("tasks_replaced", 0),
    }


@bp.get("/api/reports/monthly")
@login_required
def list_monthly_reports():
    with db() as conn:
        rows = conn.execute(
            """SELECT id, month, created_at FROM monthly_reports
               WHERE owner_user_id = ? ORDER BY month DESC""",
            (g.owner_id,),
        ).fetchall()
    return jsonify(rows_to_dicts(rows))


@bp.get("/api/reports/monthly/<month>")
@login_required
def get_monthly_report(month):
    if not (len(month) == 7 and month[4] == "-"):
        abort(400, "month must be YYYY-MM")
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM monthly_reports WHERE owner_user_id = ? AND month = ?",
            (g.owner_id, month),
        ).fetchone()
    if not row:
        return jsonify({"exists": False, "month": month}), 200
    return jsonify(_report_to_dict(row))


def _run_monthly_report_bg(report_id: int, metrics: dict, owner_id: int):
    """后台: 调 LLM 写报告, 更新 monthly_reports."""
    from routes.reports import _format_metrics_for_prompt as _fmt  # self-import 避免循环
    prompt_vars = _fmt(metrics)
    prompt = MONTHLY_REPORT_PROMPT.format(**prompt_vars)
    try:
        llm = get_llm()
        with llm_audit("monthly_report", owner_id=owner_id, model=llm.model) as audit:
            audit.set_prompt_chars(len(prompt))
            content_md = llm.chat(
                [
                    {"role": "system", "content": "你是一位温暖、务实的初中老师。"},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.5,
                max_tokens=2500,
            )
            audit.set_response_chars(len(content_md))
        if content_md.startswith("```"):
            content_md = content_md.strip("`")
            if content_md.lower().startswith("markdown"):
                content_md = content_md[8:]
            content_md = content_md.strip()
        with db() as conn:
            conn.execute(
                """UPDATE monthly_reports
                   SET content_md = ?, status = 'done', error_message = NULL,
                       created_at = CURRENT_TIMESTAMP
                   WHERE id = ?""",
                (content_md, report_id),
            )
        logger.info("monthly report done for id %s", report_id)
    except Exception as e:
        logger.exception("monthly report failed for id %s", report_id)
        with db() as conn:
            conn.execute(
                "UPDATE monthly_reports SET status='failed', error_message=? WHERE id=?",
                (str(e)[:500], report_id),
            )


@bp.post("/api/reports/monthly/<month>/generate")
@login_required
def generate_monthly_report(month):
    """异步生成月度复盘. 立即返回占位 record (status=generating)."""
    if not (len(month) == 7 and month[4] == "-"):
        abort(400, "month must be YYYY-MM")
    force = bool(request.json and request.json.get("force")) if request.is_json else False

    with db() as conn:
        existing = conn.execute(
            "SELECT id, status FROM monthly_reports WHERE owner_user_id = ? AND month = ?",
            (g.owner_id, month),
        ).fetchone()
        if existing:
            if existing["status"] == "generating":
                # 已经在生成中, 不启动第二个
                row = conn.execute(
                    "SELECT * FROM monthly_reports WHERE id = ?", (existing["id"],)
                ).fetchone()
                return jsonify(_report_to_dict(row)), 202
            if not force:
                return jsonify({"error": "already_exists", "report_id": existing["id"]}), 409
        metrics = _collect_monthly_metrics(conn, g.owner_id, month)
        metrics_json = json.dumps(metrics, ensure_ascii=False)

        if existing:
            conn.execute(
                """UPDATE monthly_reports
                   SET status = 'generating', content_md = '',
                       metrics_json = ?, error_message = NULL
                   WHERE id = ?""",
                (metrics_json, existing["id"]),
            )
            rid = existing["id"]
        else:
            cur = conn.execute(
                """INSERT INTO monthly_reports
                   (owner_user_id, month, content_md, metrics_json, status)
                   VALUES (?, ?, '', ?, 'generating')""",
                (g.owner_id, month, metrics_json),
            )
            rid = cur.lastrowid

        row = conn.execute("SELECT * FROM monthly_reports WHERE id = ?", (rid,)).fetchone()

    bg_submit(_run_monthly_report_bg, rid, metrics, g.owner_id)
    return jsonify(_report_to_dict(row)), 202


def _report_to_dict(row) -> dict:
    d = row_to_dict(row)
    if not d:
        return None
    try:
        d["metrics"] = json.loads(d["metrics_json"]) if d.get("metrics_json") else None
    except Exception:
        d["metrics"] = None
    d.pop("metrics_json", None)
    d["exists"] = True
    return d


@bp.delete("/api/reports/monthly/<month>")
@login_required
def delete_monthly_report(month):
    with db() as conn:
        conn.execute(
            "DELETE FROM monthly_reports WHERE owner_user_id = ? AND month = ?",
            (g.owner_id, month),
        )
    return {"ok": True}
