"""运维统计 (LLM 调用审计).

当前只暴露给登录用户自己, 看自己的 LLM 用量. 足够做日常观察,
如果未来需要管理员全局视图, 再加 role=admin 字段.
"""
from flask import Blueprint, jsonify, g

from db import db, rows_to_dicts
from auth import login_required

bp = Blueprint("admin_stats", __name__)


@bp.get("/api/stats/llm/usage")
@login_required
def llm_usage():
    """返回当前用户的 LLM 调用统计.

    响应:
    {
      "recent_7d": [
        {"date": "2026-04-11", "calls": 12, "prompt_chars": 9500, "response_chars": 4200, "avg_latency_ms": 18500}
      ],
      "by_endpoint": [
        {"endpoint": "extract_mistakes", "calls": 5, "avg_latency_ms": 19200, "total_chars": 10000}
      ],
      "totals": {
        "calls": 18,
        "ok": 17,
        "errors": 1,
        "total_prompt_chars": 9500,
        "total_response_chars": 4200
      }
    }
    """
    with db() as conn:
        # 最近 7 天按天聚合
        recent = conn.execute(
            """SELECT date(created_at) AS date,
                      COUNT(*) AS calls,
                      COALESCE(SUM(prompt_chars), 0) AS prompt_chars,
                      COALESCE(SUM(response_chars), 0) AS response_chars,
                      COALESCE(AVG(latency_ms), 0) AS avg_latency_ms
               FROM llm_calls
               WHERE owner_user_id = ?
                 AND date(created_at) >= date('now', '-6 day')
               GROUP BY date(created_at)
               ORDER BY date(created_at) DESC""",
            (g.owner_id,),
        ).fetchall()

        by_endpoint = conn.execute(
            """SELECT endpoint,
                      COUNT(*) AS calls,
                      COALESCE(AVG(latency_ms), 0) AS avg_latency_ms,
                      COALESCE(SUM(prompt_chars + response_chars), 0) AS total_chars
               FROM llm_calls
               WHERE owner_user_id = ?
               GROUP BY endpoint
               ORDER BY calls DESC""",
            (g.owner_id,),
        ).fetchall()

        totals = conn.execute(
            """SELECT COUNT(*) AS calls,
                      SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS ok,
                      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
                      COALESCE(SUM(prompt_chars), 0) AS total_prompt_chars,
                      COALESCE(SUM(response_chars), 0) AS total_response_chars
               FROM llm_calls
               WHERE owner_user_id = ?""",
            (g.owner_id,),
        ).fetchone()

    return jsonify({
        "recent_7d": rows_to_dicts(recent),
        "by_endpoint": rows_to_dicts(by_endpoint),
        "totals": {
            "calls": totals["calls"] or 0,
            "ok": totals["ok"] or 0,
            "errors": totals["errors"] or 0,
            "total_prompt_chars": totals["total_prompt_chars"] or 0,
            "total_response_chars": totals["total_response_chars"] or 0,
        },
    })
