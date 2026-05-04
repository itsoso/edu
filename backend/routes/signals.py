"""interaction_signals — 用户行为信号收集 (P0).

设计原则:
- 仅元数据, 不接受任何原始内容字段 (题目/答案/反思/日记内容)
- 客户端批量提交, 服务端尽量快/不阻塞
- payload 字段白名单, 出现未知字段直接拒绝该字段 (不报错)
- 用户可在设置里关闭收集 → 写入 profile_settings.signals_enabled=0, 此处直接 noop

事件清单见 ALLOWED_EVENT_TYPES.
"""
import json
import logging

from flask import Blueprint, jsonify, request, g

from auth import login_required
from db import db, rows_to_dicts

bp = Blueprint("signals", __name__)
log = logging.getLogger(__name__)

# 严格白名单 — 客户端发非清单内的事件直接丢弃 (不报错, 防止版本漂移)
ALLOWED_EVENT_TYPES = {
    "session.start",
    "session.end",
    "task.checkin.toggle",
    "task.override.skip",
    "task.override.replace",
    "weekly_goal.set",
    "mistake.create",
    "mistake.view_detail",
    "mistake.mark_mastered",
    "practice.item.start",
    "practice.item.input_pause",
    "practice.item.hint_used",
    "practice.item.submit",
    "practice.item.skip",
    "essay.create",
    "journal.write",
    # P2+ 占位:
    "agent.suggestion.shown",
    "agent.suggestion.accepted",
    "agent.suggestion.dismissed",
}

# payload 字段白名单 (按 event_type → set of allowed keys).
# 任何不在此清单的字段会被静默移除. 防止把题目内容塞进来.
PAYLOAD_SCHEMA: dict[str, set[str]] = {
    "session.start": {"platform", "version", "device_model"},
    "session.end": {"duration_secs"},
    "task.checkin.toggle": {"completed", "hour_of_day"},
    "task.override.skip": {"week"},
    "task.override.replace": {},
    "weekly_goal.set": {"focus_type", "week_start"},
    "mistake.create": {"subject", "reason", "source"},  # source = 'manual'|'scan'|'extracted'
    "mistake.view_detail": {"subject"},
    "mistake.mark_mastered": {"days_since_create"},
    "practice.item.start": {"subject", "difficulty"},
    "practice.item.input_pause": {"pause_count_so_far", "pause_secs"},
    "practice.item.hint_used": {"time_before_hint_secs"},
    "practice.item.submit": {"elapsed_secs", "answer_length", "hint_used"},
    "practice.item.skip": {"elapsed_secs"},
    "essay.create": {"source_type", "word_count"},
    "journal.write": {"char_count"},  # 仅字数, 永不传内容
    "agent.suggestion.shown": {"agent_name", "suggestion_id"},
    "agent.suggestion.accepted": {"agent_name", "suggestion_id"},
    "agent.suggestion.dismissed": {"agent_name", "suggestion_id"},
}

# 内容字段黑名单 — 任何 event 的 payload 出现这些 key, 整条事件丢弃
FORBIDDEN_PAYLOAD_KEYS = {
    "question_text", "answer_text", "wrong_answer", "correct_answer",
    "content", "journal_content", "reflection_content",
    "essay_content", "title", "description", "feedback",
}

VALID_CLIENTS = {"web", "mobile-ios", "mobile-android", "unknown"}


def _signals_enabled(conn, user_id: int) -> bool:
    """User-level opt-out. 默认开."""
    row = conn.execute(
        "SELECT signals_enabled FROM profile_settings WHERE owner_user_id = ?",
        (user_id,),
    ).fetchone()
    if row is None:
        return True
    return bool(row["signals_enabled"])


def _sanitize_payload(event_type: str, raw: dict) -> dict | None:
    """白名单过滤 payload. 出现 forbidden key 整条丢弃 → 返回 None."""
    if not isinstance(raw, dict):
        return {}
    allowed = PAYLOAD_SCHEMA.get(event_type, set())
    cleaned = {}
    for k, v in raw.items():
        if k in FORBIDDEN_PAYLOAD_KEYS:
            log.warning("signals: forbidden key %s in event %s, dropping event", k, event_type)
            return None
        if k not in allowed:
            continue  # 静默过滤未知字段
        # 简单类型检查: 不接受嵌套 dict/list 防止内容偷塞
        if isinstance(v, (dict, list)):
            continue
        cleaned[k] = v
    return cleaned


@bp.post("/api/signals")
@login_required
def post_signals():
    """批量接收信号. body: { events: [ { event_type, related_table?, related_id?, payload?, session_id?, client? } ] }
    返回: { ok: true, accepted: N, dropped: N }
    失败的事件不报错 (signals are best-effort), 只记 log.
    """
    body = request.get_json(silent=True) or {}
    events = body.get("events")
    if not isinstance(events, list):
        return jsonify({"ok": False, "error": "events_must_be_list"}), 400
    if len(events) > 200:
        return jsonify({"ok": False, "error": "too_many_events"}), 400

    accepted = 0
    dropped = 0

    with db() as conn:
        if not _signals_enabled(conn, g.owner_id):
            # 用户关了, 全丢
            return jsonify({"ok": True, "accepted": 0, "dropped": len(events), "opted_out": True})

        for raw_ev in events:
            if not isinstance(raw_ev, dict):
                dropped += 1
                continue
            event_type = raw_ev.get("event_type")
            if event_type not in ALLOWED_EVENT_TYPES:
                dropped += 1
                continue

            payload = _sanitize_payload(event_type, raw_ev.get("payload") or {})
            if payload is None:
                dropped += 1
                continue

            related_table = raw_ev.get("related_table")
            if related_table is not None and not isinstance(related_table, str):
                related_table = None
            if related_table and len(related_table) > 32:
                related_table = related_table[:32]

            related_id = raw_ev.get("related_id")
            if related_id is not None:
                try:
                    related_id = int(related_id)
                except (TypeError, ValueError):
                    related_id = None

            session_id = raw_ev.get("session_id")
            if session_id is not None:
                session_id = str(session_id)[:64]

            client = raw_ev.get("client", "unknown")
            if client not in VALID_CLIENTS:
                client = "unknown"

            conn.execute(
                """INSERT INTO interaction_signals
                   (owner_user_id, event_type, related_table, related_id,
                    payload_json, session_id, client)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (g.owner_id, event_type, related_table, related_id,
                 json.dumps(payload, ensure_ascii=False), session_id, client),
            )
            accepted += 1

    return jsonify({"ok": True, "accepted": accepted, "dropped": dropped})


@bp.get("/api/me/profile-settings")
@login_required
def get_profile_settings():
    """读用户的 opt-out 状态. 默认全 1."""
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM profile_settings WHERE owner_user_id = ?",
            (g.owner_id,),
        ).fetchone()
    if row is None:
        return jsonify({
            "signals_enabled": True,
            "profile_enabled": True,
            "journal_volume_in_profile": True,
        })
    return jsonify({
        "signals_enabled": bool(row["signals_enabled"]),
        "profile_enabled": bool(row["profile_enabled"]),
        "journal_volume_in_profile": bool(row["journal_volume_in_profile"]),
    })


@bp.put("/api/me/profile-settings")
@login_required
def put_profile_settings():
    """更新 opt-out 偏好. 请求体: { signals_enabled, profile_enabled, journal_volume_in_profile }, 任一可选."""
    body = request.get_json(silent=True) or {}
    fields = {}
    for k in ("signals_enabled", "profile_enabled", "journal_volume_in_profile"):
        if k in body:
            fields[k] = 1 if body[k] else 0
    if not fields:
        return jsonify({"error": "no_fields"}), 400

    with db() as conn:
        existing = conn.execute(
            "SELECT 1 FROM profile_settings WHERE owner_user_id = ?", (g.owner_id,),
        ).fetchone()
        if existing:
            cols = ", ".join(f"{k} = ?" for k in fields)
            conn.execute(
                f"UPDATE profile_settings SET {cols}, updated_at = CURRENT_TIMESTAMP "
                "WHERE owner_user_id = ?",
                (*fields.values(), g.owner_id),
            )
        else:
            cols = "owner_user_id, " + ", ".join(fields.keys())
            placeholders = "?, " + ", ".join("?" for _ in fields)
            conn.execute(
                f"INSERT INTO profile_settings ({cols}) VALUES ({placeholders})",
                (g.owner_id, *fields.values()),
            )
    return jsonify({"ok": True})


@bp.delete("/api/me/signals")
@login_required
def wipe_signals():
    """用户主动清除自己所有 signals (在设置里"清除我的行为数据"按钮)."""
    with db() as conn:
        cur = conn.execute(
            "DELETE FROM interaction_signals WHERE owner_user_id = ?",
            (g.owner_id,),
        )
    return jsonify({"ok": True, "deleted": cur.rowcount})
