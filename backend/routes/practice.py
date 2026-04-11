"""二次训练: 出题 + 作答 + 批改."""
from flask import Blueprint, jsonify, request, abort, g

from db import db, row_to_dict, rows_to_dicts
from auth import login_required
from llm import (
    get_llm, LLMError,
    GENERATE_PRACTICE_PROMPT, GRADE_PRACTICE_PROMPT,
    _parse_json_loose,
)

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


@bp.post("/api/mistakes/<int:mid>/generate-practice")
@login_required
def generate_practice_from_mistake(mid):
    payload = request.get_json(force=True) or {}
    count = max(1, min(int(payload.get("count", 3)), 6))

    with db() as conn:
        mrow = conn.execute(
            "SELECT * FROM mistakes WHERE id = ? AND owner_user_id = ?",
            (mid, g.owner_id),
        ).fetchone()
    if not mrow:
        abort(404)

    prompt = GENERATE_PRACTICE_PROMPT.format(
        count=count,
        subject=mrow["subject"] or "",
        knowledge_point=mrow["knowledge_point"] or "待定",
        question_text=mrow["question_text"] or "(无)",
        reason=mrow["reason"] or "",
    )
    try:
        llm = get_llm()
        raw = llm.chat(
            [{"role": "system", "content": "你是一位资深初中教师, 擅长出类题。"},
             {"role": "user", "content": prompt}],
            temperature=0.4, max_tokens=2500, response_format_json=True,
        )
        data = _parse_json_loose(raw)
    except LLMError as e:
        return jsonify({"error": "llm_error", "detail": str(e)}), 502

    items = data.get("items") if isinstance(data, dict) else None
    if not items:
        return jsonify({"error": "no_items", "raw": raw[:200] if isinstance(raw, str) else ""}), 502

    with db() as conn:
        cur = conn.execute(
            """INSERT INTO practice_sets (owner_user_id, source_mistake_id, title, subject, knowledge_point)
               VALUES (?, ?, ?, ?, ?)""",
            (
                g.owner_id,
                mid,
                f"{mrow['subject'] or '训练'} · {mrow['knowledge_point'] or '类题'}",
                mrow["subject"],
                mrow["knowledge_point"],
            ),
        )
        set_id = cur.lastrowid
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
        row = conn.execute("SELECT * FROM practice_sets WHERE id = ?", (set_id,)).fetchone()
        return jsonify(_set_to_dict(conn, row))


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
