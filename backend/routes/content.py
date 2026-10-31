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


@bp.get('/.well-known/edu-skills.json')
@bp.get('/api/skills')
def skill_manifest():
    response = jsonify({
        'schema_version': 1,
        'version': '2026-10-31.1',
        'name': 'Edu Skills',
        'base_url': 'https://edu.executor.life',
        'skills': [{
            'name': 'edu-learning',
            'description': '读取已授权的学习进度、考试、错题、课程与学习画像',
            'url': 'https://edu.executor.life/api/skills/edu-learning/SKILL.md',
        }],
        'authentication': {
            'documentation': 'public',
            'data': 'bearer',
            'login_url': 'https://edu.executor.life/api/auth/token-login',
            'token_type': 'Edu token',
            'health_mode_token_ttl_seconds': 28800,
        },
        'update_mode': 'pull',
    })
    response.headers['Cache-Control'] = 'public, max-age=300'
    response.headers['Access-Control-Allow-Origin'] = '*'
    return response


@bp.get('/api/skills/edu-learning/SKILL.md')
def learning_skill():
    from flask import send_file
    response = send_file(
        CONTENT_DIR / 'skills' / 'edu-learning' / 'SKILL.md',
        mimetype='text/markdown', conditional=True,
    )
    response.headers['Cache-Control'] = 'public, max-age=300'
    response.headers['Access-Control-Allow-Origin'] = '*'
    return response
