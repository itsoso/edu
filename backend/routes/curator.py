"""Curator API (P5)."""
import logging

from flask import Blueprint, jsonify, request, g

from auth import login_required
from db import db, rows_to_dicts
from agent_curator import curate_for_user

bp = Blueprint("curator", __name__)
log = logging.getLogger(__name__)


@bp.get("/api/curator/today")
@login_required
def get_today():
    """读今日 curated items. 不自动触发生成 (cron 负责)."""
    import datetime as dt
    today = dt.date.today().isoformat()
    with db() as conn:
        rows = conn.execute("""
            SELECT id, kind, source_table, source_id, title, description,
                   rationale, estimated_minutes, priority, status, completed_at,
                   profile_version, created_at
            FROM curated_items
            WHERE owner_user_id = ? AND date = ?
            ORDER BY priority, id
        """, (g.owner_id, today)).fetchall()
    return jsonify({
        "date": today,
        "items": rows_to_dicts(rows),
    })


@bp.post("/api/curator/today/refresh")
@login_required
def refresh_today():
    """强制重新生成今日 (清掉 pending, 已 complete/dismiss 的保留)."""
    result = curate_for_user(g.owner_id, force=True)
    return jsonify(result)


@bp.post("/api/curator/items/<int:item_id>/complete")
@login_required
def mark_complete(item_id: int):
    with db() as conn:
        row = conn.execute(
            "SELECT owner_user_id, status FROM curated_items WHERE id = ?",
            (item_id,),
        ).fetchone()
        if not row:
            return jsonify({"error": "not_found"}), 404
        if row["owner_user_id"] != g.owner_id:
            return jsonify({"error": "forbidden"}), 403
        if row["status"] != "pending":
            return jsonify({"error": "already_resolved"}), 400
        conn.execute("""
            UPDATE curated_items
            SET status = 'completed', completed_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (item_id,))
    return jsonify({"ok": True})


@bp.post("/api/curator/items/<int:item_id>/dismiss")
@login_required
def mark_dismiss(item_id: int):
    with db() as conn:
        row = conn.execute(
            "SELECT owner_user_id, status FROM curated_items WHERE id = ?",
            (item_id,),
        ).fetchone()
        if not row:
            return jsonify({"error": "not_found"}), 404
        if row["owner_user_id"] != g.owner_id:
            return jsonify({"error": "forbidden"}), 403
        if row["status"] != "pending":
            return jsonify({"error": "already_resolved"}), 400
        conn.execute(
            "UPDATE curated_items SET status = 'dismissed' WHERE id = ?",
            (item_id,),
        )
    return jsonify({"ok": True})


@bp.get("/api/curator/history")
@login_required
def history():
    """最近 30 天的 curated items (审计 / 看 acceptance pattern)."""
    with db() as conn:
        rows = conn.execute("""
            SELECT date, kind, title, status, COUNT(*) AS n
            FROM curated_items
            WHERE owner_user_id = ?
              AND date >= date('now','-30 days')
            GROUP BY date, kind, status
            ORDER BY date DESC, kind
        """, (g.owner_id,)).fetchall()
    return jsonify(rows_to_dicts(rows))
