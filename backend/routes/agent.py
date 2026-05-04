"""Agent API (P2 Tutor + 后续 agents 共用)."""
import json
import logging

from flask import Blueprint, jsonify, request, g

from auth import login_required
from db import db, rows_to_dicts
from agent_tutor import (
    maybe_generate_for_user,
    _get_active_suggestion,
    _row_to_suggestion,
)

bp = Blueprint("agent", __name__)
log = logging.getLogger(__name__)


@bp.get("/api/agent/suggestion/today")
@login_required
def get_today_suggestion():
    """读当前 active 建议. 如果没有, 不自动触发生成 (cron 负责)."""
    with db() as conn:
        s = _get_active_suggestion(conn, g.owner_id)
    if not s:
        return jsonify({"exists": False})
    return jsonify({"exists": True, "suggestion": s})


@bp.post("/api/agent/suggestion/refresh")
@login_required
def refresh_suggestion():
    """主动触发一次 — 让用户能手动 "再来一条"."""
    # 先把现有的 mark expired (用户主动放弃)
    with db() as conn:
        existing = _get_active_suggestion(conn, g.owner_id)
        if existing:
            conn.execute("""
                UPDATE agent_actions
                SET user_response = 'expired',
                    response_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (existing["id"],))
    result = maybe_generate_for_user(g.owner_id, force=True)
    return jsonify(result)


@bp.post("/api/agent/suggestion/<int:action_id>/accept")
@login_required
def accept_suggestion(action_id: int):
    """记 user_response='accepted' + 执行 action.

    返回 { ok, action_result } — frontend 据此跳转或刷新.
    """
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM agent_actions WHERE id = ?", (action_id,),
        ).fetchone()
        if not row:
            return jsonify({"error": "not_found"}), 404
        if row["owner_user_id"] != g.owner_id:
            return jsonify({"error": "forbidden"}), 403
        if row["user_response"] is not None:
            return jsonify({"error": "already_responded", "current": row["user_response"]}), 400

        try:
            payload = json.loads(row["payload_json"] or "{}")
        except json.JSONDecodeError:
            payload = {}
        accept_action = payload.get("accept_action") or {}

        # 标 accepted (无论 action 执行成功与否, accepting 这个意图记下来)
        conn.execute("""
            UPDATE agent_actions
            SET user_response = 'accepted', response_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (action_id,))

    # 执行 action (已脱离 db context, accept 的事务先落地)
    action_result = _execute_action(g.owner_id, accept_action)
    return jsonify({"ok": True, "action": accept_action, "result": action_result})


@bp.post("/api/agent/suggestion/<int:action_id>/dismiss")
@login_required
def dismiss_suggestion(action_id: int):
    """记 user_response='dismissed' + 可选 reason."""
    body = request.get_json(silent=True) or {}
    reason = (body.get("reason") or "").strip()[:200]

    with db() as conn:
        row = conn.execute(
            "SELECT owner_user_id, user_response FROM agent_actions WHERE id = ?", (action_id,),
        ).fetchone()
        if not row:
            return jsonify({"error": "not_found"}), 404
        if row["owner_user_id"] != g.owner_id:
            return jsonify({"error": "forbidden"}), 403
        if row["user_response"] is not None:
            return jsonify({"error": "already_responded"}), 400

        # reason 存到 rationale 后追加 (rationale 字段就用来存 audit 信息)
        conn.execute("""
            UPDATE agent_actions
            SET user_response = 'dismissed', response_at = CURRENT_TIMESTAMP,
                rationale = COALESCE(rationale, '') || ?
            WHERE id = ?
        """, (f"\n[dismissed reason] {reason}" if reason else "", action_id))
    return jsonify({"ok": True})


@bp.post("/api/agent/snooze")
@login_required
def snooze_agent():
    """暂停 agent N 天. body: { days: 7 } 0=取消暂停."""
    body = request.get_json(silent=True) or {}
    days = body.get("days", 7)
    try:
        days = int(days)
    except (TypeError, ValueError):
        return jsonify({"error": "invalid_days"}), 400
    if days < 0 or days > 90:
        return jsonify({"error": "out_of_range"}), 400

    import datetime as dt
    if days == 0:
        until = None
    else:
        until = (dt.date.today() + dt.timedelta(days=days)).isoformat()

    with db() as conn:
        existing = conn.execute(
            "SELECT 1 FROM profile_settings WHERE owner_user_id = ?", (g.owner_id,),
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE profile_settings SET agent_snoozed_until = ?, updated_at = CURRENT_TIMESTAMP "
                "WHERE owner_user_id = ?",
                (until, g.owner_id),
            )
        else:
            conn.execute(
                "INSERT INTO profile_settings (owner_user_id, agent_snoozed_until) VALUES (?, ?)",
                (g.owner_id, until),
            )
    return jsonify({"ok": True, "snoozed_until": until})


@bp.get("/api/agent/actions")
@login_required
def list_my_agent_actions():
    """查自己的 agent action 历史 (audit). 限 100 条."""
    with db() as conn:
        rows = conn.execute("""
            SELECT id, agent_name, action_type, suggestion_id, payload_json,
                   rationale, user_response, response_at, created_at
            FROM agent_actions
            WHERE owner_user_id = ?
            ORDER BY created_at DESC
            LIMIT 100
        """, (g.owner_id,)).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        try:
            payload = json.loads(d.pop("payload_json") or "{}")
            d["kind"] = payload.get("kind")
            d["wording"] = payload.get("wording")
            d["evidence_refs"] = payload.get("evidence_refs")
            d["accept_action"] = payload.get("accept_action")
        except json.JSONDecodeError:
            pass
        out.append(d)
    return jsonify(out)


# ============================================================
# 内部: 执行 accept_action
# ============================================================

def _execute_action(user_id: int, action: dict) -> dict:
    """根据 accept_action 类型执行. 返回结果 (frontend 用来导航)."""
    typ = action.get("type")
    if typ == "generate_practice":
        from routes.practice import _create_practice_set_for_mistake
        mid = action.get("source_mistake_id")
        count = action.get("count", 3)
        if not mid:
            return {"error": "no_source_mistake"}
        try:
            set_id = _create_practice_set_for_mistake(user_id, mid, count)
            if set_id is None:
                return {"error": "mistake_not_found"}
            return {"practice_set_id": set_id, "navigate_to": "Practice"}
        except Exception as e:
            log.warning("execute generate_practice failed: %s", e)
            return {"error": str(e)}
    if typ == "navigate":
        return {
            "navigate_to": action.get("navigate_to"),
            "filter": action.get("filter"),
        }
    if typ == "acknowledge":
        return {"ok": True}
    return {"error": "unknown_action_type"}
