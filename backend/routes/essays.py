"""作文管理: 多来源录入 (拍照/Word/粘贴) + AI 批改.

三种录入流程:
1. photo: 上传照片 → 异步 OCR → ocr_done → 可选 AI 批改
2. document: 上传 docx → 同步解析文本 → 可选 AI 批改
3. text: 直接粘贴 → 可选 AI 批改
"""
import json
import logging
import uuid
from pathlib import Path

from flask import Blueprint, jsonify, request, abort, g, send_from_directory
from werkzeug.utils import secure_filename

from db import db, row_to_dict, rows_to_dicts
from auth import login_required
from llm import (
    get_llm, LLMError,
    ESSAY_OCR_PROMPT, ESSAY_ANALYSIS_PROMPT,
    parse_json_or_retry,
)
from llm_audit import llm_audit
from background import submit as bg_submit
from constants import (
    ESSAY_UPLOAD_DIR, ALLOWED_IMAGE_EXT, ALLOWED_ESSAY_DOC_EXT,
    MAX_ESSAY_PHOTO_BYTES, MAX_ESSAY_DOC_BYTES, MAX_ESSAY_TEXT_CHARS,
)

logger = logging.getLogger(__name__)
bp = Blueprint("essays", __name__)


def _essay_to_dict(row):
    d = row_to_dict(row)
    if not d:
        return None
    if d.get("ocr_result_json"):
        try:
            d["ocr_result"] = json.loads(d["ocr_result_json"])
        except Exception:
            d["ocr_result"] = None
    d.pop("ocr_result_json", None)
    if d.get("analysis_json"):
        try:
            d["analysis"] = json.loads(d["analysis_json"])
        except Exception:
            d["analysis"] = None
    d.pop("analysis_json", None)
    if d.get("file_path"):
        d["file_url"] = f"/api/essays/{d['id']}/file"
    else:
        d["file_url"] = None
    return d


def _extract_docx_text(path: Path) -> str:
    """从 .docx 文件提取纯文本."""
    from docx import Document as DocxDocument
    doc = DocxDocument(str(path))
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
    return "\n".join(paragraphs)


# ---------- 创建 ----------
@bp.post("/api/essays")
@login_required
def create_essay():
    """
    三种来源:
    1. photo: multipart form, file=图片, source_type=photo
    2. document: multipart form, file=docx, source_type=document
    3. text: JSON body, source_type=text, content=作文全文
    """
    content_type = request.content_type or ""

    if "multipart" in content_type:
        return _create_from_file()
    else:
        return _create_from_text()


def _create_from_file():
    source_type = request.form.get("source_type", "photo")
    if source_type not in ("photo", "document"):
        return jsonify({"error": "invalid_source_type"}), 400

    if "file" not in request.files:
        abort(400, "file required")
    f = request.files["file"]
    if not f.filename:
        abort(400, "empty filename")

    orig = secure_filename(f.filename) or "essay"
    ext = orig.rsplit(".", 1)[-1].lower() if "." in orig else ""

    if source_type == "photo":
        if ext not in ALLOWED_IMAGE_EXT:
            return jsonify({"error": f"unsupported image ext: .{ext}"}), 400
    else:
        if ext not in ALLOWED_ESSAY_DOC_EXT:
            return jsonify({"error": f"unsupported doc ext: .{ext}, 支持 .docx"}), 400

    user_dir = ESSAY_UPLOAD_DIR / str(g.owner_id)
    user_dir.mkdir(parents=True, exist_ok=True)
    uid = uuid.uuid4().hex[:12]
    disk_name = f"{uid}.{ext}"
    disk_path = user_dir / disk_name
    f.save(disk_path)

    file_size = disk_path.stat().st_size
    max_size = MAX_ESSAY_PHOTO_BYTES if source_type == "photo" else MAX_ESSAY_DOC_BYTES
    if file_size > max_size:
        disk_path.unlink(missing_ok=True)
        return jsonify({"error": "file_too_large"}), 400

    rel = f"{g.owner_id}/{disk_name}"
    title = request.form.get("title")
    essay_type = request.form.get("essay_type")
    topic = request.form.get("topic")
    content = ""

    # document: 同步解析文本
    if source_type == "document":
        try:
            content = _extract_docx_text(disk_path)
        except Exception as e:
            disk_path.unlink(missing_ok=True)
            return jsonify({"error": "docx_parse_failed", "detail": str(e)[:200]}), 400
        if not title:
            # 尝试用第一行做标题
            lines = content.strip().split("\n")
            if lines and len(lines[0]) <= 50:
                title = lines[0]

    word_count = len(content.replace(" ", "").replace("\n", ""))

    with db() as conn:
        cur = conn.execute(
            """INSERT INTO essays
               (owner_user_id, title, content, source_type, file_path, file_name,
                essay_type, topic, word_count, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                g.owner_id, title, content, source_type, rel, orig,
                essay_type, topic, word_count,
                "uploaded" if source_type == "photo" else "ocr_done",
            ),
        )
        row = conn.execute("SELECT * FROM essays WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify(_essay_to_dict(row)), 201


def _create_from_text():
    payload = request.get_json(force=True) or {}
    content = (payload.get("content") or "").strip()
    if not content:
        return jsonify({"error": "empty_content"}), 400
    if len(content) > MAX_ESSAY_TEXT_CHARS:
        return jsonify({"error": f"content too long, max {MAX_ESSAY_TEXT_CHARS}"}), 400

    title = (payload.get("title") or "").strip() or None
    essay_type = payload.get("essay_type")
    topic = (payload.get("topic") or "").strip() or None
    word_count = len(content.replace(" ", "").replace("\n", ""))

    with db() as conn:
        cur = conn.execute(
            """INSERT INTO essays
               (owner_user_id, title, content, source_type, essay_type, topic,
                word_count, status)
               VALUES (?, ?, ?, 'text', ?, ?, ?, 'ocr_done')""",
            (g.owner_id, title, content, essay_type, topic, word_count),
        )
        row = conn.execute("SELECT * FROM essays WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify(_essay_to_dict(row)), 201


# ---------- 列表 / 详情 / 文件 / 更新 / 删除 ----------
@bp.get("/api/essays")
@login_required
def list_essays():
    try:
        limit = max(1, min(int(request.args.get("limit", 50)), 200))
        offset = max(0, int(request.args.get("offset", 0)))
    except ValueError:
        limit, offset = 50, 0

    essay_type = request.args.get("essay_type")
    topic = request.args.get("topic")
    search = request.args.get("q")

    where = ["owner_user_id = ?"]
    args: list = [g.owner_id]
    if essay_type:
        where.append("essay_type = ?")
        args.append(essay_type)
    if topic:
        where.append("topic = ?")
        args.append(topic)
    if search:
        where.append("(title LIKE ? OR content LIKE ?)")
        args.extend([f"%{search}%", f"%{search}%"])
    where_sql = " AND ".join(where)

    with db() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) FROM essays WHERE {where_sql}", args
        ).fetchone()[0]
        rows = conn.execute(
            f"SELECT * FROM essays WHERE {where_sql} "
            "ORDER BY created_at DESC LIMIT ? OFFSET ?",
            args + [limit, offset],
        ).fetchall()

    resp = jsonify([_essay_to_dict(r) for r in rows])
    resp.headers["X-Total-Count"] = str(total)
    resp.headers["Access-Control-Expose-Headers"] = "X-Total-Count"
    return resp


@bp.get("/api/essays/<int:eid>")
@login_required
def get_essay(eid):
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM essays WHERE id = ? AND owner_user_id = ?",
            (eid, g.owner_id),
        ).fetchone()
    if not row:
        abort(404)
    return jsonify(_essay_to_dict(row))


@bp.get("/api/essays/<int:eid>/file")
@login_required
def get_essay_file(eid):
    with db() as conn:
        row = conn.execute(
            "SELECT file_path FROM essays WHERE id = ? AND owner_user_id = ?",
            (eid, g.owner_id),
        ).fetchone()
    if not row or not row["file_path"]:
        abort(404)
    p = ESSAY_UPLOAD_DIR / row["file_path"]
    if not p.exists():
        abort(404)
    return send_from_directory(ESSAY_UPLOAD_DIR, row["file_path"])


@bp.put("/api/essays/<int:eid>")
@login_required
def update_essay(eid):
    payload = request.get_json(force=True) or {}
    with db() as conn:
        row = conn.execute(
            "SELECT owner_user_id FROM essays WHERE id = ?", (eid,)
        ).fetchone()
        if not row:
            abort(404)
        if row["owner_user_id"] != g.owner_id:
            abort(403)
        fields = []
        args = []
        for k in ("title", "essay_type", "topic", "content"):
            if k in payload:
                fields.append(f"{k} = ?")
                args.append(payload[k])
        if "content" in payload:
            wc = len((payload["content"] or "").replace(" ", "").replace("\n", ""))
            fields.append("word_count = ?")
            args.append(wc)
        if fields:
            fields.append("updated_at = CURRENT_TIMESTAMP")
            args.append(eid)
            conn.execute(
                f"UPDATE essays SET {', '.join(fields)} WHERE id = ?", args
            )
        row = conn.execute("SELECT * FROM essays WHERE id = ?", (eid,)).fetchone()
    return jsonify(_essay_to_dict(row))


@bp.delete("/api/essays/<int:eid>")
@login_required
def delete_essay(eid):
    with db() as conn:
        row = conn.execute(
            "SELECT file_path, owner_user_id FROM essays WHERE id = ?", (eid,)
        ).fetchone()
        if not row:
            abort(404)
        if row["owner_user_id"] != g.owner_id:
            abort(403)
        if row["file_path"]:
            try:
                (ESSAY_UPLOAD_DIR / row["file_path"]).unlink(missing_ok=True)
            except Exception:
                pass
        conn.execute("DELETE FROM essays WHERE id = ?", (eid,))
    return {"ok": True}


# ---------- OCR (photo → text, 异步) ----------
def _run_ocr_bg(essay_id: int, file_path_str: str, owner_id: int):
    path = ESSAY_UPLOAD_DIR / file_path_str
    try:
        llm = get_llm()
        with llm_audit("essay_ocr", owner_id=owner_id, model=llm.model) as audit:
            audit.set_prompt_chars(len(ESSAY_OCR_PROMPT))
            raw = llm.vision_chat(ESSAY_OCR_PROMPT, [path], max_tokens=4000)
            audit.set_response_chars(len(raw))
        data = parse_json_or_retry(llm, raw)
        content = data.get("content") or ""
        title = data.get("title")
        word_count = len(content.replace(" ", "").replace("\n", ""))
        with db() as conn:
            conn.execute(
                """UPDATE essays
                   SET status='ocr_done', content=?, title=COALESCE(title, ?),
                       word_count=?, ocr_result_json=?, error_message=NULL
                   WHERE id=?""",
                (content, title, word_count,
                 json.dumps(data, ensure_ascii=False), essay_id),
            )
        logger.info("essay OCR done for id %s, %d chars", essay_id, word_count)
    except Exception as e:
        logger.exception("essay OCR failed for id %s", essay_id)
        with db() as conn:
            conn.execute(
                "UPDATE essays SET status='failed', error_message=? WHERE id=?",
                (str(e)[:500], essay_id),
            )


@bp.post("/api/essays/<int:eid>/ocr")
@login_required
def trigger_ocr(eid):
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM essays WHERE id = ? AND owner_user_id = ?",
            (eid, g.owner_id),
        ).fetchone()
    if not row:
        abort(404)
    if row["source_type"] != "photo":
        return jsonify({"error": "only_photo_source"}), 400
    if row["status"] == "ocr_processing":
        return jsonify(_essay_to_dict(row)), 202

    with db() as conn:
        conn.execute(
            "UPDATE essays SET status='ocr_processing', error_message=NULL WHERE id=?",
            (eid,),
        )
        row = conn.execute("SELECT * FROM essays WHERE id = ?", (eid,)).fetchone()
    bg_submit(_run_ocr_bg, eid, row["file_path"], g.owner_id)
    return jsonify(_essay_to_dict(row)), 202


# ---------- AI 批改 (异步) ----------
def _run_analysis_bg(essay_id: int, content: str, essay_type: str,
                     topic: str, word_count: int, owner_id: int):
    prompt = ESSAY_ANALYSIS_PROMPT.format(
        essay_type=essay_type or "未指定",
        topic=topic or "未指定",
        word_count=word_count,
        content=content[:8000],  # 截断超长作文
    )
    try:
        llm = get_llm()
        with llm_audit("essay_analysis", owner_id=owner_id, model=llm.model) as audit:
            audit.set_prompt_chars(len(prompt))
            raw = llm.chat(
                [{"role": "system", "content": "你是一位资深的初中语文老师, 善于批改作文。"},
                 {"role": "user", "content": prompt}],
                temperature=0.3, max_tokens=3000, response_format_json=True,
            )
            audit.set_response_chars(len(raw))
        data = parse_json_or_retry(llm, raw)
        with db() as conn:
            conn.execute(
                """UPDATE essays
                   SET status='analyzed', analysis_json=?, error_message=NULL
                   WHERE id=?""",
                (json.dumps(data, ensure_ascii=False), essay_id),
            )
        logger.info("essay analysis done for id %s, score=%s", essay_id, data.get("score"))
    except Exception as e:
        logger.exception("essay analysis failed for id %s", essay_id)
        with db() as conn:
            conn.execute(
                "UPDATE essays SET status='failed', error_message=? WHERE id=?",
                (str(e)[:500], essay_id),
            )


@bp.post("/api/essays/<int:eid>/analyze")
@login_required
def trigger_analysis(eid):
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM essays WHERE id = ? AND owner_user_id = ?",
            (eid, g.owner_id),
        ).fetchone()
    if not row:
        abort(404)
    if not row["content"]:
        return jsonify({"error": "no_content", "hint": "先完成 OCR 或填入正文"}), 400
    if row["status"] == "analyzing":
        return jsonify(_essay_to_dict(row)), 202

    with db() as conn:
        conn.execute(
            "UPDATE essays SET status='analyzing', error_message=NULL WHERE id=?",
            (eid,),
        )
        row = conn.execute("SELECT * FROM essays WHERE id = ?", (eid,)).fetchone()

    bg_submit(
        _run_analysis_bg, eid, row["content"],
        row["essay_type"], row["topic"], row["word_count"], g.owner_id,
    )
    return jsonify(_essay_to_dict(row)), 202


# ---------- 话题列表 (用于过滤下拉) ----------
@bp.get("/api/essays/topics")
@login_required
def list_topics():
    with db() as conn:
        rows = conn.execute(
            """SELECT DISTINCT topic FROM essays
               WHERE owner_user_id = ? AND topic IS NOT NULL AND topic != ''
               ORDER BY topic""",
            (g.owner_id,),
        ).fetchall()
    return jsonify([r["topic"] for r in rows])
