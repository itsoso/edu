"""费曼模式 (P3) — 反向教学 / 学生教 AI.

哲学:
  - 真正建知识模型的时刻是"讲出来", 不是"做对了"
  - 此处 AI 装作刚学的初中同学, 不是老师
  - 不强制, 不超过 4 轮, 任何时候可结束
  - 信号回写画像 (理解透 → mastery × confidence 拉满; 机械记忆 → confidence 折半)
"""
import json
import logging
import datetime as dt

from db import db
from llm import get_llm, LLMError

log = logging.getLogger(__name__)

MAX_STUDENT_TURNS = 4
LLM_MAX_TOKENS_QUESTION = 250
LLM_MAX_TOKENS_ASSESSMENT = 400
APPROX_COST_PER_1K_TOKENS = 0.00025  # Haiku


# ============================================================
# Prompts — 关键: AI 装"同学", 不装老师
# ============================================================

CLASSMATE_SYSTEM = """你是一个初中生学习伙伴的小助手, 装作刚学到这个知识点的"初中同学", 现在请这位学生给你讲解.

身份与语气:
- 你是同学, 不是老师, 也不是 AI
- 别用"很好""你说得对""加油"这种评价/鼓励, 同学不会这样说话
- 不要展现"我其实知道答案"的优越感
- 用"我有点糊涂..."、"那 ___ 怎么办?"、"等等, 你刚说的 ___ 是什么意思?"这类同学口吻

任务:
- 阅读对话历史, 提一个让对方更深入解释的具体追问
- 追问要针对她"可能没讲清楚"的关键步骤, 不要问无关细节
- 一次只问 1 个问题, 不要列 ABC
- 如果你判断对方已经讲得足够透彻 (3 轮以内通常不会), 在问题前缀加 "[FINISHED] " 表示可以结束, 然后说一句感谢

输出: 直接是同学说的话, 不要加引号、不要 "AI:" 前缀."""


ASSESSMENT_PROMPT = """你是一个学习评估器, 看完一段"学生给同学讲解某知识点"的对话, 评估学生的理解深度.

判断标准:
- 'understood': 解释清楚、能回答追问、用自己的话表达
- 'mechanical': 知道公式或步骤但说不清原理, 只能复述
- 'confused': 解释里有错或越讲越乱

只看学生的发言, 不看 AI 的发言.

输出严格 JSON:
{
  "understood": "understood" | "mechanical" | "confused",
  "weak_points": ["..."],         // 学生没讲清楚或讲错的具体点, 0-3 条, 操作层面具体
  "confidence": 0.0-1.0,          // 评估自己的把握有多大
  "topic": "..."                   // 你判断这次讲的是什么知识点 (中文短语)
}

不要"加油"评价. 只做事实评估. weak_points 用第三人称客观描述, 不要直接对学生说话.

对话:
{conversation}
"""

OPENING_PROMPT_FROM_QUESTION = """这位学生刚做对了一道 {subject} 题, 现在请她给你 (装作同学) 讲讲为什么.

题目: {question}

写一句开场白 (60 字内), 装同学语气, 抛一个具体的"为什么"或"怎么想到的"的问题.
- 直接说话, 不要引号、前缀
- 表现出对某个关键步骤的好奇, 不要泛问"你能讲讲吗"
- 不评价 ("好厉害"那种), 只问

输出: 开场白本身."""

OPENING_PROMPT_FROM_KP = """这位学生刚标记自己已经"掌握"了 {subject} 的知识点 "{kp}".{learned_from_hint}

写一句开场白 (60 字内), 装初中同学语气, 让她给你讲讲核心要点.
- 直接说话, 不要引号
- 抛一个具体的小问题, 比如"我一直搞不懂 ___, 怎么理解?"或"___ 和 ___ 我老是混, 你怎么分?"
- 不评价

输出: 开场白本身."""


# ============================================================
# 数据加载
# ============================================================

def _load_source_context(
    conn,
    owner_id: int,
    source_table: str | None,
    source_id: int | None,
    manual_subject: str | None = None,
    manual_kp: str | None = None,
    manual_note: str | None = None,
) -> dict:
    """根据 source 拿到出题上下文 (subject, question/kp). 失败时返回 manual."""
    ctx = {"subject": "学习", "question": "", "kp": "", "kind": "manual", "learned_from": ""}
    # 主动发起: 学生自己声明 subject + kp + (可选) 来源note
    if source_table == "manual" and (manual_subject or manual_kp):
        ctx.update({
            "subject": manual_subject or "学习",
            "kp": manual_kp or "",
            "learned_from": (manual_note or "").strip(),
            "kind": "manual_kp",
        })
        return ctx
    if not source_table or not source_id:
        return ctx
    if source_table == "mistakes":
        row = conn.execute(
            "SELECT subject, question_text, knowledge_point FROM mistakes "
            "WHERE id = ? AND owner_user_id = ?",
            (source_id, owner_id),
        ).fetchone()
        if row:
            ctx.update({
                "subject": row["subject"] or "学习",
                "question": (row["question_text"] or "")[:300],
                "kp": row["knowledge_point"] or "",
                "kind": "mistake",
            })
    elif source_table == "practice_items":
        row = conn.execute("""
            SELECT pi.question_text, ps.subject, ps.knowledge_point
            FROM practice_items pi
            JOIN practice_sets ps ON ps.id = pi.set_id
            WHERE pi.id = ? AND ps.owner_user_id = ?
        """, (source_id, owner_id)).fetchone()
        if row:
            ctx.update({
                "subject": row["subject"] or "学习",
                "question": (row["question_text"] or "")[:300],
                "kp": row["knowledge_point"] or "",
                "kind": "practice",
            })
    return ctx


# ============================================================
# 顶层入口: start / turn / finish
# ============================================================

def start_session(
    owner_id: int,
    source_table: str | None,
    source_id: int | None,
    *,
    subject: str | None = None,
    knowledge_point: str | None = None,
    learned_from: str | None = None,
) -> dict:
    """创建一个新 session 并生成开场白. 返回 { session_id, opening_question, topic_seed }

    主动发起 (source_table='manual' + 传 subject/knowledge_point) 时, 开场白用 kp-context
    prompt, 并把 subject/kp/note 持久化到 feynman_sessions.manual_* 列, 供 profile_builder
    作为 mastery 信号读取.
    """
    with db() as conn:
        ctx = _load_source_context(
            conn, owner_id, source_table, source_id,
            manual_subject=subject,
            manual_kp=knowledge_point,
            manual_note=learned_from,
        )

    opening = _generate_opening(ctx)
    topic_seed = ctx.get("kp") or ctx.get("question", "")[:40] or "学习"

    convo = [
        {"role": "ai", "content": opening, "ts": _now_iso()},
    ]
    manual_subject_db = subject if ctx.get("kind") == "manual_kp" else None
    manual_kp_db = knowledge_point if ctx.get("kind") == "manual_kp" else None
    manual_note_db = (learned_from or "").strip() or None if ctx.get("kind") == "manual_kp" else None
    with db() as conn:
        cur = conn.execute("""
            INSERT INTO feynman_sessions
                (owner_user_id, source_table, source_id, topic_seed,
                 conversation_json, status, turn_count,
                 manual_subject, manual_knowledge_point, manual_source_note)
            VALUES (?, ?, ?, ?, ?, 'in_progress', 0, ?, ?, ?)
        """, (owner_id, source_table, source_id, topic_seed,
              json.dumps(convo, ensure_ascii=False),
              manual_subject_db, manual_kp_db, manual_note_db))
        sid = cur.lastrowid

    return {
        "session_id": sid,
        "opening_question": opening,
        "topic_seed": topic_seed,
        "max_turns": MAX_STUDENT_TURNS,
    }


def add_turn(owner_id: int, session_id: int, student_answer: str) -> dict:
    """学生提交一轮回答. 返回 { next_question?, finished, assessment? }

    流程:
      - 加学生回合
      - turn_count >= MAX_STUDENT_TURNS 时直接 finish
      - 否则生成下一个同学问题
      - 同学如果回了 [FINISHED] 前缀, 自动 finish
    """
    student_answer = (student_answer or "").strip()
    if not student_answer:
        return {"error": "empty_answer"}
    if len(student_answer) > 2000:
        student_answer = student_answer[:2000]

    with db() as conn:
        row = conn.execute(
            "SELECT * FROM feynman_sessions WHERE id = ? AND owner_user_id = ?",
            (session_id, owner_id),
        ).fetchone()
        if not row:
            return {"error": "not_found"}
        if row["status"] != "in_progress":
            return {"error": "session_finished"}

        try:
            convo = json.loads(row["conversation_json"])
        except json.JSONDecodeError:
            convo = []
        ctx_subject = row["topic_seed"]

    # 加学生这一轮
    convo.append({"role": "student", "content": student_answer, "ts": _now_iso()})
    new_turn_count = (row["turn_count"] or 0) + 1

    # 决定是否要继续问
    finished_by_count = new_turn_count >= MAX_STUDENT_TURNS

    next_q = None
    finished_by_ai = False
    if not finished_by_count:
        next_q_raw = _generate_next_question(convo, ctx_subject)
        if next_q_raw and next_q_raw.startswith("[FINISHED]"):
            finished_by_ai = True
            next_q = next_q_raw.replace("[FINISHED]", "").strip()
        else:
            next_q = next_q_raw

    if next_q:
        convo.append({"role": "ai", "content": next_q, "ts": _now_iso()})

    finished = finished_by_count or finished_by_ai

    assessment = None
    if finished:
        assessment = _evaluate(convo)

    # 写库
    with db() as conn:
        if finished:
            conn.execute("""
                UPDATE feynman_sessions
                SET conversation_json = ?, turn_count = ?, status = 'finished',
                    ai_assessment_json = ?, finished_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (json.dumps(convo, ensure_ascii=False), new_turn_count,
                  json.dumps(assessment, ensure_ascii=False) if assessment else None,
                  session_id))
        else:
            conn.execute("""
                UPDATE feynman_sessions
                SET conversation_json = ?, turn_count = ?
                WHERE id = ?
            """, (json.dumps(convo, ensure_ascii=False), new_turn_count, session_id))

    return {
        "session_id": session_id,
        "next_question": next_q if (finished_by_ai or not finished) else None,
        "finished": finished,
        "turn_count": new_turn_count,
        "assessment": assessment,
    }


def finish_session(owner_id: int, session_id: int, manual: bool = True) -> dict:
    """学生主动结束. 跑评估, 不再生成下一个问题."""
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM feynman_sessions WHERE id = ? AND owner_user_id = ?",
            (session_id, owner_id),
        ).fetchone()
        if not row:
            return {"error": "not_found"}
        if row["status"] != "in_progress":
            return {"error": "already_finished"}
        try:
            convo = json.loads(row["conversation_json"])
        except json.JSONDecodeError:
            convo = []

    if not any(t.get("role") == "student" for t in convo):
        # 一次都没答, 标 abandoned
        with db() as conn:
            conn.execute(
                "UPDATE feynman_sessions SET status = 'abandoned', finished_at = CURRENT_TIMESTAMP "
                "WHERE id = ?", (session_id,)
            )
        return {"finished": True, "abandoned": True}

    assessment = _evaluate(convo)
    with db() as conn:
        conn.execute("""
            UPDATE feynman_sessions
            SET status = 'finished', ai_assessment_json = ?, finished_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (json.dumps(assessment, ensure_ascii=False) if assessment else None, session_id))

    return {"finished": True, "assessment": assessment}


# ============================================================
# LLM 内部
# ============================================================

def _generate_opening(ctx: dict) -> str:
    llm = get_llm()
    if not llm.configured():
        # fallback
        if ctx.get("question"):
            return f"你刚做对那道题, 我有点糊涂. 你能讲讲怎么想到第一步的吗?"
        return f"你刚标记掌握了「{ctx.get('kp', '这个')}」, 我还没懂. 你能用一两句话讲讲核心吗?"
    prompt_tpl = OPENING_PROMPT_FROM_QUESTION if ctx.get("question") else OPENING_PROMPT_FROM_KP
    learned_from = (ctx.get("learned_from") or "").strip()
    learned_from_hint = f' (她刚在"{learned_from}"学到这个, 你没看过那份材料.)' if learned_from else ""
    prompt = prompt_tpl.format(
        subject=ctx.get("subject", "学习"),
        question=ctx.get("question", ""),
        kp=ctx.get("kp", "未知"),
        learned_from_hint=learned_from_hint,
    )
    try:
        text = llm.chat(
            [{"role": "user", "content": prompt}],
            max_tokens=LLM_MAX_TOKENS_QUESTION,
            temperature=0.5,
        )
        return text.strip().strip('"').strip("「」")[:200]
    except (LLMError, Exception) as e:
        log.warning("feynman opening failed: %s", e)
        return "你能讲讲核心思路吗?"


def _generate_next_question(convo: list, topic_seed: str) -> str:
    llm = get_llm()
    if not llm.configured():
        return "[FINISHED] 谢谢你, 我大概懂了."
    # 把 conversation 转成 chat messages
    messages = [{"role": "system", "content": CLASSMATE_SYSTEM}]
    for turn in convo:
        role = "assistant" if turn.get("role") == "ai" else "user"
        messages.append({"role": role, "content": turn.get("content", "")})
    try:
        text = llm.chat(messages, max_tokens=LLM_MAX_TOKENS_QUESTION, temperature=0.6)
        return text.strip().strip('"').strip("「」")[:300]
    except (LLMError, Exception) as e:
        log.warning("feynman next question failed: %s", e)
        return "[FINISHED] 谢谢你的讲解."


def _evaluate(convo: list) -> dict:
    """跑评估器, 返回 assessment dict (失败时返回 fallback)."""
    fallback = {
        "understood": "mechanical",
        "weak_points": [],
        "confidence": 0.3,
        "topic": "",
    }
    llm = get_llm()
    if not llm.configured():
        return fallback
    convo_text = "\n".join(
        f"{'同学' if t.get('role') == 'ai' else '学生'}: {t.get('content', '')}"
        for t in convo
    )
    try:
        result = llm.json_chat(
            ASSESSMENT_PROMPT.replace("{conversation}", convo_text),
            max_tokens=LLM_MAX_TOKENS_ASSESSMENT,
            temperature=0.2,
        )
        if not isinstance(result, dict):
            return fallback
        return {
            "understood": result.get("understood", "mechanical"),
            "weak_points": result.get("weak_points", []) or [],
            "confidence": float(result.get("confidence", 0.5)),
            "topic": result.get("topic", ""),
        }
    except (LLMError, Exception) as e:
        log.warning("feynman evaluation failed: %s", e)
        return fallback


def _now_iso() -> str:
    return dt.datetime.utcnow().isoformat() + "Z"


# ============================================================
# 给 profile_builder 用的查询: 最近 30 天 understood 的话题
# ============================================================

def get_understood_topics_for_profile(conn, user_id: int) -> list[dict]:
    """profile_builder 调这个, 把 'understood' session 信号转成 mastery confidence 提升.
    返回: [{ source_table, source_id, manual_subject, manual_kp, topic, confidence, finished_at }]
    (按时间倒序, 最多 50)

    manual sessions (source_table='manual') 会带上 manual_subject / manual_kp,
    profile_builder 据此直接写 mastery, 不需要回查 mistakes/practice_items.
    """
    rows = conn.execute("""
        SELECT source_table, source_id, ai_assessment_json, finished_at,
               manual_subject, manual_knowledge_point
        FROM feynman_sessions
        WHERE owner_user_id = ?
          AND status = 'finished'
          AND ai_assessment_json IS NOT NULL
          AND finished_at >= date('now', '-30 days')
        ORDER BY finished_at DESC
        LIMIT 50
    """, (user_id,)).fetchall()
    out = []
    for r in rows:
        try:
            a = json.loads(r["ai_assessment_json"])
        except (json.JSONDecodeError, TypeError):
            continue
        if a.get("understood") != "understood":
            continue
        out.append({
            "source_table": r["source_table"],
            "source_id": r["source_id"],
            "manual_subject": r["manual_subject"],
            "manual_kp": r["manual_knowledge_point"],
            "topic": a.get("topic", ""),
            "confidence": a.get("confidence", 0.5),
            "finished_at": r["finished_at"],
        })
    return out
