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
# 后台清理周期 (秒). 1 小时一次, 让 03-05 时间窗口的画像 build 可被命中.
CLEANUP_INTERVAL_SECONDS = 60 * 60


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


SIGNALS_RETENTION_DAYS = 90


def cleanup_old_signals() -> dict:
    """删 90 天前的 interaction_signals 行. profile build 不依赖这么老的数据."""
    with db() as conn:
        cur = conn.execute(
            "DELETE FROM interaction_signals "
            "WHERE occurred_at < datetime('now', ?)",
            (f"-{SIGNALS_RETENTION_DAYS} days",),
        )
    logger.info("signals cleanup: %d removed (retention=%d days)",
                cur.rowcount, SIGNALS_RETENTION_DAYS)
    return {"removed": cur.rowcount}


STUCK_UPLOAD_MINUTES = 5


def recover_stuck_uploads() -> dict:
    """僵尸任务恢复: 状态 extracting/analyzing 但 updated_at > 5 分钟.

    worker 崩了或 OOM 会让 upload 永远停在 extracting. 这里把它重置为 failed,
    写明"任务中断"方便用户看到并一键重试.
    """
    with db() as conn:
        cur = conn.execute(
            """UPDATE exam_uploads
               SET status = 'failed',
                   error_message = COALESCE(error_message, '任务中断 (可能是服务重启), 请重试'),
                   updated_at = CURRENT_TIMESTAMP
               WHERE status IN ('extracting', 'analyzing')
                 AND COALESCE(updated_at, created_at) < datetime('now', ?)""",
            (f"-{STUCK_UPLOAD_MINUTES} minute",),
        )
    n = cur.rowcount or 0
    if n:
        logger.warning("recovered %d stuck uploads (extracting/analyzing > %d min)",
                       n, STUCK_UPLOAD_MINUTES)
    return {"recovered": n}


# 画像 build 触发器: 上次成功 build 的日期
_last_profile_build_date: str | None = None
_last_tutor_run_date: str | None = None


def maybe_build_profiles():
    """每天 03:00-05:00 之间触发一次画像 build (按本地时间).
    用 _last_profile_build_date 记录今天是否已经 build 过, 避免一天多次.
    """
    import datetime as dt
    global _last_profile_build_date
    now = dt.datetime.now()
    today_str = now.strftime("%Y-%m-%d")
    if _last_profile_build_date == today_str:
        return  # 今天已 build
    if not (3 <= now.hour < 5):
        return  # 不在窗口
    try:
        from profile_builder import build_for_all_users
        results = build_for_all_users()
        logger.info("daily profile build done: %d users", len(results))
        _last_profile_build_date = today_str
    except Exception:
        logger.exception("daily profile build failed")


def maybe_run_tutor():
    """每天 06:00-08:00 之间跑一次 Tutor agent. 在画像 build 之后."""
    import datetime as dt
    global _last_tutor_run_date
    now = dt.datetime.now()
    today_str = now.strftime("%Y-%m-%d")
    if _last_tutor_run_date == today_str:
        return
    if not (6 <= now.hour < 8):
        return
    try:
        from agent_tutor import maybe_generate_for_all_users
        results = maybe_generate_for_all_users()
        generated = sum(1 for r in results if r.get("generated"))
        logger.info("daily tutor run done: %d users, %d new suggestions",
                    len(results), generated)
        _last_tutor_run_date = today_str
    except Exception:
        logger.exception("daily tutor run failed")


_last_curator_run_date: str | None = None
_last_coach_run_date: str | None = None
_last_guardian_run_date: str | None = None


def maybe_run_coach():
    """周日 18:00-22:00 触发本周 review."""
    import datetime as dt
    global _last_coach_run_date
    now = dt.datetime.now()
    today_str = now.strftime("%Y-%m-%d")
    if _last_coach_run_date == today_str:
        return
    if now.weekday() != 6:  # 6 = Sunday
        return
    if not (18 <= now.hour < 22):
        return
    try:
        from agent_coach import generate_for_all_users
        results = generate_for_all_users()
        ok_count = sum(1 for r in results if r.get("ok"))
        logger.info("weekly coach run done: %d users, %d ok", len(results), ok_count)
        _last_coach_run_date = today_str
    except Exception:
        logger.exception("weekly coach run failed")


def maybe_run_guardian():
    """每天 07:00-09:00 扫一次异常."""
    import datetime as dt
    global _last_guardian_run_date
    now = dt.datetime.now()
    today_str = now.strftime("%Y-%m-%d")
    if _last_guardian_run_date == today_str:
        return
    if not (7 <= now.hour < 9):
        return
    try:
        from agent_guardian import scan_for_all_users
        results = scan_for_all_users()
        total_alerts = sum(r.get("count", 0) for r in results)
        logger.info("daily guardian scan done: %d users, %d alerts written",
                    len(results), total_alerts)
        _last_guardian_run_date = today_str
    except Exception:
        logger.exception("daily guardian scan failed")


def maybe_run_curator():
    """每天 06:00-08:00 之间跑一次 Curator agent. 与 Tutor 同窗口, 各自独立."""
    import datetime as dt
    global _last_curator_run_date
    now = dt.datetime.now()
    today_str = now.strftime("%Y-%m-%d")
    if _last_curator_run_date == today_str:
        return
    if not (6 <= now.hour < 8):
        return
    try:
        from agent_curator import curate_for_all_users
        results = curate_for_all_users()
        generated = sum(r.get("generated", 0) for r in results)
        logger.info("daily curator run done: %d users, %d items generated",
                    len(results), generated)
        _last_curator_run_date = today_str
    except Exception:
        logger.exception("daily curator run failed")


def _cleanup_loop():
    """后台 daemon 主循环."""
    while True:
        try:
            cleanup_old_upload_files()
            cleanup_old_journal_media()
            cleanup_old_signals()
            recover_stuck_uploads()
            maybe_build_profiles()
            maybe_run_tutor()
            maybe_run_curator()
            maybe_run_coach()
            maybe_run_guardian()
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
