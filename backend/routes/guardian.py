"""Guardian API (P7 异常监控)."""
import json
import logging

from flask import Blueprint, jsonify, request, g

from auth import login_required
from db import db, rows_to_dicts
from agent_guardian import scan_for_user

bp = Blueprint("guardian", __name__)
log = logging.getLogger(__name__)


@bp.get("/api/guardian/alerts")
@login_required
def list_alerts():
    """读自己 (or 自己作为 target) 的 alerts. 自动过滤过期 / acknowledged."""
    with db() as conn:
        rows = conn.execute("""
            SELECT id, owner_user_id, target_user_id, severity, category,
                   title, message, evidence_json, audience,
                   acknowledged_at, expires_at, created_at
            FROM guardian_alerts
            WHERE target_user_id = ?
              AND acknowledged_at IS NULL
              AND (expires_at IS NULL OR expires_at >= date('now'))
            ORDER BY
              CASE severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
              created_at DESC
            LIMIT 20
        """, (g.owner_id,)).fetchall()
    out = []
    for r in rows:
        ev = None
        try:
            ev = json.loads(r["evidence_json"]) if r["evidence_json"] else None
        except json.JSONDecodeError:
            pass
        out.append({
            "id": r["id"],
            "severity": r["severity"],
            "category": r["category"],
            "title": r["title"],
            "message": r["message"],
            "evidence": ev,
            "audience": r["audience"],
            "expires_at": r["expires_at"],
            "created_at": r["created_at"],
        })
    return jsonify(out)


@bp.post("/api/guardian/alerts/<int:alert_id>/acknowledge")
@login_required
def acknowledge(alert_id: int):
    with db() as conn:
        row = conn.execute(
            "SELECT target_user_id FROM guardian_alerts WHERE id = ?", (alert_id,),
        ).fetchone()
        if not row:
            return jsonify({"error": "not_found"}), 404
        if row["target_user_id"] != g.owner_id:
            return jsonify({"error": "forbidden"}), 403
        conn.execute(
            "UPDATE guardian_alerts SET acknowledged_at = CURRENT_TIMESTAMP WHERE id = ?",
            (alert_id,),
        )
    return jsonify({"ok": True})


@bp.post("/api/guardian/scan")
@login_required
def manual_scan():
    """手动触发一次扫描 (调试/即时刷新). 学生本人触发对自己的扫描."""
    with db() as conn:
        u = conn.execute("SELECT role, student_id FROM users WHERE id = ?", (g.owner_id,)).fetchone()
    if not u:
        return jsonify({"error": "no_user"}), 404
    if u["role"] == "student":
        target_id = g.owner_id
    elif u["role"] == "parent":
        if not u["student_id"]:
            return jsonify({"error": "no_bound_student"}), 404
        target_id = u["student_id"]
    else:
        return jsonify({"error": "invalid_role"}), 400
    result = scan_for_user(target_id)
    return jsonify(result)
