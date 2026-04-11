"""Markdown 知识内容 (分析报告 + 方法卡). 无需登录."""
from flask import Blueprint, jsonify, abort

from constants import CONTENT_DIR

bp = Blueprint("content", __name__)


@bp.get("/api/content/<name>")
def get_content(name):
    if not all(c.isalnum() or c in "-_" for c in name):
        abort(400, "invalid name")
    path = CONTENT_DIR / f"{name}.md"
    if not path.exists():
        abort(404)
    return {"name": name, "content": path.read_text(encoding="utf-8")}


@bp.get("/api/content")
def list_content():
    items = []
    if CONTENT_DIR.exists():
        for p in sorted(CONTENT_DIR.glob("*.md")):
            items.append({"name": p.stem, "title": p.stem})
    return jsonify(items)
