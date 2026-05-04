"""Journal 多媒体: 音频/视频上传 + AI 视频分析.

与 reflections.py 是**独立信任边界**:
- reflections.py 永远不 import llm
- 本文件 IS allowed to import llm — 视频分析需要

AI 分析仅在用户显式 opt-in 时触发. Prompt 只含用户提问 + 视频帧,
**永远不含 reflections.content**.
"""
import json
import logging
import subprocess
import uuid
from pathlib import Path

from flask import Blueprint, jsonify, request, abort, g, send_from_directory
from werkzeug.utils import secure_filename

from db import db, row_to_dict, rows_to_dicts
from auth import login_required
from llm import get_llm, LLMError, parse_json_or_retry
from llm_audit import llm_audit
from background import submit as bg_submit
from constants import JOURNAL_UPLOAD_DIR, ALLOWED_MEDIA_EXT, MAX_MEDIA_UPLOAD_BYTES

logger = logging.getLogger(__name__)
bp = Blueprint("journal_media", __name__)

VIDEO_ANALYSIS_PROMPT = """这是一段学习视频中提取的关键帧 (按时间顺序排列).

用户的问题: {user_prompt}

请根据这些画面回答用户的问题。如果画面中有手写内容、黑板/白板内容或课本页面,
请尽量识别和转录。

严格返回 JSON:
{{
  "summary": "对视频内容的简要描述 (50-150字)",
  "answer": "针对用户问题的具体回答",
  "details": ["识别到的具体内容条目, 如公式/文字/图表描述"],
  "confidence": 0.0~1.0
}}

直接返回 JSON, 不要任何解释文字或 markdown 代码块。
"""


def _media_to_dict(row):
    d = row_to_dict(row)
    if not d:
        return None
    d["file_url"] = f"/api/journal/media/{d['id']}/file"
    if d.get("analysis_json"):
        try:
            d["analysis"] = json.loads(d["analysis_json"])
        except Exception:
            d["analysis"] = None
    else:
        d["analysis"] = None
    d.pop("analysis_json", None)
    if d.get("frames_json"):
        try:
            d["frames"] = json.loads(d["frames_json"])
        except Exception:
            d["frames"] = None
    else:
        d["frames"] = None
    d.pop("frames_json", None)
    d["ai_opt_in"] = bool(d.get("ai_opt_in"))
    return d


def _check_ffmpeg() -> bool:
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, timeout=5)
        return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


# ---------- 上传 ----------
@bp.post("/api/journal/media")
@login_required
def upload_journal_media():
    if "file" not in request.files:
        abort(400, "file required")
    f = request.files["file"]
    if not f.filename:
        abort(400, "empty filename")

    orig = secure_filename(f.filename) or "media"
    ext = orig.rsplit(".", 1)[-1].lower() if "." in orig else ""
    if ext not in ALLOWED_MEDIA_EXT:
        return jsonify({"error": f"unsupported_media_ext: .{ext}"}), 400

    media_type = request.form.get("media_type")
    if media_type not in ("audio", "video"):
        # 根据 extension 推断
        media_type = "video" if ext in ("mp4", "mov", "m4v", "webm") else "audio"

    user_dir = JOURNAL_UPLOAD_DIR / str(g.owner_id)
    user_dir.mkdir(parents=True, exist_ok=True)
    uid = uuid.uuid4().hex[:12]
    disk_name = f"{uid}.{ext}"
    disk_path = user_dir / disk_name
    f.save(disk_path)

    file_size = disk_path.stat().st_size
    if file_size > MAX_MEDIA_UPLOAD_BYTES:
        disk_path.unlink(missing_ok=True)
        return jsonify({"error": "file_too_large"}), 400

    rel = f"{g.owner_id}/{disk_name}"
    reflection_id = request.form.get("reflection_id", type=int)
    duration_secs = request.form.get("duration_secs", type=int)

    with db() as conn:
        cur = conn.execute(
            """INSERT INTO journal_media
               (owner_user_id, reflection_id, media_type, file_path, file_name,
                mime_type, duration_secs, file_size_bytes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                g.owner_id, reflection_id, media_type, rel, orig,
                f.content_type, duration_secs, file_size,
            ),
        )
        row = conn.execute(
            "SELECT * FROM journal_media WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
    return jsonify(_media_to_dict(row)), 201


# ---------- 列表 / 获取 / 文件 / 删除 ----------
@bp.get("/api/journal/media")
@login_required
def list_journal_media():
    try:
        limit = max(1, min(int(request.args.get("limit", 50)), 200))
        offset = max(0, int(request.args.get("offset", 0)))
    except ValueError:
        limit, offset = 50, 0

    reflection_id = request.args.get("reflection_id", type=int)
    where = "owner_user_id = ?"
    args: list = [g.owner_id]
    if reflection_id is not None:
        where += " AND reflection_id = ?"
        args.append(reflection_id)

    with db() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) FROM journal_media WHERE {where}", args
        ).fetchone()[0]
        rows = conn.execute(
            f"SELECT * FROM journal_media WHERE {where} "
            "ORDER BY created_at DESC LIMIT ? OFFSET ?",
            args + [limit, offset],
        ).fetchall()
    resp = jsonify([_media_to_dict(r) for r in rows])
    resp.headers["X-Total-Count"] = str(total)
    resp.headers["Access-Control-Expose-Headers"] = "X-Total-Count"
    return resp


@bp.get("/api/journal/media/<int:mid>")
@login_required
def get_journal_media(mid):
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM journal_media WHERE id = ? AND owner_user_id = ?",
            (mid, g.owner_id),
        ).fetchone()
    if not row:
        abort(404)
    return jsonify(_media_to_dict(row))


@bp.get("/api/journal/media/<int:mid>/file")
@login_required
def get_journal_media_file(mid):
    with db() as conn:
        row = conn.execute(
            "SELECT file_path, mime_type FROM journal_media WHERE id = ? AND owner_user_id = ?",
            (mid, g.owner_id),
        ).fetchone()
    if not row:
        abort(404)
    p = JOURNAL_UPLOAD_DIR / row["file_path"]
    if not p.exists():
        abort(404)
    return send_from_directory(JOURNAL_UPLOAD_DIR, row["file_path"])


@bp.delete("/api/journal/media/<int:mid>")
@login_required
def delete_journal_media(mid):
    with db() as conn:
        row = conn.execute(
            "SELECT file_path FROM journal_media WHERE id = ? AND owner_user_id = ?",
            (mid, g.owner_id),
        ).fetchone()
        if not row:
            abort(404)
        # 删文件
        try:
            (JOURNAL_UPLOAD_DIR / row["file_path"]).unlink(missing_ok=True)
        except Exception:
            pass
        # 删帧目录
        uid_part = row["file_path"].rsplit(".", 1)[0]  # {owner}/{uuid}
        frames_dir = JOURNAL_UPLOAD_DIR / str(g.owner_id) / "frames" / uid_part.split("/")[-1]
        if frames_dir.exists():
            import shutil
            shutil.rmtree(frames_dir, ignore_errors=True)
        conn.execute("DELETE FROM journal_media WHERE id = ?", (mid,))
    return {"ok": True}


# ---------- Link to reflection ----------
@bp.post("/api/journal/media/<int:mid>/link")
@login_required
def link_journal_media(mid):
    payload = request.get_json(force=True) or {}
    reflection_id = payload.get("reflection_id")
    with db() as conn:
        row = conn.execute(
            "SELECT owner_user_id FROM journal_media WHERE id = ?", (mid,)
        ).fetchone()
        if not row:
            abort(404)
        if row["owner_user_id"] != g.owner_id:
            abort(403)
        conn.execute(
            "UPDATE journal_media SET reflection_id = ? WHERE id = ?",
            (reflection_id, mid),
        )
    return {"ok": True}


# ---------- AI 视频分析 (异步) ----------
def _extract_frames(video_path: Path, output_dir: Path, max_frames: int = 6) -> list[str]:
    """用 ffmpeg 从视频提取关键帧. 返回帧文件路径列表."""
    output_dir.mkdir(parents=True, exist_ok=True)
    pattern = str(output_dir / "frame_%d.jpg")

    cmd = [
        "ffmpeg", "-i", str(video_path),
        "-vf", f"fps=1/5,scale=1280:-1",
        "-q:v", "3",
        "-frames:v", str(max_frames),
        "-y",  # overwrite
        pattern,
    ]

    result = subprocess.run(cmd, capture_output=True, timeout=30)
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"ffmpeg failed: {stderr}")

    frames = sorted(output_dir.glob("frame_*.jpg"))
    return [str(f) for f in frames]


def _run_video_analysis_bg(media_id: int, file_path_str: str,
                           prompt: str, owner_id: int):
    """后台: ffmpeg 提帧 → vision LLM 分析."""
    video_path = JOURNAL_UPLOAD_DIR / file_path_str
    uid = file_path_str.rsplit(".", 1)[0].split("/")[-1]
    frames_dir = JOURNAL_UPLOAD_DIR / str(owner_id) / "frames" / uid

    try:
        # Step 1: 提帧
        with db() as conn:
            conn.execute(
                "UPDATE journal_media SET analysis_status='extracting_frames' WHERE id=?",
                (media_id,),
            )
        frame_paths = _extract_frames(video_path, frames_dir)
        if not frame_paths:
            raise RuntimeError("ffmpeg extracted 0 frames")

        with db() as conn:
            conn.execute(
                """UPDATE journal_media
                   SET analysis_status='analyzing',
                       frames_json=?
                   WHERE id=?""",
                (json.dumps(frame_paths, ensure_ascii=False), media_id),
            )

        # Step 2: 调 vision LLM
        llm = get_llm()
        full_prompt = VIDEO_ANALYSIS_PROMPT.format(user_prompt=prompt)
        with llm_audit("video_analysis", owner_id=owner_id, model=llm.model) as audit:
            audit.set_prompt_chars(len(full_prompt))
            raw = llm.vision_chat(full_prompt, frame_paths, max_tokens=2500)
            audit.set_response_chars(len(raw))
        data = parse_json_or_retry(llm, raw)

        with db() as conn:
            conn.execute(
                """UPDATE journal_media
                   SET analysis_status='done',
                       analysis_json=?,
                       error_message=NULL
                   WHERE id=?""",
                (json.dumps(data, ensure_ascii=False), media_id),
            )
        logger.info("video analysis done for media %s", media_id)
    except Exception as e:
        logger.exception("video analysis failed for media %s", media_id)
        with db() as conn:
            conn.execute(
                "UPDATE journal_media SET analysis_status='failed', error_message=? WHERE id=?",
                (str(e)[:500], media_id),
            )


@bp.post("/api/journal/media/<int:mid>/analyze")
@login_required
def analyze_journal_media(mid):
    """触发 AI 分析视频. 要求 body 里有 prompt. 异步 202."""
    payload = request.get_json(force=True) or {}
    prompt = (payload.get("prompt") or "").strip()
    if not prompt:
        return jsonify({"error": "prompt_required"}), 400

    if not _check_ffmpeg():
        return jsonify({
            "error": "video_analysis_unavailable",
            "message": "ffmpeg not installed on server",
        }), 503

    with db() as conn:
        row = conn.execute(
            "SELECT * FROM journal_media WHERE id = ? AND owner_user_id = ?",
            (mid, g.owner_id),
        ).fetchone()
        if not row:
            abort(404)
        if row["media_type"] != "video":
            return jsonify({"error": "only_video"}), 400
        if row["analysis_status"] in ("extracting_frames", "analyzing"):
            return jsonify(_media_to_dict(row)), 202

        conn.execute(
            """UPDATE journal_media
               SET ai_opt_in=1,
                   analysis_prompt=?,
                   analysis_status='extracting_frames',
                   error_message=NULL
               WHERE id=?""",
            (prompt, mid),
        )
        row = conn.execute("SELECT * FROM journal_media WHERE id = ?", (mid,)).fetchone()

    file_path_str = row["file_path"]
    owner_id = g.owner_id
    bg_submit(_run_video_analysis_bg, mid, file_path_str, prompt, owner_id)
    return jsonify(_media_to_dict(row)), 202
