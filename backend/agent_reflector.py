"""Reflector Agent (P4) — 元认知伙伴.

只做一件事: 给定一个学习事件 (做错/创建错题/标掌握), 生成 1 个开放问题让她回答.

⚠️⚠️⚠️ 她的回答**永远不**经过这个模块. 回答存在 reflections 表, kind='mistake_note' / 'free_write',
按已有的隐私保证, 永不喂 LLM. 本模块只生成问题.

设计哲学:
- AI 不评判, 不总结
- 问题要"开放" (没有标准答案), 引发她自己思考
- 不要"你为什么错" (责备味), 用 "你卡在哪一步" "你当时是怎么想的" 这种探索语气
- 30 字以内, 一句话

调用模式: 端点每次调用都生成新问题 (LLM 便宜, ~$0.0005/次), 让她可以"换一个"
"""
import logging
import json
import random

from db import db
from llm import get_llm, LLMError

log = logging.getLogger(__name__)

LLM_MAX_TOKENS = 200

# Fallback questions (LLM 不可用时使用)
FALLBACK_QUESTIONS = {
    "mistake_create": [
        "这道题你卡在哪一步?",
        "你当时是怎么想的?",
        "如果再做一次, 你会先看什么?",
        "这道题最难的部分是什么?",
        "你觉得自己之前为什么没懂?",
    ],
    "mistake_mastered": [
        "之前哪里没懂? 现在怎么懂的?",
        '什么瞬间让你「啊, 原来是这样」?',
        "下次遇到同类题, 你会怎么开始?",
        "你想给那时候的自己说一句什么?",
    ],
    "practice_wrong": [
        "你做错了, 你觉得是哪一步走错了?",
        "提交前你有没有怀疑过这个答案?",
        "AI 的点评里, 哪句话最戳到你?",
        "下次遇到这种题, 你会先想什么?",
    ],
    "default": [
        "这件事你是怎么想的?",
        "你觉得这道题最关键的是什么?",
        "如果重来一次, 你会怎么做?",
    ],
}


PROMPT_BY_TRIGGER = {
    "mistake_create": """这位学生刚记录了一道错题. 帮她写一个开放问题, 引发她对"自己为什么错"的反思.

题目所在学科: {subject}
错因 (她自己标的): {reason}
知识点: {knowledge_point}

要求:
- 30 字以内
- 不要"为什么"开头 (责备味), 用"你卡在哪一步""你当时怎么想"这种探索语气
- 不评价, 只问
- 一句话
- 没有标准答案的问题最好

只返回这个问题本身. 不要引号.""",

    "mistake_mastered": """这位学生刚把一道之前的错题标记为"已掌握". 帮她写一个开放问题, 让她回顾"我是怎么搞懂的".

题目所在学科: {subject}
原错因: {reason}
知识点: {knowledge_point}

要求:
- 30 字以内
- 探索"那一刻是什么让你懂了"的瞬间, 不是"你掌握了什么"这种总结
- 一句话
- 没有标准答案

只返回问题本身. 不要引号.""",

    "practice_wrong": """这位学生在训练题里答错了一道. 帮她写一个开放问题, 引发她思考"哪一步出问题".

题目学科: {subject}
知识点: {knowledge_point}
她的回答 (供你判断思路): {student_answer}
正确答案: {expected_answer}
AI 的批改点评: {feedback}

要求:
- 30 字以内
- 不评判, 不总结. 让她自己说
- 一句话
- 重点在"她当时的思考过程", 不是"她的答案错在哪"

只返回问题本身. 不要引号.""",
}


def _load_context(conn, owner_id: int, source_table: str, source_id: int) -> dict:
    """根据 source 拿到生成问题需要的上下文 (题目/学科/错因等)."""
    ctx = {
        "subject": "学习", "reason": "未知", "knowledge_point": "",
        "student_answer": "", "expected_answer": "", "feedback": "",
    }
    if source_table == "mistakes":
        row = conn.execute(
            "SELECT subject, reason, knowledge_point, mastered "
            "FROM mistakes WHERE id = ? AND owner_user_id = ?",
            (source_id, owner_id),
        ).fetchone()
        if row:
            ctx.update({
                "subject": row["subject"] or "学习",
                "reason": row["reason"] or "未知",
                "knowledge_point": row["knowledge_point"] or "",
            })
            ctx["_mastered"] = bool(row["mastered"])
    elif source_table == "practice_items":
        row = conn.execute("""
            SELECT pi.student_answer, pi.expected_answer, pi.feedback, pi.is_correct,
                   ps.subject, ps.knowledge_point
            FROM practice_items pi JOIN practice_sets ps ON ps.id = pi.set_id
            WHERE pi.id = ? AND ps.owner_user_id = ?
        """, (source_id, owner_id)).fetchone()
        if row:
            ctx.update({
                "subject": row["subject"] or "学习",
                "knowledge_point": row["knowledge_point"] or "",
                "student_answer": (row["student_answer"] or "")[:200],
                "expected_answer": (row["expected_answer"] or "")[:200],
                "feedback": (row["feedback"] or "")[:300],
            })
            ctx["_is_correct"] = bool(row["is_correct"])
    return ctx


def _trigger_for(source_table: str, ctx: dict) -> str:
    if source_table == "mistakes":
        return "mistake_mastered" if ctx.get("_mastered") else "mistake_create"
    if source_table == "practice_items":
        return "practice_wrong" if not ctx.get("_is_correct", True) else "default"
    return "default"


def _fallback(trigger: str) -> str:
    pool = FALLBACK_QUESTIONS.get(trigger) or FALLBACK_QUESTIONS["default"]
    return random.choice(pool)


def generate_question(owner_id: int, source_table: str, source_id: int) -> dict:
    """生成 1 个开放问题. 返回 { question, trigger, source_table, source_id, llm }
    llm: 'llm' (LLM 生成) | 'fallback' (硬编码池抽取)
    """
    with db() as conn:
        ctx = _load_context(conn, owner_id, source_table, source_id)
    trigger = _trigger_for(source_table, ctx)

    llm = get_llm()
    if not llm.configured() or trigger not in PROMPT_BY_TRIGGER:
        return {
            "question": _fallback(trigger),
            "trigger": trigger,
            "source_table": source_table,
            "source_id": source_id,
            "llm": "fallback",
        }

    prompt = PROMPT_BY_TRIGGER[trigger].format(
        subject=ctx["subject"],
        reason=ctx["reason"],
        knowledge_point=ctx["knowledge_point"] or "未知",
        student_answer=ctx["student_answer"] or "(未提供)",
        expected_answer=ctx["expected_answer"] or "(未提供)",
        feedback=ctx["feedback"] or "(无)",
    )

    try:
        text = llm.chat(
            [{"role": "user", "content": prompt}],
            max_tokens=LLM_MAX_TOKENS,
            temperature=0.7,  # 高一点温度让问题不重复
        )
        text = text.strip().strip('"').strip("「」").strip()
        # 截断 + 校验
        if 4 < len(text) <= 100:
            return {
                "question": text,
                "trigger": trigger,
                "source_table": source_table,
                "source_id": source_id,
                "llm": "llm",
            }
    except (LLMError, Exception) as e:
        log.warning("reflector LLM failed: %s", e)

    return {
        "question": _fallback(trigger),
        "trigger": trigger,
        "source_table": source_table,
        "source_id": source_id,
        "llm": "fallback",
    }
