"""Guardian Agent (P7) — 异常监控.

不主动出建议. 在异常信号出现时温和介入.

5 类异常 (检测全用 SQL/profile, LLM 仅措辞):
  1. engagement_drop         打卡率 7d 比上周降 ≥30%
  2. give_up_pattern         3 天内 practice.item.skip 信号 ≥5 次
  3. pace_too_high           7d 打卡率 ≥95% 且日均 session 超 60 分
  4. reflection_drop         7d 反思字数比上周降 ≥50%
  5. goal_drift              本周 goal 已设但 5 天没朝它的科目做过事

输出双视角 alert:
  - audience='student'  温和关心
  - audience='parent'   家长视角建议 ("这周她可能需要你...")

Cron 检测每天一次 (~07:00). 同 category 同周内不重复触发.
"""
import json
import logging
import datetime as dt
from collections import defaultdict

from db import db
from llm import get_llm, LLMError

log = logging.getLogger(__name__)

ALERT_TTL_DAYS = 7
LLM_MAX_TOKENS = 250


# ============================================================
# 各类异常的 detector
# ============================================================

def _detect_engagement_drop(conn, user_id: int) -> dict | None:
    """7 天打卡天数 vs 前 7 天 (8-14 天前)."""
    this_week = conn.execute("""
        SELECT COUNT(DISTINCT checkin_date) AS n FROM checkins
        WHERE task_id IN (SELECT id FROM tasks WHERE owner_user_id = ?)
          AND completed = 1
          AND checkin_date >= date('now','-7 days')
    """, (user_id,)).fetchone()["n"]
    prev_week = conn.execute("""
        SELECT COUNT(DISTINCT checkin_date) AS n FROM checkins
        WHERE task_id IN (SELECT id FROM tasks WHERE owner_user_id = ?)
          AND completed = 1
          AND checkin_date >= date('now','-14 days')
          AND checkin_date < date('now','-7 days')
    """, (user_id,)).fetchone()["n"]
    if prev_week < 3:
        return None  # 上周本来就没怎么打, 不触发
    drop = (prev_week - this_week) / max(1, prev_week)
    if drop >= 0.3 and this_week < prev_week:
        return {
            "category": "engagement_drop",
            "severity": "medium" if drop >= 0.5 else "low",
            "evidence": {"this_week_days": this_week, "prev_week_days": prev_week, "drop_pct": round(drop * 100)},
        }
    return None


def _detect_give_up_pattern(conn, user_id: int) -> dict | None:
    """3 天内 practice.item.skip ≥ 5."""
    n = conn.execute("""
        SELECT COUNT(*) AS n FROM interaction_signals
        WHERE owner_user_id = ?
          AND event_type = 'practice.item.skip'
          AND occurred_at >= date('now','-3 days')
    """, (user_id,)).fetchone()["n"]
    if n >= 5:
        return {
            "category": "give_up_pattern",
            "severity": "low",
            "evidence": {"skip_count_3d": n},
        }
    return None


def _detect_pace_too_high(conn, user_id: int) -> dict | None:
    """7 天打卡天数 ≥7 + 日均 session > 60 分."""
    days = conn.execute("""
        SELECT COUNT(DISTINCT checkin_date) AS n FROM checkins
        WHERE task_id IN (SELECT id FROM tasks WHERE owner_user_id = ?)
          AND completed = 1
          AND checkin_date >= date('now','-7 days')
    """, (user_id,)).fetchone()["n"]
    if days < 7:
        return None
    rows = conn.execute("""
        SELECT payload_json FROM interaction_signals
        WHERE owner_user_id = ? AND event_type = 'session.end'
          AND occurred_at >= date('now','-7 days')
    """, (user_id,)).fetchall()
    durations = []
    for r in rows:
        try:
            p = json.loads(r["payload_json"] or "{}")
            d = p.get("duration_secs")
            if isinstance(d, (int, float)) and 30 < d < 60 * 60 * 4:
                durations.append(d)
        except (json.JSONDecodeError, TypeError):
            pass
    if not durations:
        return None
    avg_min = sum(durations) / len(durations) / 60
    if avg_min >= 60:
        return {
            "category": "pace_too_high",
            "severity": "low",
            "evidence": {"checkin_days_7d": days, "avg_session_minutes": round(avg_min, 1)},
        }
    return None


def _detect_reflection_drop(conn, user_id: int) -> dict | None:
    """反思字数 7d vs 前 7d, 掉 ≥50%."""
    def chars(window_start_days: int, window_end_days: int) -> int:
        row = conn.execute("""
            SELECT COALESCE(SUM(LENGTH(content)), 0) AS c FROM reflections
            WHERE owner_user_id = ?
              AND date(created_at) >= date('now', ?)
              AND date(created_at) < date('now', ?)
        """, (user_id, f"-{window_start_days} days", f"-{window_end_days} days")).fetchone()
        return row["c"] or 0
    this_chars = chars(7, 0)
    prev_chars = chars(14, 7)
    if prev_chars < 50:
        return None  # 上周本来就没写, 不算 drop
    drop = (prev_chars - this_chars) / max(1, prev_chars)
    if drop >= 0.5:
        return {
            "category": "reflection_drop",
            "severity": "low",
            "evidence": {"this_chars": this_chars, "prev_chars": prev_chars, "drop_pct": round(drop * 100)},
        }
    return None


def _detect_goal_drift(conn, user_id: int) -> dict | None:
    """本周 goal 设了, 但 5 天没看见相关动作."""
    today = dt.date.today()
    week_start = (today - dt.timedelta(days=today.weekday())).isoformat()
    goal = conn.execute("""
        SELECT goal_text, focus_type FROM weekly_goals
        WHERE owner_user_id = ? AND week_start = ?
    """, (user_id, week_start)).fetchone()
    if not goal:
        return None
    # 如果 today 是周日 (5 天 = 周一到周五), 检查
    if today.weekday() < 5:
        return None  # 周末才警告

    # focus_type = 'redo_mistakes' → 看 mistake.view_detail / mark_mastered 信号
    # 'learn_new' → 看 mistake.create / essay.create 信号
    # 'challenge' → 看 practice.item.submit
    focus = goal["focus_type"]
    week_end_iso = (today + dt.timedelta(days=1)).isoformat() + "T00:00:00Z"
    week_start_iso = week_start + "T00:00:00Z"
    relevant_events = {
        "redo_mistakes": ["mistake.view_detail", "mistake.mark_mastered"],
        "learn_new": ["mistake.create", "essay.create"],
        "challenge": ["practice.item.submit"],
        "custom": [],  # 不检测
    }.get(focus or "custom", [])
    if not relevant_events:
        return None
    placeholders = ",".join("?" for _ in relevant_events)
    n = conn.execute(f"""
        SELECT COUNT(*) AS n FROM interaction_signals
        WHERE owner_user_id = ?
          AND event_type IN ({placeholders})
          AND occurred_at >= ? AND occurred_at < ?
    """, (user_id, *relevant_events, week_start_iso, week_end_iso)).fetchone()["n"]
    if n == 0:
        return {
            "category": "goal_drift",
            "severity": "low",
            "evidence": {"goal_text": goal["goal_text"][:80], "focus_type": focus, "actions_this_week": 0},
        }
    return None


DETECTORS = [
    _detect_engagement_drop,
    _detect_give_up_pattern,
    _detect_pace_too_high,
    _detect_reflection_drop,
    _detect_goal_drift,
]


# ============================================================
# Wording (LLM)
# ============================================================

STUDENT_WORDING_PROMPTS = {
    "engagement_drop": "她这周打卡 {this_week_days} 天, 上周 {prev_week_days} 天. 用一句话温和地问候 + 给她台阶, 不评判. 30 字内. 不感叹.",
    "give_up_pattern": "她最近 3 天放弃了 {skip_count_3d} 道训练题. 用一句话承认这种感觉合理 + 给一个简单建议. 30 字内.",
    "pace_too_high": "她最近一周天天打卡, 日均学习 {avg_session_minutes} 分钟. 用一句话温和地建议她歇一歇. 30 字内.",
    "reflection_drop": "她这周日记/反思字数比上周降了 {drop_pct}%. 用一句话不带评判地问她怎么了, 给空间. 30 字内.",
    "goal_drift": "她周初设了目标 \"{goal_text}\", 但本周还没朝它做事. 用一句话温和提醒, 不催促. 30 字内.",
}

PARENT_WORDING_PROMPTS = {
    "engagement_drop": "她孩子这周打卡 {this_week_days} 天, 上周 {prev_week_days} 天. 给家长一句建议: 这周可能不该问学习, 该问感受. 30 字内.",
    "give_up_pattern": "她孩子最近 3 天放弃了 {skip_count_3d} 道训练题. 给家长一句话: 别问'为什么放弃', 该问'累不累'. 30 字内.",
    "pace_too_high": "她孩子最近一周天天打卡, 日均 {avg_session_minutes} 分. 给家长一句话: 这周也许需要你陪她做点和学习无关的事. 30 字内.",
    "reflection_drop": "她孩子日记字数掉了 {drop_pct}%. 给家长一句话: 给她空间, 别追问. 30 字内.",
    "goal_drift": "她孩子设了目标 \"{goal_text}\" 但没动. 给家长一句话: 别提醒她, 让她自己感觉到. 30 字内.",
}

STUDENT_FALLBACKS = {
    "engagement_drop": "这周节奏比上周慢一些, 没关系. 想做的时候再做.",
    "give_up_pattern": "最近放弃了几道题. 卡住了是常事, 想清楚再继续.",
    "pace_too_high": "你最近做得很多. 今天可以放下书, 出去走走.",
    "reflection_drop": "最近写得少了. 不写也行, 你的就是你的.",
    "goal_drift": "周初的目标这周还没碰. 要不要重新看看, 还是想换一个?",
}

PARENT_FALLBACKS = {
    "engagement_drop": "她这周节奏慢了一些. 这周也许不该问学习, 该问她最近怎么了.",
    "give_up_pattern": "她最近放弃了几道题. 别问\"为什么放弃\", 问\"累不累\".",
    "pace_too_high": "她最近学得很拼. 这周陪她做点和学习无关的事吧.",
    "reflection_drop": "她写日记字数掉了. 给空间, 别追问.",
    "goal_drift": "她周初设了目标但没动. 别提醒, 让她自己感觉到.",
}


def _generate_wording(category: str, audience: str, evidence: dict) -> str:
    pool = STUDENT_WORDING_PROMPTS if audience == "student" else PARENT_WORDING_PROMPTS
    fallback_pool = STUDENT_FALLBACKS if audience == "student" else PARENT_FALLBACKS
    fallback = fallback_pool.get(category, "")

    llm = get_llm()
    if not llm.configured() or category not in pool:
        return fallback

    try:
        prompt = pool[category].format(**{k: v for k, v in evidence.items()})
    except (KeyError, ValueError):
        return fallback

    try:
        text = llm.chat(
            [{"role": "user", "content": prompt}],
            max_tokens=LLM_MAX_TOKENS,
            temperature=0.5,
        )
        text = text.strip().strip('"').strip("「」")[:120]
        return text or fallback
    except (LLMError, Exception) as e:
        log.warning("guardian wording failed: %s", e)
        return fallback


# ============================================================
# Top-level
# ============================================================

ALERT_TITLES = {
    "engagement_drop": "节奏慢下来了",
    "give_up_pattern": "最近卡住了",
    "pace_too_high": "学得有点多",
    "reflection_drop": "写得少了",
    "goal_drift": "周目标没动",
}


def _has_recent_alert(conn, owner_id: int, audience: str, category: str, days: int = 7) -> bool:
    """同一类同观众, days 天内不重复 alert."""
    row = conn.execute("""
        SELECT 1 FROM guardian_alerts
        WHERE owner_user_id = ? AND audience = ? AND category = ?
          AND date(created_at) >= date('now', ?)
        LIMIT 1
    """, (owner_id, audience, category, f"-{days} days")).fetchone()
    return row is not None


def _bound_parent_id(conn, student_id: int) -> int | None:
    row = conn.execute(
        "SELECT id FROM users WHERE role = 'parent' AND student_id = ? LIMIT 1",
        (student_id,),
    ).fetchone()
    return row["id"] if row else None


def scan_for_user(student_id: int) -> dict:
    """跑所有 detector, 命中的写 alert (双视角各一)."""
    written = []
    parent_id = None
    with db() as conn:
        parent_id = _bound_parent_id(conn, student_id)
        for det in DETECTORS:
            try:
                hit = det(conn, student_id)
            except Exception:
                log.exception("detector %s failed", det.__name__)
                continue
            if not hit:
                continue
            cat = hit["category"]

            # 学生视角
            if not _has_recent_alert(conn, student_id, "student", cat):
                msg = _generate_wording(cat, "student", hit["evidence"])
                expires = (dt.date.today() + dt.timedelta(days=ALERT_TTL_DAYS)).isoformat()
                conn.execute("""
                    INSERT INTO guardian_alerts
                        (owner_user_id, target_user_id, severity, category,
                         title, message, evidence_json, audience, expires_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'student', ?)
                """, (student_id, student_id, hit["severity"], cat,
                      ALERT_TITLES.get(cat, cat), msg,
                      json.dumps(hit["evidence"], ensure_ascii=False), expires))
                written.append({"audience": "student", "category": cat})

            # 家长视角
            if parent_id and not _has_recent_alert(conn, student_id, "parent", cat):
                msg = _generate_wording(cat, "parent", hit["evidence"])
                expires = (dt.date.today() + dt.timedelta(days=ALERT_TTL_DAYS)).isoformat()
                conn.execute("""
                    INSERT INTO guardian_alerts
                        (owner_user_id, target_user_id, severity, category,
                         title, message, evidence_json, audience, expires_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'parent', ?)
                """, (student_id, parent_id, hit["severity"], cat,
                      ALERT_TITLES.get(cat, cat), msg,
                      json.dumps(hit["evidence"], ensure_ascii=False), expires))
                written.append({"audience": "parent", "category": cat})
    return {"written": written, "count": len(written)}


def scan_for_all_users() -> list[dict]:
    with db() as conn:
        users = conn.execute(
            "SELECT id FROM users WHERE role = 'student'"
        ).fetchall()
    out = []
    for u in users:
        try:
            r = scan_for_user(u["id"])
            r["user_id"] = u["id"]
            out.append(r)
        except Exception as e:
            log.exception("guardian scan failed for user %s", u["id"])
            out.append({"user_id": u["id"], "error": str(e)})
    return out
