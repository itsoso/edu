"""定时清理任务.

当前只做一件事: 删除 30 天前上传的试卷原图. DB 行保留,
因为 extracted_json / analysis_json 依然有用, 只是原图没意义了.

策略:
- 启动时起一个 daemon 线程, 每 6 小时跑一次
- 失败只打日志, 不影响主进程
- 也暴露成模块函数, 方便手动触发或写测试
"""
import logging
import threading
import time

from db import db
from constants import UPLOAD_DIR

logger = logging.getLogger(__name__)

# 原图保留天数. 超过就删文件, DB 行保留.
UPLOAD_RETENTION_DAYS = 30
# 后台清理周期 (秒)
CLEANUP_INTERVAL_SECONDS = 6 * 60 * 60  # 6 小时


def cleanup_old_upload_files() -> dict:
    """删除 retention 天前的上传图片文件, 返回统计."""
    removed = 0
    skipped = 0
    errors = 0

    with db() as conn:
        rows = conn.execute(
            """SELECT id, file_path FROM exam_uploads
               WHERE file_path IS NOT NULL
                 AND date(created_at) < date('now', ?)""",
            (f"-{UPLOAD_RETENTION_DAYS} day",),
        ).fetchall()

    for row in rows:
        rel = row["file_path"]
        if not rel:
            skipped += 1
            continue
        p = UPLOAD_DIR / rel
        try:
            if p.exists():
                p.unlink()
                removed += 1
            else:
                skipped += 1
        except Exception:
            logger.exception("cleanup: failed to delete %s", p)
            errors += 1

    logger.info(
        "cleanup done: %d removed, %d skipped, %d errors (retention=%d days)",
        removed, skipped, errors, UPLOAD_RETENTION_DAYS,
    )
    return {"removed": removed, "skipped": skipped, "errors": errors}


JOURNAL_MEDIA_RETENTION_DAYS = 14  # 音视频保留 14 天 (比图片短, 因为更大)


def cleanup_old_journal_media() -> dict:
    """删除 retention 天前的 journal 音视频文件 + 提取帧."""
    from constants import JOURNAL_UPLOAD_DIR
    import shutil

    removed = 0
    errors = 0

    with db() as conn:
        rows = conn.execute(
            """SELECT id, file_path, owner_user_id FROM journal_media
               WHERE file_path IS NOT NULL
                 AND date(created_at) < date('now', ?)""",
            (f"-{JOURNAL_MEDIA_RETENTION_DAYS} day",),
        ).fetchall()

    for row in rows:
        rel = row["file_path"]
        uid = rel.rsplit(".", 1)[0].split("/")[-1] if rel else ""
        p = JOURNAL_UPLOAD_DIR / rel
        try:
            if p.exists():
                p.unlink()
                removed += 1
            # 也删帧目录
            frames_dir = JOURNAL_UPLOAD_DIR / str(row["owner_user_id"]) / "frames" / uid
            if frames_dir.exists():
                shutil.rmtree(frames_dir, ignore_errors=True)
        except Exception:
            logger.exception("cleanup: failed to delete journal media %s", p)
            errors += 1

    logger.info(
        "journal media cleanup: %d removed, %d errors (retention=%d days)",
        removed, errors, JOURNAL_MEDIA_RETENTION_DAYS,
    )
    return {"removed": removed, "errors": errors}


def _cleanup_loop():
    """后台 daemon 主循环."""
    while True:
        try:
            cleanup_old_upload_files()
            cleanup_old_journal_media()
        except Exception:
            logger.exception("cleanup loop iteration failed")
        time.sleep(CLEANUP_INTERVAL_SECONDS)


_started = False
_lock = threading.Lock()


def start_cleanup_daemon():
    """启动后台清理线程. 幂等, 多次调用也只起一个."""
    global _started
    with _lock:
        if _started:
            return
        t = threading.Thread(target=_cleanup_loop, name="edu-cleanup", daemon=True)
        t.start()
        _started = True
        logger.info("cleanup daemon started (interval=%ds)", CLEANUP_INTERVAL_SECONDS)


if __name__ == "__main__":
    # 手动触发模式: python cleanup.py
    import sys
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    result = cleanup_old_upload_files()
    print(result)
