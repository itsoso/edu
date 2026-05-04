"""图片压缩工具 — 服务端上传后生成持久化 thumb 版本.

调用位置:
  - routes/uploads.py: 上传后生成 thumb
  - routes/essays.py:  作文照片上传后生成 thumb (可选)

设计:
  - thumb 是用于喂给 LLM 的中等清晰度版本 (长边 1600 / JPEG q80)
  - 原图保留, 前端展示走原图 (/api/uploads/:id/file)
  - LLM 调用优先读 thumb, 省掉每次 vision_chat 的实时压缩 CPU
"""
from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def make_thumb(
    src: str | Path,
    dst: str | Path,
    max_edge: int = 1600,
    quality: int = 80,
) -> int | None:
    """生成压缩版 JPEG, 返回写出的字节数. 失败返回 None.

    注意: dst 后缀强制 .jpg, 调用方需自行管理文件名.
    """
    try:
        from io import BytesIO
        from PIL import Image, ImageOps
    except Exception as e:
        logger.warning("Pillow not available: %s", e)
        return None

    src_p = Path(src)
    dst_p = Path(dst)
    try:
        raw = src_p.read_bytes()
        img = Image.open(BytesIO(raw))
        img = ImageOps.exif_transpose(img)
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        w, h = img.size
        long_edge = max(w, h)
        if long_edge > max_edge:
            scale = max_edge / long_edge
            img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
        dst_p.parent.mkdir(parents=True, exist_ok=True)
        img.save(dst_p, format="JPEG", quality=quality, optimize=True)
        return dst_p.stat().st_size
    except Exception as e:
        logger.warning("make_thumb failed src=%s: %s", src_p, e)
        return None
