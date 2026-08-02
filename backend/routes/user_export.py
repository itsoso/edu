"""数据导出 — 用户全数据 JSON 备份.

设计:
- 学生账号: 导出自己产生的全部数据
- 家长账号: 导出绑定孩子的全部数据 (家长本身没有学习数据)

不包含:
- 媒体文件 (图片/视频太大, 单独走文件接口下载)
- LLM 调用日志 (内部审计用, 用户不需要)
- 行为信号 (interaction_signals — 隐私, 内部用)
- 密码 hash 等敏感字段

格式: 单个 JSON 文件, 直接下载. 不打包 ZIP, 简单可解析.
"""
import datetime
import json
from io import BytesIO

from flask import Blueprint, jsonify, request, g, send_file

from db import db, rows_to_dicts
from auth import login_required

bp = Blueprint("user_export", __name__)


# 哪些表 owner_user_id 是学生的
TABLES = [
    "exams", "scores", "tasks", "checkins", "mistakes",
    "exam_uploads", "practice_sets", "practice_items",
    "weekly_goals", "task_overrides", "reflections",
    "daily_tips", "monthly_reports", "journal_media",
    "essays", "feynman_sessions", "curated_items",
    "coach_reviews", "courses",
]


def _rows(conn, sql: str, args) -> list[dict]:
    """Run an export query and surface schema/data failures to the caller."""
    return rows_to_dicts(conn.execute(sql, args).fetchall())


@bp.get("/api/user/export")
@login_required
def export_user_data():
    """打包当前用户的数据为 JSON 下载."""
    student_id = g.owner_id  # owner_id 已经是 student_id (家长 = 绑定的孩子)
    me = g.current_user

    out: dict = {
        "exported_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "exporter": {
            "username": me["username"],
            "role": me["role"],
            "display_name": me.get("display_name"),
        },
        "student_id": student_id,
        "tables": {},
    }

    with db() as conn:
        # 学生自身资料
        u = conn.execute(
            "SELECT id, username, display_name, role, stage, settings_json, created_at FROM users WHERE id = ?",
            (student_id,),
        ).fetchone()
        out["student"] = dict(u) if u else None

        # 各表数据
        for table in TABLES:
            # 优先用 owner_user_id; 部分表用 set_id 或 student_id 关联
            if table == "practice_items":
                rows = _rows(
                    conn,
                    """SELECT pi.* FROM practice_items pi
                       JOIN practice_sets ps ON ps.id = pi.set_id
                       WHERE ps.owner_user_id = ?""",
                    (student_id,),
                )
            elif table == "scores":
                rows = _rows(
                    conn,
                    """SELECT s.* FROM scores s
                       JOIN exams e ON e.id = s.exam_id
                       WHERE e.owner_user_id = ?""",
                    (student_id,),
                )
            elif table == "checkins":
                rows = _rows(
                    conn,
                    """SELECT c.* FROM checkins c
                       JOIN tasks t ON t.id = c.task_id
                       WHERE t.owner_user_id = ?""",
                    (student_id,),
                )
            elif table == "task_overrides":
                rows = _rows(
                    conn,
                    "SELECT * FROM task_overrides WHERE owner_user_id = ?",
                    (student_id,),
                )
            else:
                rows = _rows(
                    conn,
                    f"SELECT * FROM {table} WHERE owner_user_id = ?",
                    (student_id,),
                )
            out["tables"][table] = rows

        # 家长布置的任务 (assignments student_id 字段)
        assigns = _rows(
            conn,
            "SELECT * FROM assignments WHERE student_id = ?",
            (student_id,),
        )
        out["tables"]["assignments"] = assigns

    json_bytes = json.dumps(out, ensure_ascii=False, indent=2).encode("utf-8")
    fname = f"edu-export-{me['username']}-{datetime.date.today().isoformat()}.json"
    return send_file(
        BytesIO(json_bytes),
        as_attachment=True,
        download_name=fname,
        mimetype="application/json",
    )
