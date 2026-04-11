"""二次训练: 出题 + 作答 + 批改.

出题是异步的 (20 秒级别): 立即创建占位 set (status=generating),
后台填 items, 前端轮询 GET /api/practice/:id 直到 status=done.
单题批改依然同步 (5 秒, 不是痛点).
"""
import logging

from flask import Blueprint, jsonify, request, abort, g

from db import db, row_to_dict, rows_to_dicts
from auth import login_required
from llm import (
    get_llm, LLMError,
    GENERATE_PRACTICE_PROMPT, GRADE_PRACTICE_PROMPT,
    _parse_json_loose,
)
from background import submit as bg_submit

logger = logging.getLogger(__name__)
bp = Blueprint("practice", __name__)


def _set_to_dict(conn, s_row):
    d = row_to_dict(s_row)
    items = conn.execute(
        "SELECT * FROM practice_items WHERE set_id = ? ORDER BY id",
        (d["id"],),
    ).fetchall()
    d["items"] = rows_to_dicts(items)
    return d


@bp.get("/api/practice")
@login_required
def list_practice_sets():
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM practice_sets WHERE owner_user_id = ? ORDER BY created_at DESC",
            (g.owner_id,),
        ).fetchall()
        out = [_set_to_dict(conn, r) for r in rows]
    return jsonify(out)


@bp.get("/api/practice/<int:set_id>")
@login_required
def get_practice_set(set_id):
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM practice_sets WHERE id = ? AND owner_user_id = ?",
            (set_id, g.owner_id),
        ).fetchone()
        if not row:
            abort(404)
        return jsonify(_set_to_dict(conn, row))


def _run_generate_practice_bg(
    set_id: int, mistake_snapshot: dict, count: int
):
    """后台: 调 LLM 出题, 写入 practice_items, 把 set 状态改成 done."""
    prompt = GENERATE_PRACTICE_PROMPT.format(
        count=count,
        subject=mistake_snapshot["subject"] or "",
        knowledge_point=mistake_snapshot["knowledge_point"] or "待定",
        question_text=mistake_snapshot["question_text"] or "(无)",
        reason=mistake_snapshot["reason"] or "",
    )
    try:
        llm = get_llm()
        raw = llm.chat(
            [{"role": "system", "content": "你是一位资深初中教师, 擅长出类题。"},
             {"role": "user", "content": prompt}],
            temperature=0.4, max_tokens=2500, response_format_json=True,
        )
        data = _parse_json_loose(raw)
        items = data.get("items") if isinstance(data, dict) else None
        if not items:
            raise ValueError(f"no_items_in_response: {str(raw)[:200]}")

        with db() as conn:
            for it in items:
                conn.execute(
                    """INSERT INTO practice_items
                       (set_id, question_text, expected_answer, solution_steps, difficulty)
                       VALUES (?, ?, ?, ?, ?)""",
                    (
                        set_id,
                        it.get("question_text", ""),
                        it.get("expected_answer"),
                        it.get("solution_steps"),
                        it.get("difficulty"),
                    ),
                )
            conn.execute(
                "UPDATE practice_sets SET status='done', error_message=NULL WHERE id=?",
                (set_id,),
            )
        logger.info("generate practice done for set %s", set_id)
    except Exception as e:
        logger.exception("generate practice failed for set %s", set_id)
        with db() as conn:
            conn.execute(
                "UPDATE practice_sets SET status='failed', error_message=? WHERE id=?",
                (str(e)[:500], set_id),
            )


@bp.post("/api/mistakes/<int:mid>/generate-practice")
@login_required
def generate_practice_from_mistake(mid):
    """异步创建训练题集. 立即返回占位 set (status=generating) + 空 items."""
    payload = request.get_json(force=True) or {}
    count = max(1, min(int(payload.get("count", 3)), 6))

    with db() as conn:
        mrow = conn.execute(
            "SELECT * FROM mistakes WHERE id = ? AND owner_user_id = ?",
            (mid, g.owner_id),
        ).fetchone()
        if not mrow:
            abort(404)

        cur = conn.execute(
            """INSERT INTO practice_sets
               (owner_user_id, source_mistake_id, title, subject, knowledge_point, status)
               VALUES (?, ?, ?, ?, ?, 'generating')""",
            (
                g.owner_id,
                mid,
                f"{mrow['subject'] or '训练'} · {mrow['knowledge_point'] or '类题'}",
                mrow["subject"],
                mrow["knowledge_point"],
            ),
        )
        set_id = cur.lastrowid
        # 从请求线程拷贝参数, 后台线程不能碰 g
        mistake_snapshot = {
            "subject": mrow["subject"],
            "knowledge_point": mrow["knowledge_point"],
            "question_text": mrow["question_text"],
            "reason": mrow["reason"],
        }
        row = conn.execute("SELECT * FROM practice_sets WHERE id = ?", (set_id,)).fetchone()
        resp = _set_to_dict(conn, row)

    bg_submit(_run_generate_practice_bg, set_id, mistake_snapshot, count)
    return jsonify(resp), 202


@bp.post("/api/practice/items/<int:item_id>/grade")
@login_required
def grade_practice_item(item_id):
    payload = request.get_json(force=True) or {}
    student_answer = (payload.get("student_answer") or "").strip()
    if not student_answer:
        return jsonify({"error": "empty_answer"}), 400

    with db() as conn:
        item = conn.execute(
            """SELECT pi.*, ps.owner_user_id
               FROM practice_items pi JOIN practice_sets ps ON pi.set_id = ps.id
               WHERE pi.id = ?""",
            (item_id,),
        ).fetchone()
    if not item:
        abort(404)
    if item["owner_user_id"] != g.owner_id:
        abort(403)

    prompt = GRADE_PRACTICE_PROMPT.format(
        question_text=item["question_text"],
        expected_answer=item["expected_answer"] or "(未提供)",
        student_answer=student_answer,
    )
    try:
        llm = get_llm()
        raw = llm.chat(
            [{"role": "system", "content": "你是严谨但友善的初中老师, 批改要中肯。"},
             {"role": "user", "content": prompt}],
            temperature=0.1, max_tokens=600, response_format_json=True,
        )
        data = _parse_json_loose(raw)
    except LLMError as e:
        return jsonify({"error": "llm_error", "detail": str(e)}), 502

    is_correct = 1 if data.get("correct") else 0
    score = int(data.get("score") or (100 if is_correct else 0))
    feedback = data.get("feedback") or ""

    with db() as conn:
        conn.execute(
            """UPDATE practice_items
               SET student_answer = ?, is_correct = ?, score = ?, feedback = ?,
                   graded_at = CURRENT_TIMESTAMP
               WHERE id = ?""",
            (student_answer, is_correct, score, feedback, item_id),
        )
        row = conn.execute("SELECT * FROM practice_items WHERE id = ?", (item_id,)).fetchone()
    return jsonify(row_to_dict(row))


@bp.delete("/api/practice/<int:set_id>")
@login_required
def delete_practice_set(set_id):
    with db() as conn:
        row = conn.execute(
            "SELECT owner_user_id FROM practice_sets WHERE id = ?", (set_id,)
        ).fetchone()
        if not row:
            abort(404)
        if row["owner_user_id"] != g.owner_id:
            abort(403)
        conn.execute("DELETE FROM practice_sets WHERE id = ?", (set_id,))
    return {"ok": True}
