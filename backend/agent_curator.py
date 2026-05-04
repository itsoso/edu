"""Curator Agent (P5) — 智能今日推荐.

每天给学生选 3-5 项"今天值得做的", 与原 plan 共存, 不替代.

来源:
  1. review_mistake     — spaced repetition (mastery 低 + 12-30 天没碰)
  2. pattern_drill      — 强 error_pattern + 该 drill 一下
  3. goal_aligned       — weekly_goal 存在 + 今天还没朝它做
  4. challenge          — mastery 高的科目, 推一道难题
  5. rest_recommended   — 已经做太多, 提醒休息

LLM 极少: 仅写每条 rationale (一句话). 决策都是规则.

不替代固定 plan, 不动 tasks 表.
"""
import json
import logging
import datetime as dt
from collections import defaultdict
from typing import Any

from db import db
from llm import get_llm, LLMError

log = logging.getLogger(__name__)

MAX_ITEMS_PER_DAY = 5
LLM_MAX_TOKENS_RATIONALE = 120

# 决策参数
SPACED_REVIEW_MIN_DAYS = 12       # 至少 N 天没练才考虑复习
SPACED_REVIEW_MAX_DAYS = 60       # 超过 N 天就抛弃, 太老
MASTERY_LOW_FOR_REVIEW = 0.6      # mastery 低于此值才推复习
PATTERN_MIN_OCCURRENCES = 3
PATTERN_MIN_CONFIDENCE = 0.7
CHALLENGE_HIGH_MASTERY = 0.85
ENGAGEMENT_OVERWORK_THRESHOLD = 0.85  # score_7d 超过此值, 推 rest


def _today_str() -> str:
    return dt.date.today().isoformat()


def _current_week_start() -> str:
    today = dt.date.today()
    return (today - dt.timedelta(days=today.weekday())).isoformat()


def _get_latest_profile(conn, user_id: int) -> tuple[dict, int] | None:
    row = conn.execute(
        "SELECT version, profile_json FROM student_profile "
        "WHERE owner_user_id = ? ORDER BY version DESC LIMIT 1",
        (user_id,),
    ).fetchone()
    if not row:
        return None
    try:
        return (json.loads(row["profile_json"]), row["version"])
    except json.JSONDecodeError:
        return None


# ============================================================
# 5 个候选生成器 (每个返回一组 candidate dicts)
# ============================================================

def _candidates_review_mistake(conn, user_id: int, profile: dict) -> list[dict]:
    """从最近的错题 + 知识地图找 mastery 低 + 12-30 天没碰的."""
    today = dt.date.today()
    rows = conn.execute("""
        SELECT id, subject, knowledge_point, question_text, reason,
               created_at, mastered, mastered_at
        FROM mistakes
        WHERE owner_user_id = ? AND mastered = 0
          AND created_at >= date('now','-60 days')
        ORDER BY created_at DESC
        LIMIT 100
    """, (user_id,)).fetchall()

    out = []
    knowledge = profile.get("knowledge") or {}
    for r in rows:
        try:
            cd = dt.date.fromisoformat(r["created_at"][:10])
            age_days = (today - cd).days
        except (ValueError, TypeError):
            continue
        if age_days < SPACED_REVIEW_MIN_DAYS or age_days > SPACED_REVIEW_MAX_DAYS:
            continue
        # mastery from profile (if available)
        subj, kp = r["subject"], r["knowledge_point"]
        mastery = 0.5
        if subj and kp and subj in knowledge and kp in knowledge[subj]:
            mastery = knowledge[subj][kp].get("mastery", 0.5)
        if mastery > MASTERY_LOW_FOR_REVIEW:
            continue  # 已经掌握得不错, 不推
        out.append({
            "kind": "review_mistake",
            "source_table": "mistakes",
            "source_id": r["id"],
            "title": f"复习这道{subj or '题'}",
            "description": (r["question_text"] or "")[:80],
            "estimated_minutes": 5,
            "priority": 1,
            "_meta": {
                "subject": subj,
                "kp": kp,
                "age_days": age_days,
                "mastery": mastery,
            },
        })
    # 按 (1-mastery) × age_days 排序, 最该复习的先
    out.sort(key=lambda x: -((1 - x["_meta"]["mastery"]) * x["_meta"]["age_days"]))
    return out[:3]  # 最多取 3 候选


def _candidates_pattern_drill(conn, user_id: int, profile: dict) -> list[dict]:
    """从 error_patterns 推 1 个 drill."""
    patterns = profile.get("error_patterns") or []
    eligible = [
        p for p in patterns
        if p.get("occurrences", 0) >= PATTERN_MIN_OCCURRENCES
        and p.get("confidence", 0) >= PATTERN_MIN_CONFIDENCE
        and p.get("trend") != "weakening"
    ]
    if not eligible:
        return []
    best = max(eligible, key=lambda p: p.get("confidence", 0) * p.get("occurrences", 1))
    mids = best.get("evidence_mistake_ids", [])
    if not mids:
        return []
    return [{
        "kind": "pattern_drill",
        "source_table": "mistakes",
        "source_id": mids[0],
        "title": f"针对你的弱项练 3 道",
        "description": (best.get("description") or "")[:80],
        "estimated_minutes": 15,
        "priority": 1,
        "_meta": {"pattern_id": best.get("id"), "subject": best.get("subject")},
    }]


def _candidates_goal_aligned(conn, user_id: int, profile: dict) -> list[dict]:
    """如果本周有 goal, 推一个朝它做的提醒."""
    week_start = _current_week_start()
    row = conn.execute(
        "SELECT id, goal_text, focus_type FROM weekly_goals "
        "WHERE owner_user_id = ? AND week_start = ?",
        (user_id, week_start),
    ).fetchone()
    if not row:
        return []
    return [{
        "kind": "goal_aligned",
        "source_table": "weekly_goals",
        "source_id": row["id"],
        "title": "为本周目标做点事",
        "description": row["goal_text"][:80],
        "estimated_minutes": 20,
        "priority": 2,
        "_meta": {"focus_type": row["focus_type"]},
    }]


def _candidates_challenge(conn, user_id: int, profile: dict) -> list[dict]:
    """从 mastery 高的科目找一道难题挑战."""
    knowledge = profile.get("knowledge") or {}
    strong_subjects = []
    for subj, kps in knowledge.items():
        ms = [info.get("mastery", 0.5) for info in kps.values()]
        if not ms:
            continue
        avg = sum(ms) / len(ms)
        if avg >= CHALLENGE_HIGH_MASTERY:
            strong_subjects.append((subj, avg))
    if not strong_subjects:
        return []
    strong_subjects.sort(key=lambda x: -x[1])
    subj = strong_subjects[0][0]

    # 找该科最近的"难"训练 set 或最近做对的 practice item
    row = conn.execute("""
        SELECT id, title FROM practice_sets
        WHERE owner_user_id = ? AND subject = ?
          AND status = 'done'
        ORDER BY created_at DESC LIMIT 1
    """, (user_id, subj)).fetchone()

    return [{
        "kind": "challenge",
        "source_table": "practice_sets" if row else None,
        "source_id": row["id"] if row else None,
        "title": f"{subj} 你已经很扎实, 试一道更难的?",
        "description": (row["title"] if row else f"挑一道 {subj} 难题") + "",
        "estimated_minutes": 10,
        "priority": 3,
        "_meta": {"subject": subj},
    }]


def _candidates_rest(conn, user_id: int, profile: dict) -> list[dict]:
    """engagement 太高时推休息."""
    eng = profile.get("engagement") or {}
    score = eng.get("score_7d", 0)
    if score < ENGAGEMENT_OVERWORK_THRESHOLD:
        return []
    return [{
        "kind": "rest_recommended",
        "source_table": None,
        "source_id": None,
        "title": "今天可以歇一歇",
        "description": f"最近 7 天打卡率 {int(score * 100)}%, 已经做得很多了",
        "estimated_minutes": 0,
        "priority": 5,
        "_meta": {"score_7d": score},
    }]


# ============================================================
# LLM 写 rationale
# ============================================================

RATIONALE_PROMPTS = {
    "review_mistake": "这是复习推荐. 用一句话说为什么今天该复习这个 (mastery {mastery:.0%}, {age_days} 天没碰). 不要鼓励, 只解释. 30 字内.",
    "pattern_drill": "这是针对她反复出错的模式 ({description}). 一句话说明这个模式为什么值得专攻. 不评判, 30 字内.",
    "goal_aligned": "她本周目标是: {description}. 一句话说今天可以怎么朝它走一步. 30 字内.",
    "challenge": "{subject} 她已经很扎实, 推一道难题. 一句话说为什么. 不要 '挑战自己' 这种空话. 30 字内.",
    "rest_recommended": "她最近 7 天打卡率 {score:.0%}. 一句话温和地建议休息一下, 不评判. 30 字内.",
}


def _generate_rationale(item: dict) -> str:
    """LLM 生成 rationale. 失败返回硬编码 fallback."""
    fallback = item.get("description", "")[:50] or "看看吧"
    llm = get_llm()
    if not llm.configured():
        return fallback

    kind = item["kind"]
    tpl = RATIONALE_PROMPTS.get(kind)
    if not tpl:
        return fallback

    meta = item.get("_meta", {})
    try:
        prompt = tpl.format(
            mastery=meta.get("mastery", 0.5),
            age_days=meta.get("age_days", 0),
            description=item.get("description", "")[:80],
            subject=meta.get("subject", "学习"),
            score=meta.get("score_7d", 0),
        )
    except Exception:
        return fallback

    try:
        text = llm.chat(
            [{"role": "user", "content": prompt}],
            max_tokens=LLM_MAX_TOKENS_RATIONALE,
            temperature=0.5,
        )
        text = text.strip().strip('"').strip("「」")[:80]
        return text or fallback
    except (LLMError, Exception) as e:
        log.warning("curator rationale failed: %s", e)
        return fallback


# ============================================================
# 顶层入口
# ============================================================

def _kind_dismiss_too_high(profile: dict, kind: str) -> bool:
    """Procedural memory: 某 kind dismiss_rate ≥70% (sample ≥3) → 当天不再生成."""
    strat = ((profile.get("agent_strategies") or {}).get("curator") or {}).get(kind)
    if not strat or strat.get("sample_size", 0) < 3:
        return False
    return strat.get("dismiss_rate", 0) >= 0.7


def curate_for_user(user_id: int, force: bool = False) -> dict:
    """对某用户生成今天的 curated_items.

    - 如果今天已经有 items 且 force=False → skip
    - force=True 时清掉今日所有 pending, 重新生成
    - Procedural memory: 历史 dismiss_rate 高的 kind 自动跳过
    """
    today_str = _today_str()
    with db() as conn:
        # 已存在?
        if not force:
            existing = conn.execute(
                "SELECT COUNT(*) AS n FROM curated_items "
                "WHERE owner_user_id = ? AND date = ?",
                (user_id, today_str),
            ).fetchone()
            if existing and existing["n"] > 0:
                return {"skipped": True, "reason": "already_curated", "date": today_str}

        prof = _get_latest_profile(conn, user_id)
        if not prof:
            return {"skipped": True, "reason": "no_profile"}
        profile, profile_version = prof

        # 各候选 (按 procedural memory 跳过 dismiss_rate 高的 kind)
        candidates: list[dict] = []
        kind_generators = [
            ("review_mistake", _candidates_review_mistake),
            ("pattern_drill", _candidates_pattern_drill),
            ("goal_aligned", _candidates_goal_aligned),
            ("challenge", _candidates_challenge),
            ("rest_recommended", _candidates_rest),
        ]
        skipped_kinds = []
        for kind, gen in kind_generators:
            if _kind_dismiss_too_high(profile, kind):
                skipped_kinds.append(kind)
                continue
            candidates += gen(conn, user_id, profile)

        if not candidates:
            return {"skipped": True, "reason": "no_candidates", "skipped_kinds": skipped_kinds}

        # dedup by (kind, source_table, source_id)
        seen = set()
        deduped = []
        for c in candidates:
            key = (c["kind"], c.get("source_table"), c.get("source_id"))
            if key in seen:
                continue
            seen.add(key)
            deduped.append(c)

        # sort by priority then truncate
        deduped.sort(key=lambda x: x["priority"])
        chosen = deduped[:MAX_ITEMS_PER_DAY]

        # 生成 rationale (LLM)
        for item in chosen:
            item["rationale"] = _generate_rationale(item)

        # 如果 force, 清掉旧的 pending
        if force:
            conn.execute("""
                DELETE FROM curated_items
                WHERE owner_user_id = ? AND date = ? AND status = 'pending'
            """, (user_id, today_str))

        # 写库
        ids = []
        for item in chosen:
            cur = conn.execute("""
                INSERT INTO curated_items
                    (owner_user_id, date, kind, source_table, source_id,
                     title, description, rationale, estimated_minutes,
                     priority, profile_version)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                user_id, today_str, item["kind"], item.get("source_table"),
                item.get("source_id"), item["title"], item.get("description"),
                item.get("rationale"), item.get("estimated_minutes"),
                item["priority"], profile_version,
            ))
            ids.append(cur.lastrowid)

    log.info("curator generated %d items for user %s on %s", len(chosen), user_id, today_str)
    return {
        "generated": len(chosen),
        "date": today_str,
        "ids": ids,
    }


def curate_for_all_users() -> list[dict]:
    """cron 入口."""
    with db() as conn:
        users = conn.execute(
            "SELECT id FROM users WHERE role = 'student'"
        ).fetchall()
    results = []
    for u in users:
        try:
            r = curate_for_user(u["id"])
            r["user_id"] = u["id"]
            results.append(r)
        except Exception as e:
            log.exception("curator failed for user %s", u["id"])
            results.append({"user_id": u["id"], "error": str(e)})
    return results
