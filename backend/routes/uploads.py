"""试卷上传 + LLM 抽取/分析/保存错题."""
import json
import uuid

from flask import Blueprint, jsonify, request, abort, g, send_from_directory
from werkzeug.utils import secure_filename

from db import db, row_to_dict
from auth import login_required
from llm import (
    get_llm, LLMError,
    EXTRACT_MISTAKES_PROMPT, FULL_ANALYSIS_PROMPT,
    _parse_json_loose,
)
from constants import UPLOAD_DIR, ALLOWED_IMAGE_EXT

bp = Blueprint("uploads", __name__)


# ---------- helpers ----------
def _upload_to_dict(row):
    d = row_to_dict(row)
    if not d:
        return None
    if d.get("extracted_json"):
        try:
            d["extracted"] = json.loads(d["extracted_json"])
        except Exception:
            d["extracted"] = None
    d.pop("extracted_json", None)
    if d.get("analysis_json"):
        try:
            d["analysis"] = json.loads(d["analysis_json"])
        except Exception:
            d["analysis"] = None
    d.pop("analysis_json", None)
    d["image_url"] = f"/api/uploads/{d['id']}/file"
    return d


def _get_upload_or_403(conn, upload_id):
    row = conn.execute(
        "SELECT * FROM exam_uploads WHERE id = ? AND owner_user_id = ?",
        (upload_id, g.owner_id),
    ).fetchone()
    if not row:
        abort(404)
    return row


# ---------- LLM status ----------
@bp.get("/api/llm/status")
@login_required
def llm_status():
    return jsonify({"configured": get_llm().configured(), "model": get_llm().model})


# ---------- 上传 ----------
@bp.post("/api/uploads")
@login_required
def upload_exam_image():
    if "file" not in request.files:
        abort(400, "file required")
    f = request.files["file"]
    if not f.filename:
        abort(400, "empty filename")
    orig = secure_filename(f.filename) or "upload"
    ext = orig.rsplit(".", 1)[-1].lower() if "." in orig else ""
    if ext not in ALLOWED_IMAGE_EXT:
        return jsonify({"error": "unsupported_image"}), 400

    user_dir = UPLOAD_DIR / str(g.owner_id)
    user_dir.mkdir(parents=True, exist_ok=True)
    uid = uuid.uuid4().hex[:12]
    disk_name = f"{uid}.{ext}"
    disk_path = user_dir / disk_name
    f.save(disk_path)

    rel = f"{g.owner_id}/{disk_name}"
    with db() as conn:
        cur = conn.execute(
            """INSERT INTO exam_uploads (owner_user_id, file_path, file_name, exam_name, status)
               VALUES (?, ?, ?, ?, 'uploaded')""",
            (g.owner_id, rel, orig, request.form.get("exam_name")),
        )
        upload_id = cur.lastrowid
        row = conn.execute("SELECT * FROM exam_uploads WHERE id = ?", (upload_id,)).fetchone()
    return jsonify(_upload_to_dict(row)), 201


@bp.get("/api/uploads")
@login_required
def list_uploads():
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM exam_uploads WHERE owner_user_id = ? ORDER BY created_at DESC",
            (g.owner_id,),
        ).fetchall()
    return jsonify([_upload_to_dict(r) for r in rows])


@bp.get("/api/uploads/<int:upload_id>")
@login_required
def get_upload(upload_id):
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM exam_uploads WHERE id = ? AND owner_user_id = ?",
            (upload_id, g.owner_id),
        ).fetchone()
    if not row:
        abort(404)
    return jsonify(_upload_to_dict(row))


@bp.get("/api/uploads/<int:upload_id>/file")
@login_required
def get_upload_file(upload_id):
    with db() as conn:
        row = conn.execute(
            "SELECT file_path FROM exam_uploads WHERE id = ? AND owner_user_id = ?",
            (upload_id, g.owner_id),
        ).fetchone()
    if not row:
        abort(404)
    p = UPLOAD_DIR / row["file_path"]
    if not p.exists():
        abort(404)
    return send_from_directory(UPLOAD_DIR, row["file_path"])


@bp.delete("/api/uploads/<int:upload_id>")
@login_required
def delete_upload(upload_id):
    with db() as conn:
        row = conn.execute(
            "SELECT file_path FROM exam_uploads WHERE id = ? AND owner_user_id = ?",
            (upload_id, g.owner_id),
        ).fetchone()
        if not row:
            abort(404)
        try:
            (UPLOAD_DIR / row["file_path"]).unlink(missing_ok=True)
        except Exception:
            pass
        conn.execute("DELETE FROM exam_uploads WHERE id = ?", (upload_id,))
    return {"ok": True}


# ---------- LLM 抽取 / 分析 / 保存 ----------
@bp.post("/api/uploads/<int:upload_id>/extract")
@login_required
def extract_mistakes_from_upload(upload_id):
    """调用 vision LLM 抽取错题列表. 同步返回 JSON."""
    with db() as conn:
        row = _get_upload_or_403(conn, upload_id)
    path = UPLOAD_DIR / row["file_path"]
    try:
        llm = get_llm()
        raw = llm.vision_chat(EXTRACT_MISTAKES_PROMPT, [path], max_tokens=3500)
        data = _parse_json_loose(raw)
    except LLMError as e:
        with db() as conn:
            conn.execute(
                "UPDATE exam_uploads SET status='failed', error_message=? WHERE id=?",
                (str(e), upload_id),
            )
        return jsonify({"error": "llm_error", "detail": str(e)}), 502

    subject = (data.get("subject") if isinstance(data, dict) else None) or None
    with db() as conn:
        conn.execute(
            """UPDATE exam_uploads
               SET status='extracted', extracted_json=?, subject=COALESCE(subject, ?)
               WHERE id=?""",
            (json.dumps(data, ensure_ascii=False), subject, upload_id),
        )
        row = conn.execute("SELECT * FROM exam_uploads WHERE id = ?", (upload_id,)).fetchone()
    return jsonify(_upload_to_dict(row))


@bp.post("/api/uploads/<int:upload_id>/analyze")
@login_required
def full_analysis_of_upload(upload_id):
    with db() as conn:
        row = _get_upload_or_403(conn, upload_id)
    path = UPLOAD_DIR / row["file_path"]
    try:
        llm = get_llm()
        raw = llm.vision_chat(FULL_ANALYSIS_PROMPT, [path], max_tokens=2500)
        data = _parse_json_loose(raw)
    except LLMError as e:
        return jsonify({"error": "llm_error", "detail": str(e)}), 502

    with db() as conn:
        conn.execute(
            "UPDATE exam_uploads SET analysis_json=?, status='analyzed' WHERE id=?",
            (json.dumps(data, ensure_ascii=False), upload_id),
        )
        row = conn.execute("SELECT * FROM exam_uploads WHERE id = ?", (upload_id,)).fetchone()
    return jsonify(_upload_to_dict(row))


@bp.post("/api/uploads/<int:upload_id>/save-mistakes")
@login_required
def save_extracted_mistakes(upload_id):
    """把 extract 结果里选中的错题批量写入 mistakes 表."""
    payload = request.get_json(force=True) or {}
    indices = payload.get("indices")
    if indices is None:
        return jsonify({"error": "indices required"}), 400

    with db() as conn:
        row = _get_upload_or_403(conn, upload_id)
        if not row["extracted_json"]:
            return jsonify({"error": "not_extracted"}), 400
        try:
            data = json.loads(row["extracted_json"])
        except Exception:
            return jsonify({"error": "bad_extracted_json"}), 500
        subject = row["subject"] or data.get("subject") or "其他"
        mistakes_list = data.get("mistakes") or []
        saved_ids = []
        for i in indices:
            if 0 <= i < len(mistakes_list):
                m = mistakes_list[i]
                cur = conn.execute(
                    """INSERT INTO mistakes
                       (owner_user_id, subject, exam_name, question_text, wrong_answer,
                        correct_answer, reason, knowledge_point)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        g.owner_id,
                        subject,
                        row["exam_name"],
                        m.get("question_text"),
                        m.get("wrong_answer"),
                        m.get("correct_answer"),
                        m.get("reason_guess") or "其他",
                        m.get("knowledge_point"),
                    ),
                )
                saved_ids.append(cur.lastrowid)
    return jsonify({"saved": len(saved_ids), "ids": saved_ids})
