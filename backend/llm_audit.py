"""LLM 调用审计: 用 contextmanager 包一层 LLM 调用, 自动写 DB.

用法:
    with llm_audit('extract_mistakes', owner_id=user_id) as audit:
        raw = llm.vision_chat(prompt, [path])
        audit.set_prompt_chars(len(prompt))
        audit.set_response_chars(len(raw))

如果中间抛异常, status=error 且 error_message 记录.
"""
import logging
import time
from contextlib import contextmanager

from db import db

logger = logging.getLogger(__name__)


class _AuditSession:
    def __init__(self):
        self.prompt_chars = 0
        self.response_chars = 0
        self.model = None

    def set_prompt_chars(self, n: int):
        self.prompt_chars = n

    def set_response_chars(self, n: int):
        self.response_chars = n

    def set_model(self, model: str):
        self.model = model


@contextmanager
def llm_audit(endpoint: str, owner_id: int | None = None, model: str | None = None):
    """Context manager: 自动计时 + 写一条审计日志."""
    session = _AuditSession()
    session.model = model
    start_ns = time.monotonic_ns()
    err: str | None = None
    try:
        yield session
    except Exception as e:
        err = str(e)[:500]
        raise
    finally:
        elapsed_ms = int((time.monotonic_ns() - start_ns) / 1_000_000)
        try:
            with db() as conn:
                conn.execute(
                    """INSERT INTO llm_calls
                       (owner_user_id, endpoint, model, prompt_chars,
                        response_chars, latency_ms, status, error_message)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        owner_id,
                        endpoint,
                        session.model,
                        session.prompt_chars,
                        session.response_chars,
                        elapsed_ms,
                        "error" if err else "ok",
                        err,
                    ),
                )
        except Exception:
            # 审计失败不能影响主流程
            logger.exception("failed to write llm audit log")
