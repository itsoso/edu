"""后台 LLM 任务执行器.

为什么这里简单: 进程内 ThreadPoolExecutor, 不引 Celery/Redis.
- 每个 gunicorn worker 进程有自己的 executor (preload_app=True 时)
- 任务状态写回 SQLite, 前端轮询 status 字段
- 任务失败不会让 worker 线程崩 (try/except)

注意:
- 后台线程不能碰 Flask 的 g / session / request
- 必须从请求线程把需要的参数拷贝好再 submit
"""
import logging
from concurrent.futures import ThreadPoolExecutor

logger = logging.getLogger(__name__)

# 足够大, 生产环境下即使多个用户同时点 AI 按钮也不会排队
# gunicorn workers * threads 已经有隔离, 这里只是后台任务池
_executor: ThreadPoolExecutor | None = None


def get_executor() -> ThreadPoolExecutor:
    global _executor
    if _executor is None:
        _executor = ThreadPoolExecutor(
            max_workers=8,
            thread_name_prefix="edu-bg",
        )
    return _executor


def submit(fn, *args, **kwargs):
    """Fire-and-forget 提交任务, 不返回 Future.

    任务内部异常不会传播, 只会被记录到日志和 DB.
    """
    def _wrap():
        try:
            fn(*args, **kwargs)
        except Exception:
            logger.exception("background task failed: %s", fn.__name__)

    get_executor().submit(_wrap)


def shutdown():
    """优雅停机. 当前没接 flask teardown, 进程退出时 threads 自然终止."""
    global _executor
    if _executor is not None:
        _executor.shutdown(wait=False)
        _executor = None
