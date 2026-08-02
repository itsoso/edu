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
    ESSAY_OCR_PROMPT, ESSAY_OCR_MULTI_PROMPT, ESSAY_ANALYSIS_PROMPT,
    ESSAY_MODEL_PROMPT,
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
    # extra_files: JSON 数组 (相对路径), 还原成 {file_urls: [...]}
    extra = []
    if d.get("extra_files"):
        try:
            extra = json.loads(d["extra_files"]) or []
        except Exception:
            extra = []
    d.pop("extra_files", None)
    if d.get("file_path"):
        d["file_url"] = f"/api/essays/{d['id']}/file"
        # file_urls 是按原顺序的所有图片 url (第 1 张 + extra); index 从 0 开始
        urls = [f"/api/essays/{d['id']}/file?idx=0"]
        for i in range(len(extra)):
            urls.append(f"/api/essays/{d['id']}/file?idx={i + 1}")
        d["file_urls"] = urls
    else:
        d["file_url"] = None
        d["file_urls"] = []
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

    # 兼容单文件 (file) 与多文件 (files) 两种表单字段
    files = request.files.getlist("files") if "files" in request.files else []
    if not files and "file" in request.files:
        files = [request.files["file"]]
    if not files or not any(f.filename for f in files):
        abort(400, "file required")

    if source_type == "photo":
        if len(files) > 9:
            return jsonify({"error": "too_many_photos", "detail": "最多 9 张"}), 400
    else:
        # document 只取第一份
        files = files[:1]

    user_dir = ESSAY_UPLOAD_DIR / str(g.owner_id)
    user_dir.mkdir(parents=True, exist_ok=True)

    saved: list[tuple[str, str]] = []  # (rel_path, original_filename)
    for f in files:
        if not f.filename:
            continue
        orig = secure_filename(f.filename) or "essay"
        ext = orig.rsplit(".", 1)[-1].lower() if "." in orig else ""

        if source_type == "photo":
            if ext not in ALLOWED_IMAGE_EXT:
                # 回滚已保存文件
                for rel, _ in saved:
                    (ESSAY_UPLOAD_DIR / rel).unlink(missing_ok=True)
                return jsonify({"error": f"unsupported image ext: .{ext}"}), 400
        else:
            if ext not in ALLOWED_ESSAY_DOC_EXT:
                return jsonify({"error": f"unsupported doc ext: .{ext}, 支持 .docx"}), 400

        uid = uuid.uuid4().hex[:12]
        disk_name = f"{uid}.{ext}"
        disk_path = user_dir / disk_name
        f.save(disk_path)

        file_size = disk_path.stat().st_size
        max_size = MAX_ESSAY_PHOTO_BYTES if source_type == "photo" else MAX_ESSAY_DOC_BYTES
        if file_size > max_size:
            disk_path.unlink(missing_ok=True)
            for rel, _ in saved:
                (ESSAY_UPLOAD_DIR / rel).unlink(missing_ok=True)
            return jsonify({"error": "file_too_large"}), 400

        rel = f"{g.owner_id}/{disk_name}"
        saved.append((rel, orig))

    if not saved:
        abort(400, "file required")

    first_rel, first_name = saved[0]
    extra_rels = [r for r, _ in saved[1:]]

    title = request.form.get("title")
    essay_type = request.form.get("essay_type")
    topic = request.form.get("topic")
    content = ""

    # document: 同步解析文本 (只支持单文件)
    if source_type == "document":
        disk_path = ESSAY_UPLOAD_DIR / first_rel
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
    extra_files_json = json.dumps(extra_rels, ensure_ascii=False) if extra_rels else None

    with db() as conn:
        cur = conn.execute(
            """INSERT INTO essays
               (owner_user_id, title, content, source_type, file_path, file_name,
                essay_type, topic, word_count, status, extra_files)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                g.owner_id, title, content, source_type, first_rel, first_name,
                essay_type, topic, word_count,
                "uploaded" if source_type == "photo" else "ocr_done",
                extra_files_json,
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
            "SELECT file_path, extra_files FROM essays WHERE id = ? AND owner_user_id = ?",
            (eid, g.owner_id),
        ).fetchone()
    if not row or not row["file_path"]:
        abort(404)
    try:
        idx = int(request.args.get("idx", 0))
    except (TypeError, ValueError):
        idx = 0
    if idx == 0:
        rel = row["file_path"]
    else:
        try:
            extras = json.loads(row["extra_files"] or "[]")
        except Exception:
            extras = []
        if idx - 1 >= len(extras):
            abort(404)
        rel = extras[idx - 1]
    p = ESSAY_UPLOAD_DIR / rel
    if not p.exists():
        abort(404)
    return send_from_directory(ESSAY_UPLOAD_DIR, rel)


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
            "SELECT file_path, extra_files, owner_user_id FROM essays WHERE id = ?",
            (eid,),
        ).fetchone()
        if not row:
            abort(404)
        if row["owner_user_id"] != g.owner_id:
            abort(403)
        paths = []
        if row["file_path"]:
            paths.append(row["file_path"])
        try:
            paths.extend(json.loads(row["extra_files"] or "[]"))
        except Exception:
            pass
        for rel in paths:
            try:
                (ESSAY_UPLOAD_DIR / rel).unlink(missing_ok=True)
            except Exception:
                pass
        conn.execute("DELETE FROM essays WHERE id = ?", (eid,))
    return {"ok": True}


# ---------- OCR (photo → text, 异步) ----------
def _run_ocr_bg(essay_id: int, file_paths: list[str], owner_id: int):
    paths = [ESSAY_UPLOAD_DIR / p for p in file_paths]
    try:
        llm = get_llm()
        # 多图时用拼接 prompt, 单图用普通 OCR prompt
        if len(paths) > 1:
            prompt = ESSAY_OCR_MULTI_PROMPT.format(n=len(paths))
        else:
            prompt = ESSAY_OCR_PROMPT
        with llm_audit("essay_ocr", owner_id=owner_id, model=llm.model) as audit:
            audit.set_prompt_chars(len(prompt))
            # 单页 4000, 多页按页递增
            max_tokens = min(4000 + 1500 * max(0, len(paths) - 1), 12000)
            raw = llm.vision_chat(prompt, paths, max_tokens=max_tokens)
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
        logger.info("essay OCR done for id %s, %d chars (%d images)", essay_id, word_count, len(paths))
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
    file_paths = [row["file_path"]]
    try:
        file_paths.extend(json.loads(row["extra_files"] or "[]"))
    except Exception:
        pass
    bg_submit(_run_ocr_bg, eid, file_paths, g.owner_id)
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


# ---------- 范文生成 (后台任务; 不传学生原文) ----------
def _set_model_job_failed(job_id: str, code: str, message: str) -> None:
    with db() as conn:
        conn.execute(
            """UPDATE essay_model_jobs
               SET status='failed', error_code=?, error_message=?,
                   updated_at=CURRENT_TIMESTAMP
               WHERE id=?""",
            (code, message[:500], job_id),
        )


def _run_model_essay_bg(
    job_id: str,
    topic: str,
    essay_type: str,
    word_count: int,
    target_words: int,
    owner_id: int,
) -> None:
    """Generate from approved metadata only; student content/title never enter this job."""
    prompt = ESSAY_MODEL_PROMPT.format(
        topic=topic,
        essay_type=essay_type,
        word_count=word_count,
        target_words=target_words,
    )
    try:
        llm = get_llm()
        with llm_audit("essay_model", owner_id=owner_id, model=llm.model) as audit:
            audit.set_prompt_chars(len(prompt))
            raw = llm.chat(
                [
                    {
                        "role": "system",
                        "content": "你是一位资深的初中语文老师, 擅长写各类文体的范文。",
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.6,
                max_tokens=2500,
                response_format_json=True,
            )
            audit.set_response_chars(len(raw))
        data = parse_json_or_retry(llm, raw)
        if not isinstance(data, dict) or not data.get("content"):
            _set_model_job_failed(job_id, "bad_response", "模型返回格式不正确")
            return
        result = {
            "title": data.get("title") or "范文",
            "content": data["content"],
            "highlights": data.get("highlights") or [],
            "structure_note": data.get("structure_note") or "",
        }
        with db() as conn:
            conn.execute(
                """UPDATE essay_model_jobs
                   SET status='done', result_json=?, error_code=NULL,
                       error_message=NULL, updated_at=CURRENT_TIMESTAMP
                   WHERE id=?""",
                (json.dumps(result, ensure_ascii=False), job_id),
            )
    except LLMError as exc:
        _set_model_job_failed(job_id, "llm_error", str(exc))
    except Exception as exc:
        logger.exception("essay model background job failed")
        _set_model_job_failed(job_id, "gen_failed", str(exc))


@bp.post("/api/essays/<int:eid>/model-essay")
@login_required
def generate_model_essay(eid):
    """Queue a model essay using topic/type/word-count metadata only."""
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM essays WHERE id = ? AND owner_user_id = ?",
            (eid, g.owner_id),
        ).fetchone()
    if not row:
        abort(404)
    if not row["content"]:
        return jsonify({"error": "no_content"}), 400

    topic = row["topic"] or "(未指定主题)"
    word_count = row["word_count"] or 0
    target_words = max(400, min(800, word_count or 600))
    job_id = uuid.uuid4().hex
    with db() as conn:
        conn.execute(
            """INSERT INTO essay_model_jobs (id, owner_user_id, essay_id)
               VALUES (?, ?, ?)""",
            (job_id, g.owner_id, eid),
        )
    bg_submit(
        _run_model_essay_bg,
        job_id,
        topic,
        row["essay_type"] or "记叙文",
        word_count,
        target_words,
        g.owner_id,
    )
    return jsonify({"job_id": job_id, "status": "processing"}), 202


@bp.get("/api/essays/model-essay/<job_id>")
@login_required
def get_model_essay_job(job_id: str):
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM essay_model_jobs WHERE id=? AND owner_user_id=?",
            (job_id, g.owner_id),
        ).fetchone()
    if not row:
        abort(404)
    if row["status"] == "processing":
        return jsonify({"job_id": job_id, "status": "processing"}), 202
    if row["status"] == "failed":
        return jsonify({
            "job_id": job_id,
            "status": "failed",
            "error": row["error_code"] or "gen_failed",
            "detail": row["error_message"] or "范文生成失败",
        })
    return jsonify({
        "job_id": job_id,
        "status": "done",
        "result": json.loads(row["result_json"] or "{}"),
    })
