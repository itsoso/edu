"""Tutor Agent (P2) — 第一个主动 agent.

读 /api/me/profile 当上下文, 每天最多生成 1 条主动建议.

架构: rule-based 决策 + LLM 措辞.
- 决策 (规则): 可解释、可调试、不依赖 LLM 是否 in the mood
- 措辞 (LLM): 让句子自然, 否则 "drill 你的弱项" 这种话像广告

约束:
- 一次最多 1 条 active suggestion (status=NULL or 'shown')
- snooze 期间不生成
- 用户 opt-out 时不生成
- profile 不存在或太空 (knowledge / patterns 都为 0) 时不生成
- 措辞必须含 rationale + evidence_refs (可审计)
"""
import json
import logging
import uuid
import datetime as dt
from typing import Any

from db import db
from llm import get_llm, LLMError

log = logging.getLogger(__name__)

# 建议过期时间: 24 小时未响应即过期, 下次 cron 重新生成
SUGGESTION_TTL_HOURS = 24

# 各类建议的优先级 + 冷却 (避免同一 kind 连续多天)
KIND_COOLDOWN_HOURS = {
    "pattern_drill": 48,      # 同一类 pattern 不要每天提
    "knowledge_refresh": 36,
    "goal_followup": 24,      # 周目标可以每天提一次
    "subject_review": 72,
}

# 决策阈值
PATTERN_MIN_OCCURRENCES = 3
PATTERN_MIN_CONFIDENCE = 0.7
KNOWLEDGE_LOW_MASTERY = 0.4
KNOWLEDGE_NEEDS_RECENT_PRACTICE = 1  # 至少做过 1 次, 否则不提 (没接触过的不算"弱")
SUBJECT_LOW_MASTERY = 0.5

LLM_MAX_TOKENS_WORDING = 250


# ============================================================
# 数据加载
# ============================================================

def _get_settings(conn, user_id: int) -> dict:
    row = conn.execute(
        "SELECT * FROM profile_settings WHERE owner_user_id = ?", (user_id,),
    ).fetchone()
    if row is None:
        return {
            "signals_enabled": True, "profile_enabled": True,
            "journal_volume_in_profile": True,
            "agent_enabled": True, "agent_snoozed_until": None,
        }
    return {
        "signals_enabled": bool(row["signals_enabled"]),
        "profile_enabled": bool(row["profile_enabled"]),
        "journal_volume_in_profile": bool(row["journal_volume_in_profile"]),
        "agent_enabled": bool(row["agent_enabled"]),
        "agent_snoozed_until": row["agent_snoozed_until"],
    }


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


def _get_active_suggestion(conn, user_id: int) -> dict | None:
    """正在 pending 的建议. 已 accept/dismiss 的不算; 24h 前的算过期."""
    cutoff = (dt.datetime.utcnow() - dt.timedelta(hours=SUGGESTION_TTL_HOURS)).isoformat()
    row = conn.execute("""
        SELECT * FROM agent_actions
        WHERE owner_user_id = ?
          AND agent_name = 'tutor'
          AND action_type = 'suggest'
          AND user_response IS NULL
          AND created_at > ?
        ORDER BY created_at DESC
        LIMIT 1
    """, (user_id, cutoff)).fetchone()
    if not row:
        return None
    return _row_to_suggestion(row)


def _row_to_suggestion(row) -> dict:
    payload = {}
    try:
        payload = json.loads(row["payload_json"] or "{}")
    except json.JSONDecodeError:
        pass
    return {
        "id": row["id"],
        "suggestion_id": row["suggestion_id"],
        "agent_name": row["agent_name"],
        "kind": payload.get("kind"),
        "wording": payload.get("wording"),
        "rationale": row["rationale"],
        "evidence_refs": payload.get("evidence_refs", {}),
        "accept_action": payload.get("accept_action"),
        "profile_version": row["profile_version"],
        "user_response": row["user_response"],
        "created_at": row["created_at"],
        "response_at": row["response_at"],
    }


def _kind_in_cooldown(conn, user_id: int, kind: str) -> bool:
    cooldown_h = KIND_COOLDOWN_HOURS.get(kind, 24)
    cutoff = (dt.datetime.utcnow() - dt.timedelta(hours=cooldown_h)).isoformat()
    row = conn.execute("""
        SELECT 1 FROM agent_actions
        WHERE owner_user_id = ?
          AND agent_name = 'tutor'
          AND action_type = 'suggest'
          AND payload_json LIKE ?
          AND created_at > ?
        LIMIT 1
    """, (user_id, f'%"kind": "{kind}"%', cutoff)).fetchone()
    return row is not None


# ============================================================
# 决策树
# ============================================================

# Procedural memory 调权: 多次拒绝就靠后, 多次接受就靠前
DISMISS_THRESHOLD = 0.7   # 拒绝率 ≥70% (sample ≥3) → 整个跳过
PREFER_BOOST = 0.8        # 接受率 ≥80% → 优先级提升 (跳过 cooldown 一次也行)


def _kind_strategy(profile: dict, kind: str) -> dict:
    """返回 { skip: bool, prefer: bool } — 由 procedural memory 决定."""
    strategies = ((profile.get("agent_strategies") or {}).get("tutor") or {})
    s = strategies.get(kind)
    if not s:
        return {"skip": False, "prefer": False}
    accept_rate = s.get("accept_rate", 0.5)
    sample_size = s.get("sample_size", 0)
    if sample_size < 3:
        return {"skip": False, "prefer": False}
    return {
        "skip": (1 - accept_rate) >= DISMISS_THRESHOLD,
        "prefer": accept_rate >= PREFER_BOOST,
    }


def _decide_kind(profile: dict, conn, user_id: int) -> dict | None:
    """返回 { kind, evidence } 或 None.

    优先级: pattern_drill > knowledge_refresh > goal_followup > subject_review

    Procedural memory (P2.5) 调整:
    - 某 kind 历史拒绝率 ≥70% (sample ≥3) → 跳过该 kind
    - 某 kind 历史接受率 ≥80% → 跳过 cooldown, 直接出
    """
    # 1. 强 error_pattern
    patterns = profile.get("error_patterns") or []
    eligible_patterns = [
        p for p in patterns
        if p.get("occurrences", 0) >= PATTERN_MIN_OCCURRENCES
        and p.get("confidence", 0) >= PATTERN_MIN_CONFIDENCE
        and p.get("trend") != "weakening"
    ]
    pd_strategy = _kind_strategy(profile, "pattern_drill")
    if eligible_patterns and not pd_strategy["skip"] and (
        pd_strategy["prefer"] or not _kind_in_cooldown(conn, user_id, "pattern_drill")
    ):
        # 取 confidence × occurrences 最大的
        best = max(eligible_patterns, key=lambda p: p.get("confidence", 0) * p.get("occurrences", 1))
        return {
            "kind": "pattern_drill",
            "evidence": {
                "pattern_id": best.get("id"),
                "pattern_description": best.get("description"),
                "subject": best.get("subject"),
                "evidence_mistake_ids": best.get("evidence_mistake_ids", [])[:5],
                "occurrences": best.get("occurrences"),
            },
        }

    # 2. 弱知识点 (mastery 低 + 实际练过 + 不太久之前)
    knowledge = profile.get("knowledge") or {}
    weak: list[dict] = []
    today = dt.date.today()
    for subj, kps in knowledge.items():
        for kp_name, info in kps.items():
            if info.get("locked_by_user"):
                continue
            mastery = info.get("mastery", 0.5)
            n = info.get("practice_count", 0)
            if mastery < KNOWLEDGE_LOW_MASTERY and n >= KNOWLEDGE_NEEDS_RECENT_PRACTICE:
                # 离最近一次练习的天数 — 14-60 天的"印象在淡"窗口
                last = info.get("last_practiced_at")
                age_days = 999
                if last:
                    try:
                        age_days = (today - dt.date.fromisoformat(last[:10])).days
                    except (ValueError, TypeError):
                        pass
                if 7 <= age_days <= 60:
                    weak.append({
                        "subject": subj,
                        "knowledge_point": kp_name,
                        "mastery": mastery,
                        "age_days": age_days,
                    })
    kr_strategy = _kind_strategy(profile, "knowledge_refresh")
    if weak and not kr_strategy["skip"] and (
        kr_strategy["prefer"] or not _kind_in_cooldown(conn, user_id, "knowledge_refresh")
    ):
        # 按 (1-mastery) × age_days 排序, 越弱越久越优先
        weak.sort(key=lambda w: -(1 - w["mastery"]) * w["age_days"])
        chosen = weak[0]
        return {
            "kind": "knowledge_refresh",
            "evidence": chosen,
        }

    # 3. 周目标对齐
    gf_strategy = _kind_strategy(profile, "goal_followup")
    weekly = _current_week_goal(conn, user_id)
    if weekly and not gf_strategy["skip"] and (
        gf_strategy["prefer"] or not _kind_in_cooldown(conn, user_id, "goal_followup")
    ):
        return {
            "kind": "goal_followup",
            "evidence": {
                "goal_text": weekly["goal_text"],
                "focus_type": weekly["focus_type"],
                "week_start": weekly["week_start"],
            },
        }

    # 4. 整科薄弱 (整个学科平均 mastery < 0.5 且至少 5 个知识点有数据)
    sr_strategy = _kind_strategy(profile, "subject_review")
    if not sr_strategy["skip"] and (
        sr_strategy["prefer"] or not _kind_in_cooldown(conn, user_id, "subject_review")
    ):
        subj_avg: dict[str, tuple[float, int]] = {}
        for subj, kps in knowledge.items():
            ms = [info.get("mastery", 0.5) for info in kps.values()]
            if len(ms) >= 5:
                subj_avg[subj] = (sum(ms) / len(ms), len(ms))
        if subj_avg:
            weakest = min(subj_avg.items(), key=lambda x: x[1][0])
            if weakest[1][0] < SUBJECT_LOW_MASTERY:
                return {
                    "kind": "subject_review",
                    "evidence": {
                        "subject": weakest[0],
                        "avg_mastery": round(weakest[1][0], 2),
                        "sample_count": weakest[1][1],
                    },
                }

    return None


def _current_week_goal(conn, user_id: int) -> dict | None:
    """本周已设的目标."""
    today = dt.date.today()
    dow = today.weekday()  # 0=Mon
    week_start = (today - dt.timedelta(days=dow)).isoformat()
    row = conn.execute(
        "SELECT goal_text, focus_type, week_start FROM weekly_goals "
        "WHERE owner_user_id = ? AND week_start = ?",
        (user_id, week_start),
    ).fetchone()
    if not row:
        return None
    return {
        "goal_text": row["goal_text"],
        "focus_type": row["focus_type"],
        "week_start": row["week_start"],
    }


# ============================================================
# LLM 措辞 (决策已定, 让 LLM 写自然话)
# ============================================================

WORDING_PROMPT = """你是一个温和、克制的学习伙伴, 给一个初中生写一条建议. 不超过 60 字.

要求:
- 用第二人称 "你"
- 一句话讲清楚: 我观察到什么 + 想不想做什么
- 不要 "加油" "你真棒" "我相信你" 这种话, 也不要感叹号
- 必须给一个可以拒绝的余地, 例: "想不想..." "如果你愿意..." "可以跳过"
- 中文, 平实

建议类型: {kind}
观察到的事实 (基于她的画像):
{evidence}

只返回这句建议本身, 不要前后缀."""


def _generate_wording(decision: dict) -> str:
    """LLM 生成措辞. 失败时返回 fallback."""
    fallback = _fallback_wording(decision)
    llm = get_llm()
    if not llm.configured():
        return fallback
    prompt = WORDING_PROMPT.format(
        kind=decision["kind"],
        evidence=json.dumps(decision["evidence"], ensure_ascii=False, indent=2),
    )
    try:
        text = llm.chat(
            [{"role": "user", "content": prompt}],
            max_tokens=LLM_MAX_TOKENS_WORDING,
            temperature=0.4,
        )
        text = text.strip().strip('"').strip("「」").strip()
        if 5 < len(text) < 200:
            return text
    except (LLMError, Exception) as e:
        log.warning("tutor wording LLM failed: %s", e)
    return fallback


def _fallback_wording(decision: dict) -> str:
    """LLM 不可用时的硬编码版本."""
    kind = decision["kind"]
    ev = decision["evidence"]
    if kind == "pattern_drill":
        return f"我注意到你在「{ev['pattern_description'][:40]}」这类题上反复出问题. 想花 10 分钟攻一下吗?"
    if kind == "knowledge_refresh":
        return f"{ev['subject']} 的「{ev['knowledge_point']}」已经 {ev['age_days']} 天没碰. 印象在淡, 复习一下?"
    if kind == "goal_followup":
        return f"本周你定的目标: {ev['goal_text'][:40]}. 今天可以做点什么往前走?"
    if kind == "subject_review":
        return f"{ev['subject']} 整体掌握度偏低, 想不想挑一个具体知识点先攻一下?"
    return "想不想花 5 分钟看看自己的学习画像?"


# ============================================================
# Accept action 准备
# ============================================================

def _build_accept_action(decision: dict) -> dict:
    """决定 accept 时该执行什么操作. 返回结构化 action 描述, 由 routes 端在 accept 时执行."""
    kind = decision["kind"]
    ev = decision["evidence"]
    if kind == "pattern_drill":
        # 用 evidence_mistake_ids 的第一个生成类题
        mids = ev.get("evidence_mistake_ids", [])
        return {
            "type": "generate_practice",
            "source_mistake_id": mids[0] if mids else None,
            "count": 3,
            "navigate_to": "Practice",
        }
    if kind == "knowledge_refresh":
        # 暂不能直接基于 knowledge_point 生成 (现在的 generatePractice 要 mistake_id)
        # 让用户跳到错题本筛选这个知识点
        return {
            "type": "navigate",
            "navigate_to": "Mistakes",
            "filter": {"subject": ev.get("subject"), "knowledge_point": ev.get("knowledge_point")},
        }
    if kind == "goal_followup":
        return {
            "type": "navigate",
            "navigate_to": "Plan",
        }
    if kind == "subject_review":
        return {
            "type": "navigate",
            "navigate_to": "Mistakes",
            "filter": {"subject": ev.get("subject")},
        }
    return {"type": "acknowledge"}


# ============================================================
# 顶层入口
# ============================================================

def maybe_generate_for_user(user_id: int, force: bool = False) -> dict:
    """对某用户尝试生成 1 条建议. 不一定真生成 (规则不命中或 cooldown 都返回 None).

    返回: {generated: bool, reason?: str, suggestion?: {...}}
    """
    with db() as conn:
        settings = _get_settings(conn, user_id)
        if not settings["agent_enabled"]:
            return {"generated": False, "reason": "agent_disabled"}

        # snooze
        if settings["agent_snoozed_until"]:
            try:
                snooze_until = dt.date.fromisoformat(settings["agent_snoozed_until"][:10])
                if dt.date.today() <= snooze_until:
                    return {"generated": False, "reason": "snoozed"}
            except (ValueError, TypeError):
                pass

        # 已有 active 建议 → 不重复
        if not force and _get_active_suggestion(conn, user_id):
            return {"generated": False, "reason": "active_suggestion_exists"}

        prof = _get_latest_profile(conn, user_id)
        if not prof:
            return {"generated": False, "reason": "no_profile"}
        profile, profile_version = prof

        decision = _decide_kind(profile, conn, user_id)
        if not decision:
            return {"generated": False, "reason": "no_eligible_kind"}

        wording = _generate_wording(decision)
        accept_action = _build_accept_action(decision)
        suggestion_id = uuid.uuid4().hex

        rationale = f"{decision['kind']}: " + json.dumps(decision["evidence"], ensure_ascii=False)[:200]
        payload = {
            "kind": decision["kind"],
            "wording": wording,
            "evidence_refs": decision["evidence"],
            "accept_action": accept_action,
        }

        cur = conn.execute("""
            INSERT INTO agent_actions
                (owner_user_id, agent_name, action_type, suggestion_id,
                 payload_json, rationale, profile_version)
            VALUES (?, 'tutor', 'suggest', ?, ?, ?, ?)
        """, (user_id, suggestion_id, json.dumps(payload, ensure_ascii=False),
              rationale, profile_version))
        new_id = cur.lastrowid

        log.info("tutor suggestion generated user=%s kind=%s id=%s",
                 user_id, decision["kind"], suggestion_id)

        # 返回完整 suggestion 给 caller
        row = conn.execute("SELECT * FROM agent_actions WHERE id = ?", (new_id,)).fetchone()
        return {"generated": True, "suggestion": _row_to_suggestion(row)}


def maybe_generate_for_all_users() -> list[dict]:
    """cron 入口."""
    with db() as conn:
        users = conn.execute(
            "SELECT id FROM users WHERE role = 'student'"
        ).fetchall()
    results = []
    for u in users:
        try:
            r = maybe_generate_for_user(u["id"])
            r["user_id"] = u["id"]
            results.append(r)
        except Exception as e:
            log.exception("tutor generate failed for user %s", u["id"])
            results.append({"user_id": u["id"], "error": str(e)})
    return results
