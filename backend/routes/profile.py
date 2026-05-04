"""学生画像 API (P1).

只读 + 用户反馈写. 画像本身由 profile_builder.py 写入.
"""
import json
import logging

from flask import Blueprint, jsonify, request, g

from auth import login_required
from db import db, row_to_dict, rows_to_dicts
from profile_builder import build_for_user, build_for_all_users

bp = Blueprint("profile", __name__)
log = logging.getLogger(__name__)


def _student_id_for(user_id: int) -> int | None:
    """学生看自己; 家长看绑定学生 (只读)."""
    with db() as conn:
        row = conn.execute("SELECT role, student_id FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        return None
    if row["role"] == "student":
        return user_id
    if row["role"] == "parent":
        return row["student_id"]
    return None


@bp.get("/api/me/profile")
@login_required
def get_my_profile():
    """读最新画像. 家长可读但只读."""
    target = _student_id_for(g.owner_id)
    if target is None:
        return jsonify({"error": "no_target_user"}), 404

    with db() as conn:
        row = conn.execute(
            "SELECT * FROM student_profile WHERE owner_user_id = ? "
            "ORDER BY version DESC LIMIT 1",
            (target,),
        ).fetchone()

    if not row:
        return jsonify({"exists": False, "message": "画像还没有构建过, 请稍后或手动触发 rebuild"})

    profile = json.loads(row["profile_json"])
    return jsonify({
        "exists": True,
        "version": row["version"],
        "computed_at": profile.get("computed_at"),
        "source_summary": row["source_summary"],
        "build_method": row["build_method"],
        "build_cost_usd": row["build_cost_usd"],
        "is_monthly_snapshot": bool(row["is_monthly_snapshot"]),
        "profile": profile,
        "viewer_role": "self" if target == g.owner_id else "parent",
        "can_edit": target == g.owner_id,
    })


@bp.get("/api/me/profile/history")
@login_required
def get_my_profile_history():
    """画像版本时间轴. 限 30 条."""
    target = _student_id_for(g.owner_id)
    if target is None:
        return jsonify([])
    with db() as conn:
        rows = conn.execute(
            "SELECT version, source_summary, build_method, "
            "       build_cost_usd, build_duration_ms, is_monthly_snapshot, created_at "
            "FROM student_profile WHERE owner_user_id = ? "
            "ORDER BY version DESC LIMIT 30",
            (target,),
        ).fetchall()
    return jsonify([{
        "version": r["version"],
        "source_summary": r["source_summary"],
        "build_method": r["build_method"],
        "is_monthly_snapshot": bool(r["is_monthly_snapshot"]),
        "created_at": r["created_at"],
    } for r in rows])


@bp.get("/api/me/profile/version/<int:version>")
@login_required
def get_profile_version(version: int):
    """读指定历史版本."""
    target = _student_id_for(g.owner_id)
    if target is None:
        return jsonify({"error": "no_target_user"}), 404
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM student_profile WHERE owner_user_id = ? AND version = ?",
            (target, version),
        ).fetchone()
    if not row:
        return jsonify({"error": "not_found"}), 404
    profile = json.loads(row["profile_json"])
    return jsonify({
        "version": row["version"],
        "source_summary": row["source_summary"],
        "is_monthly_snapshot": bool(row["is_monthly_snapshot"]),
        "created_at": row["created_at"],
        "profile": profile,
    })


@bp.post("/api/me/profile/correct")
@login_required
def post_correction():
    """用户反馈: dismiss 一条 error_pattern, 或 lock 某个 mastery 值.

    仅学生本人可写, 家长不行.
    Body:
      { field_path: "error_patterns.含参不分类讨论", action: "dismiss", reason?: "..." }
      { field_path: "knowledge.数学.一元二次方程.mastery", action: "lock_value", value: 1.0 }
      { field_path: "error_patterns.含参不分类讨论", action: "reset" }  # 撤销之前的 dismiss
    """
    with db() as conn:
        u = conn.execute("SELECT role FROM users WHERE id = ?", (g.owner_id,)).fetchone()
    if not u or u["role"] != "student":
        return jsonify({"error": "students_only"}), 403

    body = request.get_json(silent=True) or {}
    field_path = body.get("field_path")
    action = body.get("action")
    reason = (body.get("reason") or "").strip()[:200]

    if not field_path or not isinstance(field_path, str) or len(field_path) > 200:
        return jsonify({"error": "invalid_field_path"}), 400
    if action not in ("dismiss", "lock_value", "reset"):
        return jsonify({"error": "invalid_action"}), 400

    value_json = None
    if action == "lock_value":
        if "value" not in body:
            return jsonify({"error": "value_required"}), 400
        value_json = json.dumps(body["value"])

    with db() as conn:
        if action == "reset":
            cur = conn.execute(
                "DELETE FROM profile_corrections WHERE owner_user_id = ? AND field_path = ?",
                (g.owner_id, field_path),
            )
            return jsonify({"ok": True, "reset_count": cur.rowcount})

        # 同 field_path 重复 dismiss → 替换
        conn.execute(
            "DELETE FROM profile_corrections WHERE owner_user_id = ? AND field_path = ?",
            (g.owner_id, field_path),
        )
        conn.execute("""
            INSERT INTO profile_corrections
                (owner_user_id, field_path, action, value_json, reason)
            VALUES (?, ?, ?, ?, ?)
        """, (g.owner_id, field_path, action, value_json, reason or None))

    # 立即触发一次 rebuild, 让用户马上看到效果
    try:
        result = build_for_user(g.owner_id, build_method="after_correction")
    except Exception as e:
        log.warning("rebuild after correction failed: %s", e)
        result = {"error": str(e)}

    return jsonify({"ok": True, "rebuild": result})


@bp.get("/api/me/profile/corrections")
@login_required
def list_corrections():
    """看自己历史所有 corrections, 让她审计自己改过什么."""
    with db() as conn:
        rows = conn.execute(
            "SELECT id, field_path, action, value_json, reason, created_at "
            "FROM profile_corrections WHERE owner_user_id = ? "
            "ORDER BY created_at DESC",
            (g.owner_id,),
        ).fetchall()
    return jsonify(rows_to_dicts(rows))


@bp.delete("/api/me/profile/corrections/<int:cid>")
@login_required
def delete_correction(cid: int):
    """撤销某条 correction (释放后系统重新生成此 pattern)."""
    with db() as conn:
        row = conn.execute(
            "SELECT owner_user_id FROM profile_corrections WHERE id = ?", (cid,),
        ).fetchone()
        if not row:
            return jsonify({"error": "not_found"}), 404
        if row["owner_user_id"] != g.owner_id:
            return jsonify({"error": "forbidden"}), 403
        conn.execute("DELETE FROM profile_corrections WHERE id = ?", (cid,))
    return jsonify({"ok": True})


@bp.post("/api/me/profile/rebuild")
@login_required
def rebuild_now():
    """手动触发一次 rebuild (按钮)."""
    target = _student_id_for(g.owner_id)
    if target is None or target != g.owner_id:
        return jsonify({"error": "students_only"}), 403
    try:
        result = build_for_user(g.owner_id, build_method="manual_rebuild")
        return jsonify({"ok": True, "result": result})
    except Exception as e:
        log.exception("rebuild failed")
        return jsonify({"error": str(e)}), 500


@bp.delete("/api/me/profile")
@login_required
def wipe_profile():
    """全量删除自己的画像 + corrections (从 0 开始)."""
    with db() as conn:
        u = conn.execute("SELECT role FROM users WHERE id = ?", (g.owner_id,)).fetchone()
    if not u or u["role"] != "student":
        return jsonify({"error": "students_only"}), 403
    with db() as conn:
        n1 = conn.execute(
            "DELETE FROM student_profile WHERE owner_user_id = ?", (g.owner_id,)
        ).rowcount
        n2 = conn.execute(
            "DELETE FROM profile_corrections WHERE owner_user_id = ?", (g.owner_id,)
        ).rowcount
    return jsonify({"ok": True, "deleted_profiles": n1, "deleted_corrections": n2})


# ---------- admin ----------

@bp.get("/api/admin/profile-stats")
@login_required
def admin_profile_stats():
    """监控用. 任何登录用户都能看 (本系统就你们一家三口)."""
    with db() as conn:
        rows = conn.execute("""
            SELECT
                owner_user_id,
                COUNT(*) AS total_versions,
                MAX(version) AS latest_version,
                MAX(created_at) AS last_built_at,
                AVG(build_cost_usd) AS avg_cost_usd,
                AVG(build_duration_ms) AS avg_duration_ms
            FROM student_profile
            GROUP BY owner_user_id
        """).fetchall()
    return jsonify(rows_to_dicts(rows))


@bp.post("/api/admin/profile/build-all")
@login_required
def admin_build_all():
    """手动触发全员 build (调试用)."""
    results = build_for_all_users()
    return jsonify({"results": results})
