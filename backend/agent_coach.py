"""Coach Agent (P6) — 周日战略复盘.

每周日晚自动触发, 写一份 200 字内的"本周回顾 + 下周方向".
比 Tutor 更宏观, 比 monthly Reports 更高频.

输出 markdown, 可选 highlights JSON (strengths/watchouts/focus_for_next_week).
"""
import json
import logging
import time
import datetime as dt
from typing import Any

from db import db
from llm import get_llm, LLMError

log = logging.getLogger(__name__)

LLM_MAX_TOKENS = 700
APPROX_COST_PER_1K_TOKENS = 0.00025


def _current_week_start() -> str:
    today = dt.date.today()
    return (today - dt.timedelta(days=today.weekday())).isoformat()


def _last_week_start() -> str:
    today = dt.date.today()
    monday = today - dt.timedelta(days=today.weekday())
    return (monday - dt.timedelta(days=7)).isoformat()


# ============================================================
# Aggregations (no LLM)
# ============================================================

def _aggregate_week(conn, user_id: int, week_start: str) -> dict:
    week_end = (dt.date.fromisoformat(week_start) + dt.timedelta(days=7)).isoformat()

    # 打卡天数
    checkin_days = conn.execute("""
        SELECT COUNT(DISTINCT checkin_date) AS n
        FROM checkins
        WHERE task_id IN (SELECT id FROM tasks WHERE owner_user_id = ?)
          AND completed = 1
          AND checkin_date >= ? AND checkin_date < ?
    """, (user_id, week_start, week_end)).fetchone()["n"]

    # 新错题
    new_mistakes = conn.execute("""
        SELECT subject, COUNT(*) AS n FROM mistakes
        WHERE owner_user_id = ?
          AND date(created_at) >= ? AND date(created_at) < ?
        GROUP BY subject
    """, (user_id, week_start, week_end)).fetchall()
    by_subject_mistakes = {r["subject"]: r["n"] for r in new_mistakes}

    # 标掌握
    mastered = conn.execute("""
        SELECT COUNT(*) AS n FROM mistakes
        WHERE owner_user_id = ?
          AND date(mastered_at) >= ? AND date(mastered_at) < ?
    """, (user_id, week_start, week_end)).fetchone()["n"]

    # 训练数
    practice = conn.execute("""
        SELECT COUNT(DISTINCT pi.id) AS items, COUNT(DISTINCT ps.id) AS sets,
               SUM(CASE WHEN pi.is_correct = 1 THEN 1 ELSE 0 END) AS correct
        FROM practice_items pi JOIN practice_sets ps ON ps.id = pi.set_id
        WHERE ps.owner_user_id = ?
          AND date(pi.graded_at) >= ? AND date(pi.graded_at) < ?
    """, (user_id, week_start, week_end)).fetchone()

    # 反思
    reflections = conn.execute("""
        SELECT kind, COUNT(*) AS n, COALESCE(SUM(LENGTH(content)), 0) AS chars
        FROM reflections
        WHERE owner_user_id = ?
          AND date(created_at) >= ? AND date(created_at) < ?
        GROUP BY kind
    """, (user_id, week_start, week_end)).fetchall()
    refl_summary = {r["kind"]: {"count": r["n"], "chars": r["chars"]} for r in reflections}

    # Feynman sessions (this is a strong signal)
    feynman = conn.execute("""
        SELECT
          SUM(CASE WHEN status = 'finished'
                   AND ai_assessment_json LIKE '%understood%' AND ai_assessment_json NOT LIKE '%mechanical%'
                   THEN 1 ELSE 0 END) AS understood,
          SUM(CASE WHEN status = 'finished' AND ai_assessment_json LIKE '%mechanical%' THEN 1 ELSE 0 END) AS mechanical,
          COUNT(*) AS total
        FROM feynman_sessions
        WHERE owner_user_id = ?
          AND date(created_at) >= ? AND date(created_at) < ?
    """, (user_id, week_start, week_end)).fetchone()

    # Weekly goal (this week)
    goal = conn.execute("""
        SELECT goal_text, focus_type FROM weekly_goals
        WHERE owner_user_id = ? AND week_start = ?
    """, (user_id, week_start)).fetchone()

    # Tutor agent acceptance
    tutor = conn.execute("""
        SELECT
          SUM(CASE WHEN user_response = 'accepted' THEN 1 ELSE 0 END) AS accepted,
          SUM(CASE WHEN user_response = 'dismissed' THEN 1 ELSE 0 END) AS dismissed,
          COUNT(*) AS total
        FROM agent_actions
        WHERE owner_user_id = ?
          AND agent_name = 'tutor'
          AND date(created_at) >= ? AND date(created_at) < ?
    """, (user_id, week_start, week_end)).fetchone()

    return {
        "week_start": week_start,
        "checkin_days": checkin_days,
        "new_mistakes_total": sum(by_subject_mistakes.values()),
        "new_mistakes_by_subject": by_subject_mistakes,
        "mastered_count": mastered,
        "practice_items": practice["items"] or 0,
        "practice_sets": practice["sets"] or 0,
        "practice_correct": practice["correct"] or 0,
        "reflections": refl_summary,
        "feynman_total": feynman["total"] or 0,
        "feynman_understood": feynman["understood"] or 0,
        "feynman_mechanical": feynman["mechanical"] or 0,
        "weekly_goal": dict(goal) if goal else None,
        "tutor_accepted": tutor["accepted"] or 0,
        "tutor_dismissed": tutor["dismissed"] or 0,
    }


def _profile_delta(conn, user_id: int) -> dict:
    """对比本周 (latest) vs 上周 (latest-1) 画像."""
    rows = conn.execute("""
        SELECT version, profile_json FROM student_profile
        WHERE owner_user_id = ? ORDER BY version DESC LIMIT 8
    """, (user_id,)).fetchall()
    if len(rows) < 2:
        return {}
    try:
        latest = json.loads(rows[0]["profile_json"])
    except json.JSONDecodeError:
        return {}
    # 取 ~ 7 天前的 (假设每天 1 个版本)
    older = None
    for r in rows[1:]:
        try:
            older = json.loads(r["profile_json"])
            break
        except json.JSONDecodeError:
            continue
    if not older:
        return {}

    # mastery delta per (subj, kp)
    delta = []
    new_kp = latest.get("knowledge", {})
    old_kp = older.get("knowledge", {})
    for subj, kps in new_kp.items():
        for kp, info in kps.items():
            new_m = info.get("mastery", 0.5)
            old_m = old_kp.get(subj, {}).get(kp, {}).get("mastery", new_m)
            d = new_m - old_m
            if abs(d) >= 0.05:
                delta.append({"subject": subj, "kp": kp, "delta": round(d, 2),
                              "new": new_m, "old": old_m})
    delta.sort(key=lambda x: -abs(x["delta"]))

    # error_pattern 增减
    new_pids = {p.get("id") for p in (latest.get("error_patterns") or [])}
    old_pids = {p.get("id") for p in (older.get("error_patterns") or [])}
    new_patterns = list(new_pids - old_pids)
    resolved_patterns = list(old_pids - new_pids)

    return {
        "mastery_delta_top": delta[:5],
        "new_patterns": new_patterns[:5],
        "resolved_patterns": resolved_patterns[:5],
    }


# ============================================================
# LLM
# ============================================================

REVIEW_PROMPT = """你是一位平静、温和的学习教练. 给一个初中生写一份本周回顾.

要求:
- 200 字内, markdown, 中文
- 第二人称 "你"
- 平实, 不鼓励, 不评价
- 必须包含 4 个段落:
  1. 一段总结性文字 (60-80 字)
  2. **做得好的:** (1-2 个具体)
  3. **值得注意的:** (1 个具体, 非批评)
  4. **下周可以试试:** (1 句具体方向)
- 数据稀疏时直接说 "数据不够, 慢慢来"
- 别用 "加油" "你真棒" "继续努力" 这种话
- 不要感叹号

本周数据:
{week_metrics}

画像变化 (vs 上周):
{profile_delta}

只输出 markdown 复盘内容. 不要解释、不要前后缀."""


HIGHLIGHTS_PROMPT = """你刚写完上面的复盘. 现在把它结构化, 输出严格 JSON:
{{
  "strengths": ["...", "..."],          // 1-3 条
  "watchouts": ["..."],                 // 0-2 条
  "focus_for_next_week": "..."           // 1 句具体方向
}}

JSON only, no preamble."""


def _generate_review(week_metrics: dict, delta: dict) -> tuple[str, dict, float]:
    """返回 (content_md, highlights, cost_usd)."""
    fallback_md = f"""## 本周回顾

数据还在攒, 这周的画面还不够清楚.

**做得好的:**
- 你这周打卡了 {week_metrics.get('checkin_days', 0)} 天

**值得注意的:**
- 数据不够, 还看不出趋势

**下周可以试试:**
保持现在的节奏, 让系统多积累一点你的学习数据.
"""
    fallback_h = {
        "strengths": [f"打卡 {week_metrics.get('checkin_days', 0)} 天"],
        "watchouts": [],
        "focus_for_next_week": "保持节奏",
    }

    llm = get_llm()
    if not llm.configured():
        return (fallback_md, fallback_h, 0.0)

    try:
        prompt = REVIEW_PROMPT.format(
            week_metrics=json.dumps(week_metrics, ensure_ascii=False, indent=2),
            profile_delta=json.dumps(delta or {}, ensure_ascii=False, indent=2),
        )
        review = llm.chat(
            [{"role": "user", "content": prompt}],
            max_tokens=LLM_MAX_TOKENS,
            temperature=0.4,
        )
        review = review.strip()
    except (LLMError, Exception) as e:
        log.warning("coach review LLM failed: %s", e)
        return (fallback_md, fallback_h, 0.0)

    # 第二步: 抽 highlights
    try:
        highlights = llm.json_chat(
            review + "\n\n---\n\n" + HIGHLIGHTS_PROMPT,
            max_tokens=400,
            temperature=0.2,
        )
        if not isinstance(highlights, dict):
            highlights = fallback_h
        else:
            highlights = {
                "strengths": highlights.get("strengths", []) or [],
                "watchouts": highlights.get("watchouts", []) or [],
                "focus_for_next_week": highlights.get("focus_for_next_week", "") or "",
            }
    except (LLMError, Exception):
        highlights = fallback_h

    # 估算成本
    approx = (len(prompt) + len(review)) / 4 / 1000 * APPROX_COST_PER_1K_TOKENS * 2
    return (review, highlights, approx)


# ============================================================
# 顶层入口
# ============================================================

def generate_for_user(user_id: int, week_start: str | None = None,
                      build_method: str = "cron_sunday") -> dict:
    """生成某周的 review (默认本周). 已存在则覆盖."""
    if not week_start:
        week_start = _current_week_start()
    start_t = time.time()

    with db() as conn:
        # 先标 generating
        conn.execute("""
            INSERT OR REPLACE INTO coach_reviews
                (owner_user_id, week_start, status, build_method)
            VALUES (?, ?, 'generating', ?)
        """, (user_id, week_start, build_method))

        metrics = _aggregate_week(conn, user_id, week_start)
        delta = _profile_delta(conn, user_id)

    # LLM (脱离 conn)
    try:
        content_md, highlights, cost = _generate_review(metrics, delta)
        with db() as conn:
            conn.execute("""
                UPDATE coach_reviews
                SET status = 'done',
                    content_md = ?,
                    highlights_json = ?,
                    metrics_json = ?,
                    build_cost_usd = ?
                WHERE owner_user_id = ? AND week_start = ?
            """, (content_md, json.dumps(highlights, ensure_ascii=False),
                  json.dumps(metrics, ensure_ascii=False), cost, user_id, week_start))
        log.info("coach review user=%s week=%s cost=%.4f", user_id, week_start, cost)
        return {"ok": True, "week_start": week_start, "duration_ms": int((time.time() - start_t) * 1000)}
    except Exception as e:
        log.exception("coach review failed user=%s", user_id)
        with db() as conn:
            conn.execute("""
                UPDATE coach_reviews SET status = 'failed', error_message = ?
                WHERE owner_user_id = ? AND week_start = ?
            """, (str(e)[:500], user_id, week_start))
        return {"ok": False, "error": str(e)}


def generate_for_all_users(week_start: str | None = None) -> list[dict]:
    """cron 入口."""
    with db() as conn:
        users = conn.execute(
            "SELECT id FROM users WHERE role = 'student'"
        ).fetchall()
    out = []
    for u in users:
        try:
            r = generate_for_user(u["id"], week_start)
            r["user_id"] = u["id"]
            out.append(r)
        except Exception as e:
            log.exception("coach failed for user %s", u["id"])
            out.append({"user_id": u["id"], "error": str(e)})
    return out
