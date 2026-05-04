"""Reflector API (P4).

⚠️ 这个 blueprint 只生成"问题". 学生的回答走现有的 reflections 端点 (kind='mistake_note'),
   reflections 模块明令禁止与 LLM 交互. 隐私边界完整保留.
"""
import logging

from flask import Blueprint, jsonify, request, g

from auth import login_required
from agent_reflector import generate_question

bp = Blueprint("reflector", __name__)
log = logging.getLogger(__name__)

VALID_SOURCE_TABLES = {"mistakes", "practice_items"}


@bp.post("/api/reflector/question")
@login_required
def post_question():
    """body: { source_table, source_id }
    返回: { question, trigger, source_table, source_id, llm }
    """
    body = request.get_json(silent=True) or {}
    source_table = body.get("source_table")
    source_id = body.get("source_id")

    if source_table not in VALID_SOURCE_TABLES:
        return jsonify({"error": "invalid_source_table"}), 400
    try:
        source_id = int(source_id)
    except (TypeError, ValueError):
        return jsonify({"error": "invalid_source_id"}), 400

    result = generate_question(g.owner_id, source_table, source_id)
    return jsonify(result)
