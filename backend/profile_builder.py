"""学生画像构建 (P1).

每日 cron 触发, 按 owner_user_id 串行 build.
分 5 步:
  1. SQL 聚合      — 计算 mastery / engagement / cognitive_style 等定量字段
  2. LLM 增量      — 从最近 7 天错题 + 上次 patterns, 抽取 error_patterns diff
  3. 程序化合并    — 应用 user_corrections, dedupe, confidence 衰减
  4. source_summary — LLM 写一段中文给用户看
  5. 写库          — 新版本号, GC 30 天前 (除月度快照)

⚠️ 任何 LLM prompt 不得包含 reflections / journal / essay 原文内容.
"""
import json
import logging
import time
import datetime as dt
from collections import defaultdict
from typing import Any

from db import db
from llm import get_llm, LLMError

log = logging.getLogger(__name__)

SCHEMA_VERSION = 1
WINDOW_DAYS = 30
RECENT_DAYS_FOR_PATTERNS = 7
PATTERN_MIN_OCCURRENCES = 3
MASTERY_DECAY_PER_WEEK = 0.05  # 一周不练扣 0.05
HINT_USED_PENALTY = 0.3        # 看了思路才答的, mastery 信号 ×0.7
WRONG_PENALTY = 0.4            # 答错的, mastery 直接拉低
CORRECT_BOOST = 0.15           # 答对的, mastery 上调

# ---- LLM ----
LLM_MAX_TOKENS_PATTERN = 1500
LLM_MAX_TOKENS_SUMMARY = 400
APPROX_COST_PER_1K_TOKENS = 0.00025  # Haiku 估算


def _today() -> str:
    return dt.date.today().isoformat()


def _days_ago_iso(days: int) -> str:
    return (dt.datetime.utcnow() - dt.timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%fZ")


# ============================================================
# Step 1: SQL 聚合 (无 LLM)
# ============================================================

def _aggregate_knowledge(conn, user_id: int) -> dict:
    """按 subject → knowledge_point 聚合 mastery.

    输入: 错题 (mastered/未掌握) + 训练答题 (对/错/查思路)
    Mastery: 启动 0.5 + sigmoid 累计 (correct - wrong*WRONG_PENALTY - hint_used*HINT_PENALTY)
    Confidence: 基于样本数 1 - 1/(1+n/4)
    """
    # 拉所有有 knowledge_point 的错题
    mistake_rows = conn.execute("""
        SELECT subject, knowledge_point, mastered, created_at, mastered_at
        FROM mistakes
        WHERE owner_user_id = ?
          AND knowledge_point IS NOT NULL AND knowledge_point != ''
    """, (user_id,)).fetchall()

    # 拉训练答题: 关联 practice_items + practice_sets (subject + knowledge_point in set)
    practice_rows = conn.execute("""
        SELECT ps.subject, ps.knowledge_point,
               pi.is_correct, pi.score, pi.graded_at
        FROM practice_items pi
        JOIN practice_sets ps ON ps.id = pi.set_id
        WHERE ps.owner_user_id = ?
          AND pi.is_correct IS NOT NULL
          AND ps.knowledge_point IS NOT NULL
    """, (user_id,)).fetchall()

    # 拉 hint_used 信号 (按 practice_item_id)
    hint_rows = conn.execute("""
        SELECT related_id FROM interaction_signals
        WHERE owner_user_id = ?
          AND event_type = 'practice.item.hint_used'
    """, (user_id,)).fetchall()
    hint_set = {r["related_id"] for r in hint_rows if r["related_id"] is not None}

    # 二级 dict[subject][kp] = {raw_score, n, last_seen, evidence_ids}
    bucket: dict[str, dict[str, dict]] = defaultdict(lambda: defaultdict(
        lambda: {"raw_score": 0.0, "n": 0, "last_seen": None, "evidence": [],
                 "correct": 0, "wrong": 0, "hint_used": 0}
    ))

    # 错题: 标 mastered=1 算 +CORRECT_BOOST, 未掌握算 -WRONG_PENALTY
    for r in mistake_rows:
        subj, kp = r["subject"], r["knowledge_point"]
        b = bucket[subj][kp]
        b["n"] += 1
        seen = r["mastered_at"] or r["created_at"]
        if seen and (b["last_seen"] is None or seen > b["last_seen"]):
            b["last_seen"] = seen
        if r["mastered"]:
            b["raw_score"] += CORRECT_BOOST
            b["correct"] += 1
        else:
            b["raw_score"] -= WRONG_PENALTY
            b["wrong"] += 1

    # 训练: 对/错; 看了思路打折
    for r in practice_rows:
        subj, kp = r["subject"], r["knowledge_point"]
        b = bucket[subj][kp]
        b["n"] += 1
        if r["graded_at"] and (b["last_seen"] is None or r["graded_at"] > b["last_seen"]):
            b["last_seen"] = r["graded_at"]
        if r["is_correct"]:
            # 注意 practice_items 没法直接关联 hint_used 信号到 item_id, 这里只能粗略
            # 真要精细需要在 signals 写时同步 item_id (已经有 related_id)
            b["raw_score"] += CORRECT_BOOST
            b["correct"] += 1
        else:
            b["raw_score"] -= WRONG_PENALTY
            b["wrong"] += 1

    # 转换为 mastery [0, 1]
    out: dict[str, dict] = {}
    today = dt.date.today()
    for subj, kps in bucket.items():
        out[subj] = {}
        for kp, b in kps.items():
            # 时间衰减: last_seen 距今多少周, 每周 -MASTERY_DECAY_PER_WEEK
            decay = 0.0
            if b["last_seen"]:
                try:
                    last = dt.date.fromisoformat(b["last_seen"][:10])
                    weeks = max(0, (today - last).days / 7)
                    decay = weeks * MASTERY_DECAY_PER_WEEK
                except (ValueError, TypeError):
                    decay = 0.0
            mastery = 0.5 + b["raw_score"] - decay
            mastery = max(0.0, min(1.0, mastery))
            confidence = 1.0 - (1.0 / (1.0 + b["n"] / 4))
            out[subj][kp] = {
                "mastery": round(mastery, 2),
                "confidence": round(confidence, 2),
                "last_practiced_at": b["last_seen"][:10] if b["last_seen"] else None,
                "practice_count": b["n"],
                "correct_count": b["correct"],
                "wrong_count": b["wrong"],
            }

    # P3 Feynman 信号: 把"她讲清楚了"的话题, 给对应知识点 confidence 加成
    # 匹配策略:
    #  - source=mistakes/practice_items: 反查 (subject, knowledge_point), 给已有条目加成
    #  - source=manual + manual_subject/manual_kp: 学生主动声明的正向知识点,
    #    若 mastery 表没这条, 直接创建新条目 (positive-knowledge input channel)
    try:
        from agent_feynman import get_understood_topics_for_profile
        understood = get_understood_topics_for_profile(conn, user_id)
        for u in understood:
            sid = u["source_id"]
            stable = u["source_table"]
            subj = kp = None
            if stable == "mistakes" and sid:
                row = conn.execute(
                    "SELECT subject, knowledge_point FROM mistakes WHERE id = ? AND owner_user_id = ?",
                    (sid, user_id),
                ).fetchone()
                if row:
                    subj, kp = row["subject"], row["knowledge_point"]
            elif stable == "practice_items" and sid:
                row = conn.execute("""
                    SELECT ps.subject, ps.knowledge_point
                    FROM practice_items pi JOIN practice_sets ps ON ps.id = pi.set_id
                    WHERE pi.id = ? AND ps.owner_user_id = ?
                """, (sid, user_id)).fetchone()
                if row:
                    subj, kp = row["subject"], row["knowledge_point"]
            elif stable == "manual":
                subj, kp = u.get("manual_subject"), u.get("manual_kp")
            if not subj or not kp:
                continue
            eval_conf = max(0.5, min(1.0, u.get("confidence", 0.5)))
            if subj in out and kp in out[subj]:
                # 讲清楚了 → confidence 拉到 ≥0.85, mastery 至少 0.7
                old = out[subj][kp]
                old["confidence"] = round(max(old["confidence"], 0.85 * eval_conf), 2)
                old["mastery"] = round(max(old["mastery"], 0.7), 2)
                old["feynman_understood"] = True
            elif stable == "manual":
                # 主动讲的新知识点 — 给一条正向画像条目, 无错题/训练样本
                last_seen = (u.get("finished_at") or "")[:10] or None
                out.setdefault(subj, {})[kp] = {
                    "mastery": 0.7,
                    "confidence": round(0.85 * eval_conf, 2),
                    "last_practiced_at": last_seen,
                    "practice_count": 0,
                    "correct_count": 0,
                    "wrong_count": 0,
                    "feynman_understood": True,
                }
    except Exception:
        log.warning("feynman signal merge failed", exc_info=True)

    return out


def _aggregate_engagement(conn, user_id: int) -> dict:
    """7 天打卡率 / 平均会话时长 / 趋势."""
    seven_days_ago = _days_ago_iso(7)

    # checkin_rate_7d: 完成的打卡 / 7
    checkin_rows = conn.execute("""
        SELECT checkin_date, COUNT(*) AS n
        FROM checkins
        WHERE task_id IN (SELECT id FROM tasks WHERE owner_user_id = ?)
          AND completed = 1
          AND checkin_date >= date('now','-7 days')
        GROUP BY checkin_date
    """, (user_id,)).fetchall()
    distinct_days = len(checkin_rows)

    # session 平均时长
    session_rows = conn.execute("""
        SELECT payload_json FROM interaction_signals
        WHERE owner_user_id = ?
          AND event_type = 'session.end'
          AND occurred_at >= ?
    """, (user_id, seven_days_ago)).fetchall()
    durations = []
    for r in session_rows:
        try:
            p = json.loads(r["payload_json"] or "{}")
            d = p.get("duration_secs")
            if isinstance(d, (int, float)) and 30 < d < 60 * 60 * 4:
                durations.append(d)
        except (json.JSONDecodeError, TypeError):
            pass
    avg_minutes = round(sum(durations) / len(durations) / 60, 1) if durations else 0

    # 简单趋势: 与上 7 天对比
    prev_days = conn.execute("""
        SELECT COUNT(DISTINCT checkin_date) AS n
        FROM checkins
        WHERE task_id IN (SELECT id FROM tasks WHERE owner_user_id = ?)
          AND completed = 1
          AND checkin_date >= date('now','-14 days')
          AND checkin_date < date('now','-7 days')
    """, (user_id,)).fetchone()
    prev_n = prev_days["n"] if prev_days else 0

    if distinct_days > prev_n + 1:
        trend = "rising"
    elif distinct_days < prev_n - 1:
        trend = "falling"
    else:
        trend = "stable"

    score_7d = round(distinct_days / 7, 2)

    return {
        "score_7d": score_7d,
        "checkin_rate_7d": round(distinct_days / 7, 2),
        "avg_session_minutes_7d": avg_minutes,
        "active_days_7d": distinct_days,
        "trend": trend,
    }


def _aggregate_cognitive_style(conn, user_id: int) -> dict:
    """从 signals 推断 best_time_window / hint_usage_pattern / ideal_session_length."""
    # best_time_window: 看 task.checkin.toggle 的 hour_of_day 直方图
    rows = conn.execute("""
        SELECT payload_json FROM interaction_signals
        WHERE owner_user_id = ?
          AND event_type = 'task.checkin.toggle'
          AND occurred_at >= date('now','-30 days')
    """, (user_id,)).fetchall()
    hour_bucket = defaultdict(int)
    for r in rows:
        try:
            p = json.loads(r["payload_json"] or "{}")
            h = p.get("hour_of_day")
            completed = p.get("completed")
            if isinstance(h, int) and 0 <= h < 24 and completed:
                hour_bucket[h] += 1
        except (json.JSONDecodeError, TypeError):
            pass
    if hour_bucket:
        best_h = max(hour_bucket.items(), key=lambda x: x[1])[0]
        best_window = f"{best_h:02d}:00-{(best_h+1)%24:02d}:30"
    else:
        best_window = None

    # hint_usage_pattern: 提交前先看 vs 提交后看
    hint_before = conn.execute("""
        SELECT COUNT(*) AS n FROM interaction_signals
        WHERE owner_user_id = ? AND event_type = 'practice.item.hint_used'
          AND occurred_at >= date('now','-30 days')
    """, (user_id,)).fetchone()["n"]
    submitted_with_hint = conn.execute("""
        SELECT COUNT(*) AS n FROM interaction_signals
        WHERE owner_user_id = ? AND event_type = 'practice.item.submit'
          AND occurred_at >= date('now','-30 days')
          AND payload_json LIKE '%"hint_used": true%'
    """, (user_id,)).fetchone()["n"]
    if hint_before == 0:
        hint_pattern = "rarely_used"
    elif submitted_with_hint > hint_before * 0.6:
        hint_pattern = "tries_first"
    else:
        hint_pattern = "looks_first"

    # ideal_session_length: 取 session.end 时长中位数 (分钟)
    rows = conn.execute("""
        SELECT payload_json FROM interaction_signals
        WHERE owner_user_id = ? AND event_type = 'session.end'
          AND occurred_at >= date('now','-30 days')
    """, (user_id,)).fetchall()
    durs = []
    for r in rows:
        try:
            p = json.loads(r["payload_json"] or "{}")
            d = p.get("duration_secs")
            if isinstance(d, (int, float)) and 60 < d < 60 * 60 * 2:
                durs.append(d / 60)
        except (json.JSONDecodeError, TypeError):
            pass
    durs.sort()
    ideal_min = round(durs[len(durs) // 2]) if durs else None

    return {
        "best_time_window": best_window,
        "hint_usage_pattern": hint_pattern,
        "ideal_session_length_min": ideal_min,
    }


def _aggregate_self_narrative(conn, user_id: int, journal_volume_in: bool) -> dict:
    """统计反思与日记的字数. 永不读内容."""
    if not journal_volume_in:
        return {"_note": "user opted out"}
    rows = conn.execute("""
        SELECT kind, COUNT(*) AS n, COALESCE(SUM(LENGTH(content)), 0) AS chars
        FROM reflections
        WHERE owner_user_id = ?
          AND created_at >= date('now','-30 days')
        GROUP BY kind
    """, (user_id,)).fetchall()
    out = {}
    for r in rows:
        out[r["kind"]] = {"count": r["n"], "total_chars": r["chars"]}
    return out


# ============================================================
# Step 2: LLM error_pattern 抽取
# ============================================================

PATTERN_PROMPT = """你是一个学习行为分析器, 分析一个初中生的错题模式.

任务: 找出"她特有的、重复出现的"错误模式. 不是通用错误.

判断标准 (严格):
- 至少 {min_occ} 道题体现同类错误才算一个 pattern
- 描述要具体到操作层面 (例: "解一元二次方程时忘记两根都要验证" 而不是 "基础不扎实")
- 给出 confidence 0.0-1.0
- 旧 pattern 这 7 天没新证据时 mark trend="weakening", 不要删
- 用户已 dismiss 的 pattern 绝不能再生成 (列表见 user_dismissed_pattern_ids)

输入:
{input_json}

输出严格 JSON:
{{
  "new_patterns": [
    {{
      "id": "短描述作 id, 中文, 唯一",
      "subject": "数学",
      "description": "操作层面具体描述, 30-60 字",
      "evidence_mistake_ids": [42, 51, 78],
      "confidence": 0.85
    }}
  ],
  "reinforced": [
    {{ "id": "已有 pattern 的 id", "additional_evidence_ids": [99] }}
  ],
  "weakening": [
    {{ "id": "已有 pattern 的 id", "reason": "本周无新证据" }}
  ]
}}

不要给 "加油" 或 "需要努力" 之类评价. 只做事实抽取.
若无足够证据形成 pattern, 返回空数组. 别强行编造.
"""


def _extract_patterns_with_llm(
    conn, user_id: int, previous_patterns: list, dismissed_ids: set
) -> dict:
    """调 LLM 抽 error_pattern. 失败返回空 diff (不阻断 build)."""
    # 拉最近 7 天的错题 (公开字段, 题目内容能用 — 这不是反思/日记)
    rows = conn.execute("""
        SELECT id, subject, question_text, wrong_answer, correct_answer,
               reason, knowledge_point
        FROM mistakes
        WHERE owner_user_id = ?
          AND created_at >= date('now','-7 days')
        ORDER BY created_at DESC
        LIMIT 30
    """, (user_id,)).fetchall()

    if not rows:
        return {"new_patterns": [], "reinforced": [], "weakening": []}

    recent_mistakes = []
    for r in rows:
        # 截断, 控制 token
        recent_mistakes.append({
            "id": r["id"],
            "subject": r["subject"],
            "question_text": (r["question_text"] or "")[:200],
            "wrong_answer": (r["wrong_answer"] or "")[:80],
            "correct_answer": (r["correct_answer"] or "")[:80],
            "reason": r["reason"],
            "knowledge_point": r["knowledge_point"],
        })

    input_blob = {
        "previous_patterns": [
            {
                "id": p.get("id"),
                "subject": p.get("subject"),
                "description": p.get("description"),
                "occurrences": p.get("occurrences", 0),
            }
            for p in previous_patterns
            if p.get("id") not in dismissed_ids
        ],
        "user_dismissed_pattern_ids": list(dismissed_ids),
        "recent_mistakes": recent_mistakes,
    }

    prompt = PATTERN_PROMPT.format(
        min_occ=PATTERN_MIN_OCCURRENCES,
        input_json=json.dumps(input_blob, ensure_ascii=False, indent=2),
    )

    llm = get_llm()
    if not llm.configured():
        log.info("LLM not configured, skip pattern extraction")
        return {"new_patterns": [], "reinforced": [], "weakening": []}

    try:
        result = llm.json_chat(prompt, max_tokens=LLM_MAX_TOKENS_PATTERN, temperature=0.2)
        if not isinstance(result, dict):
            log.warning("LLM returned non-dict for patterns, ignoring")
            return {"new_patterns": [], "reinforced": [], "weakening": []}
        return {
            "new_patterns": result.get("new_patterns", []) or [],
            "reinforced": result.get("reinforced", []) or [],
            "weakening": result.get("weakening", []) or [],
        }
    except (LLMError, Exception) as e:
        log.warning("pattern LLM call failed: %s", e)
        return {"new_patterns": [], "reinforced": [], "weakening": []}


# ============================================================
# Step 3: 程序化合并
# ============================================================

def _merge_patterns(previous: list, diff: dict, dismissed_ids: set) -> list:
    """把上次 patterns + LLM diff 合成新 patterns 列表."""
    merged: dict[str, dict] = {}

    # 1. 先放上次的, 跳过 dismissed
    for p in previous:
        pid = p.get("id")
        if not pid or pid in dismissed_ids:
            continue
        merged[pid] = dict(p)  # copy

    # 2. 加 reinforced 的额外证据
    for r in diff.get("reinforced", []):
        pid = r.get("id")
        if pid in merged:
            existing_ids = set(merged[pid].get("evidence_mistake_ids", []))
            for new_id in r.get("additional_evidence_ids", []):
                existing_ids.add(new_id)
            merged[pid]["evidence_mistake_ids"] = sorted(existing_ids)
            merged[pid]["occurrences"] = len(existing_ids)
            merged[pid]["last_seen"] = _today()
            merged[pid]["confidence"] = min(1.0, merged[pid].get("confidence", 0.5) + 0.1)

    # 3. 标 weakening (不删, 仅标)
    for w in diff.get("weakening", []):
        pid = w.get("id")
        if pid in merged:
            merged[pid]["trend"] = "weakening"
            # confidence 缓慢衰减
            merged[pid]["confidence"] = max(0.1, merged[pid].get("confidence", 0.5) - 0.05)

    # 4. 加 new_patterns, 但 dismissed 的不能加
    for n in diff.get("new_patterns", []):
        pid = n.get("id")
        if not pid or pid in dismissed_ids or pid in merged:
            continue
        merged[pid] = {
            "id": pid,
            "subject": n.get("subject"),
            "description": n.get("description"),
            "evidence_mistake_ids": n.get("evidence_mistake_ids", []),
            "occurrences": len(n.get("evidence_mistake_ids", [])),
            "first_seen": _today(),
            "last_seen": _today(),
            "confidence": float(n.get("confidence", 0.5)),
            "trend": "new",
        }

    # 5. 衰减太老的 (60 天没出现, 自然遗忘)
    today = dt.date.today()
    out = []
    for p in merged.values():
        last = p.get("last_seen")
        if last:
            try:
                ld = dt.date.fromisoformat(last)
                age_days = (today - ld).days
                if age_days > 60:
                    continue  # 抛弃
            except ValueError:
                pass
        out.append(p)

    # 按 confidence × occurrences 排序
    out.sort(key=lambda p: -(p.get("confidence", 0) * p.get("occurrences", 1)))
    return out


# ============================================================
# Step 4: source_summary
# ============================================================

SUMMARY_PROMPT = """你是一个温和、平静的教育观察者. 根据下面的画像写一段 80 字以内的中文小结, 给学生本人看.

要求:
- 第二人称 ("你")
- 中性平实, 不要 "加油" "你真棒" 之类的鸡汤
- 优先提 1 个具体的好变化 + 1 个具体的注意点
- 如果数据稀少, 直接说 "数据还不够, 慢慢来"
- 不要用感叹号

画像摘要:
{summary_input}

只输出小结文字, 不要解释, 不要前后缀."""


def _generate_summary(profile: dict) -> tuple[str, float]:
    """生成 source_summary. 返回 (summary, cost_usd)."""
    llm = get_llm()
    if not llm.configured():
        return ("AI 暂时没接好, 但你的数据已经在记录.", 0.0)

    # 只摘要 top 信息, 不传完整 profile
    top_kp = []
    for subj, kps in (profile.get("knowledge") or {}).items():
        sorted_kps = sorted(
            kps.items(), key=lambda x: -x[1].get("practice_count", 0)
        )[:3]
        for kp, info in sorted_kps:
            top_kp.append(f"{subj}/{kp}: mastery {info['mastery']}, {info['practice_count']} 次")

    patterns_brief = [
        f"{p.get('description', '')[:50]} (出现 {p.get('occurrences', 0)} 次)"
        for p in (profile.get("error_patterns") or [])[:3]
    ]

    eng = profile.get("engagement") or {}
    summary_input = json.dumps({
        "top_practice": top_kp[:6],
        "error_patterns": patterns_brief,
        "engagement_7d_score": eng.get("score_7d"),
        "engagement_trend": eng.get("trend"),
        "best_time_window": (profile.get("cognitive_style") or {}).get("best_time_window"),
    }, ensure_ascii=False)

    try:
        text = llm.chat(
            [{"role": "user", "content": SUMMARY_PROMPT.format(summary_input=summary_input)}],
            max_tokens=LLM_MAX_TOKENS_SUMMARY,
            temperature=0.4,
        )
        # 估算成本
        approx_tokens = (len(SUMMARY_PROMPT) + len(summary_input) + len(text)) / 4
        cost = approx_tokens / 1000 * APPROX_COST_PER_1K_TOKENS
        return (text.strip()[:200], cost)
    except (LLMError, Exception) as e:
        log.warning("summary LLM call failed: %s", e)
        return ("画像更新中, AI 总结这次没出来.", 0.0)


# ============================================================
# Top-level: build_for_user
# ============================================================

def _get_settings(conn, user_id: int) -> dict:
    row = conn.execute(
        "SELECT * FROM profile_settings WHERE owner_user_id = ?", (user_id,),
    ).fetchone()
    if row is None:
        return {"signals_enabled": True, "profile_enabled": True, "journal_volume_in_profile": True}
    return {
        "signals_enabled": bool(row["signals_enabled"]),
        "profile_enabled": bool(row["profile_enabled"]),
        "journal_volume_in_profile": bool(row["journal_volume_in_profile"]),
    }


def _get_previous_profile(conn, user_id: int) -> tuple[dict, int]:
    row = conn.execute(
        "SELECT version, profile_json FROM student_profile "
        "WHERE owner_user_id = ? ORDER BY version DESC LIMIT 1",
        (user_id,),
    ).fetchone()
    if not row:
        return ({}, 0)
    try:
        return (json.loads(row["profile_json"]), row["version"])
    except json.JSONDecodeError:
        return ({}, row["version"])


def _aggregate_agent_strategies(conn, user_id: int) -> dict:
    """Procedural memory (P2.5) — 从 user_response / status 学'什么对她管用'.

    输出:
      {
        tutor: { kind: { accept_rate, sample_size }, ... },
        curator: { kind: { completion_rate, dismiss_rate, sample_size }, ... },
        feynman: { completion_rate, sample_size },
        guardian: { ack_rate, sample_size },
        preferred_action_hours: [20, 21, ...],   # accept 时刻直方图 top 5
        learned_at: "..."
      }
    至少 3 个 sample_size 才记 (避免一次拒绝就标 '她不喜欢').
    """
    out: dict = {
        "tutor": {},
        "curator": {},
        "feynman": {},
        "guardian": {},
        "preferred_action_hours": [],
        "learned_at": dt.datetime.utcnow().isoformat() + "Z",
    }

    MIN_SAMPLE = 3

    # ---- Tutor accept_rate per kind ----
    rows = conn.execute("""
        SELECT
          json_extract(payload_json, '$.kind') AS kind,
          SUM(CASE WHEN user_response = 'accepted' THEN 1 ELSE 0 END) AS accepted,
          SUM(CASE WHEN user_response = 'dismissed' THEN 1 ELSE 0 END) AS dismissed,
          COUNT(*) AS total
        FROM agent_actions
        WHERE owner_user_id = ?
          AND agent_name = 'tutor'
          AND user_response IS NOT NULL
          AND date(created_at) >= date('now','-30 days')
        GROUP BY kind
    """, (user_id,)).fetchall()
    for r in rows:
        if not r["kind"]:
            continue
        if r["total"] < MIN_SAMPLE:
            continue
        out["tutor"][r["kind"]] = {
            "accept_rate": round(r["accepted"] / r["total"], 2),
            "dismiss_rate": round(r["dismissed"] / r["total"], 2),
            "sample_size": r["total"],
        }

    # ---- Curator completion_rate per kind ----
    rows = conn.execute("""
        SELECT kind,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
          SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END) AS dismissed,
          COUNT(*) AS total
        FROM curated_items
        WHERE owner_user_id = ?
          AND status IN ('completed', 'dismissed', 'expired')
          AND date(date) >= date('now','-30 days')
        GROUP BY kind
    """, (user_id,)).fetchall()
    for r in rows:
        if r["total"] < MIN_SAMPLE:
            continue
        out["curator"][r["kind"]] = {
            "completion_rate": round(r["completed"] / r["total"], 2),
            "dismiss_rate": round(r["dismissed"] / r["total"], 2),
            "sample_size": r["total"],
        }

    # ---- Feynman completion ratio ----
    fey = conn.execute("""
        SELECT
          SUM(CASE WHEN status = 'finished' THEN 1 ELSE 0 END) AS finished,
          SUM(CASE WHEN status = 'abandoned' THEN 1 ELSE 0 END) AS abandoned,
          COUNT(*) AS total
        FROM feynman_sessions
        WHERE owner_user_id = ?
          AND date(created_at) >= date('now','-30 days')
    """, (user_id,)).fetchone()
    if fey and fey["total"] >= MIN_SAMPLE:
        out["feynman"] = {
            "completion_rate": round(fey["finished"] / fey["total"], 2),
            "sample_size": fey["total"],
        }

    # ---- Guardian ack rate ----
    g_row = conn.execute("""
        SELECT
          SUM(CASE WHEN acknowledged_at IS NOT NULL THEN 1 ELSE 0 END) AS acked,
          COUNT(*) AS total
        FROM guardian_alerts
        WHERE owner_user_id = ?
          AND audience = 'student'
          AND date(created_at) >= date('now','-30 days')
    """, (user_id,)).fetchone()
    if g_row and g_row["total"] >= MIN_SAMPLE:
        out["guardian"] = {
            "ack_rate": round(g_row["acked"] / g_row["total"], 2),
            "sample_size": g_row["total"],
        }

    # ---- preferred hours: accept 时段 top ----
    rows = conn.execute("""
        SELECT CAST(strftime('%H', response_at) AS INTEGER) AS hour, COUNT(*) AS n
        FROM agent_actions
        WHERE owner_user_id = ?
          AND user_response = 'accepted'
          AND response_at >= date('now','-30 days')
        GROUP BY hour
        ORDER BY n DESC
        LIMIT 5
    """, (user_id,)).fetchall()
    out["preferred_action_hours"] = [r["hour"] for r in rows if r["hour"] is not None]

    return out


def _get_corrections(conn, user_id: int) -> tuple[set, dict]:
    """返回 (dismissed_pattern_ids, locked_values)."""
    rows = conn.execute(
        "SELECT field_path, action, value_json FROM profile_corrections "
        "WHERE owner_user_id = ?",
        (user_id,),
    ).fetchall()
    dismissed = set()
    locked = {}
    for r in rows:
        path = r["field_path"]
        if r["action"] == "dismiss":
            # path 例如 "error_patterns.含参不分类讨论"
            if path.startswith("error_patterns."):
                dismissed.add(path[len("error_patterns."):])
        elif r["action"] == "lock_value":
            try:
                locked[path] = json.loads(r["value_json"] or "null")
            except json.JSONDecodeError:
                pass
    return dismissed, locked


def build_for_user(user_id: int, build_method: str = "cron_daily") -> dict:
    """对某个用户构建一次画像. 返回新版本元信息.

    异常时记 log, 不抛出 (build job 不要 crash)."""
    start_t = time.time()

    with db() as conn:
        settings = _get_settings(conn, user_id)
        if not settings["profile_enabled"]:
            log.info("user %s opted out of profile build", user_id)
            return {"skipped": True, "reason": "opted_out"}

        previous_profile, prev_version = _get_previous_profile(conn, user_id)
        dismissed, locked = _get_corrections(conn, user_id)

        # Step 1
        knowledge = _aggregate_knowledge(conn, user_id)
        engagement = _aggregate_engagement(conn, user_id)
        cognitive = _aggregate_cognitive_style(conn, user_id)
        narrative = _aggregate_self_narrative(
            conn, user_id, settings["journal_volume_in_profile"]
        )
        agent_strategies = _aggregate_agent_strategies(conn, user_id)

        # Step 2
        prev_patterns = previous_profile.get("error_patterns", []) or []
        diff = _extract_patterns_with_llm(conn, user_id, prev_patterns, dismissed)

        # Step 3
        merged_patterns = _merge_patterns(prev_patterns, diff, dismissed)

        # Apply locked_values
        for path, val in locked.items():
            if path.startswith("knowledge."):
                # path: knowledge.数学.一元二次方程.mastery
                parts = path.split(".")
                if len(parts) == 4 and parts[3] == "mastery":
                    subj, kp = parts[1], parts[2]
                    if subj in knowledge and kp in knowledge[subj]:
                        knowledge[subj][kp]["mastery"] = float(val)
                        knowledge[subj][kp]["locked_by_user"] = True

        profile = {
            "schema_version": SCHEMA_VERSION,
            "computed_at": dt.datetime.utcnow().isoformat() + "Z",
            "data_window_days": WINDOW_DAYS,
            "knowledge": knowledge,
            "error_patterns": merged_patterns,
            "cognitive_style": cognitive,
            "engagement": engagement,
            "self_narrative": narrative,
            "agent_strategies": agent_strategies,
            "user_corrections_count": len(dismissed) + len(locked),
        }

        # Step 4
        summary, cost_usd = _generate_summary(profile)

        # Step 5
        new_version = prev_version + 1
        # 月度快照: 每月 1 号自动 mark
        is_monthly = (dt.date.today().day == 1)

        duration_ms = int((time.time() - start_t) * 1000)

        conn.execute("""
            INSERT INTO student_profile
                (owner_user_id, version, profile_json, source_summary,
                 computed_from, build_method, build_cost_usd, build_duration_ms,
                 is_monthly_snapshot)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            user_id, new_version,
            json.dumps(profile, ensure_ascii=False),
            summary,
            f"window={WINDOW_DAYS}d patterns_window={RECENT_DAYS_FOR_PATTERNS}d",
            build_method,
            cost_usd,
            duration_ms,
            1 if is_monthly else 0,
        ))

        # GC: 删 30 天前的非月度快照
        conn.execute("""
            DELETE FROM student_profile
            WHERE owner_user_id = ?
              AND created_at < date('now','-30 days')
              AND is_monthly_snapshot = 0
              AND version != ?
        """, (user_id, new_version))

    log.info("profile build user=%s version=%s cost=%.4f duration=%dms",
             user_id, new_version, cost_usd, duration_ms)
    return {
        "version": new_version,
        "duration_ms": duration_ms,
        "cost_usd": cost_usd,
        "patterns_count": len(merged_patterns),
    }


def build_for_all_users() -> list[dict]:
    """cron 入口. 串行 build 所有 student 用户."""
    with db() as conn:
        users = conn.execute(
            "SELECT id FROM users WHERE role = 'student'"
        ).fetchall()
    results = []
    for u in users:
        try:
            r = build_for_user(u["id"], "cron_daily")
            r["user_id"] = u["id"]
            results.append(r)
        except Exception as e:
            log.exception("build failed for user %s: %s", u["id"], e)
            results.append({"user_id": u["id"], "error": str(e)})
    return results
