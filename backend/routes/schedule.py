"""课程日历 — 家长接送用.

每条记录描述一门固定时段的课 (周几 / 起止时间 / 地点 / 接送备注).
多孩子用 child_name 区分 (家庭里不一定每个孩子都有账号).

owner_user_id 是家长 / 学生自己的 user.id; 家长绑定学生时, 课程属于家长方便编辑.
"""
import re

from flask import Blueprint, jsonify, request, g

from db import db, row_to_dict, rows_to_dicts
from auth import login_required

bp = Blueprint("schedule", __name__)

TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _validate_time(s):
    return isinstance(s, str) and bool(TIME_RE.match(s))


def _validate_weekday(x):
    try:
        n = int(x)
    except (TypeError, ValueError):
        return None
    if n < 1 or n > 7:
        return None
    return n


def _payload(p):
    """从 JSON 中解析并校验课程字段, 返回 (fields_dict, error_or_None)."""
    child_name = (p.get("child_name") or "").strip()
    course_name = (p.get("course_name") or "").strip()
    weekday = _validate_weekday(p.get("weekday"))
    start_time = p.get("start_time")
    end_time = p.get("end_time")
    location = (p.get("location") or "").strip() or None
    pickup_note = (p.get("pickup_note") or "").strip() or None
    notes = (p.get("notes") or "").strip() or None
    try:
        sort_order = int(p.get("sort_order") or 0)
    except (TypeError, ValueError):
        sort_order = 0

    if not child_name:
        return None, "missing_child_name"
    if not course_name:
        return None, "missing_course_name"
    if weekday is None:
        return None, "invalid_weekday"
    if not _validate_time(start_time):
        return None, "invalid_start_time"
    if not _validate_time(end_time):
        return None, "invalid_end_time"
    if start_time >= end_time:
        return None, "end_before_start"

    return {
        "child_name": child_name,
        "course_name": course_name,
        "weekday": weekday,
        "start_time": start_time,
        "end_time": end_time,
        "location": location,
        "pickup_note": pickup_note,
        "notes": notes,
        "sort_order": sort_order,
    }, None


@bp.get("/api/schedule/courses")
@login_required
def list_courses():
    child = request.args.get("child")
    weekend_only = request.args.get("weekend") in ("1", "true", "yes")
    sql = "SELECT * FROM courses WHERE owner_user_id = ?"
    args = [g.owner_id]
    if child:
        sql += " AND child_name = ?"
        args.append(child)
    if weekend_only:
        sql += " AND weekday IN (6, 7)"
    sql += " ORDER BY weekday ASC, start_time ASC, sort_order ASC, id ASC"
    with db() as conn:
        rows = conn.execute(sql, args).fetchall()
    return jsonify(rows_to_dicts(rows))


@bp.get("/api/schedule/children")
@login_required
def list_children():
    with db() as conn:
        rows = conn.execute(
            """SELECT child_name, COUNT(*) AS course_count
               FROM courses WHERE owner_user_id = ?
               GROUP BY child_name ORDER BY child_name""",
            (g.owner_id,),
        ).fetchall()
    return jsonify([{"name": r["child_name"], "count": r["course_count"]} for r in rows])


@bp.post("/api/schedule/courses")
@login_required
def create_course():
    p = request.get_json(force=True) or {}
    fields, err = _payload(p)
    if err:
        return jsonify({"error": err}), 400
    with db() as conn:
        cur = conn.execute(
            """INSERT INTO courses
               (owner_user_id, child_name, course_name, weekday, start_time, end_time,
                location, pickup_note, notes, sort_order)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (g.owner_id, fields["child_name"], fields["course_name"], fields["weekday"],
             fields["start_time"], fields["end_time"], fields["location"],
             fields["pickup_note"], fields["notes"], fields["sort_order"]),
        )
        row = conn.execute("SELECT * FROM courses WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify(row_to_dict(row))


@bp.put("/api/schedule/courses/<int:cid>")
@login_required
def update_course(cid):
    p = request.get_json(force=True) or {}
    fields, err = _payload(p)
    if err:
        return jsonify({"error": err}), 400
    with db() as conn:
        row = conn.execute(
            "SELECT owner_user_id FROM courses WHERE id = ?", (cid,)
        ).fetchone()
        if not row:
            return jsonify({"error": "not_found"}), 404
        if row["owner_user_id"] != g.owner_id:
            return jsonify({"error": "forbidden"}), 403
        conn.execute(
            """UPDATE courses SET
                 child_name = ?, course_name = ?, weekday = ?,
                 start_time = ?, end_time = ?, location = ?,
                 pickup_note = ?, notes = ?, sort_order = ?,
                 updated_at = CURRENT_TIMESTAMP
               WHERE id = ? AND owner_user_id = ?""",
            (fields["child_name"], fields["course_name"], fields["weekday"],
             fields["start_time"], fields["end_time"], fields["location"],
             fields["pickup_note"], fields["notes"], fields["sort_order"],
             cid, g.owner_id),
        )
        updated = conn.execute("SELECT * FROM courses WHERE id = ?", (cid,)).fetchone()
    return jsonify(row_to_dict(updated))


@bp.delete("/api/schedule/courses/<int:cid>")
@login_required
def delete_course(cid):
    with db() as conn:
        row = conn.execute(
            "SELECT owner_user_id FROM courses WHERE id = ?", (cid,)
        ).fetchone()
        if not row:
            return jsonify({"error": "not_found"}), 404
        if row["owner_user_id"] != g.owner_id:
            return jsonify({"error": "forbidden"}), 403
        conn.execute("DELETE FROM courses WHERE id = ? AND owner_user_id = ?",
                     (cid, g.owner_id))
    return {"ok": True}


# ---- 一次性批量导入 (潘立言 / 潘友闻 家庭课表) ----
# 只导入到当前 owner; 若该 owner 已有同名孩子 + 同时段, 跳过该条.

PANLIYAN_COURSES = [
    # 潘立言 —— 周五
    {"child_name": "潘立言", "course_name": "黄语文",
     "weekday": 5, "start_time": "13:00", "end_time": "15:00", "location": "213"},
    {"child_name": "潘立言", "course_name": "卓科学",
     "weekday": 5, "start_time": "15:45", "end_time": "17:45", "location": "206"},
    # 潘立言 —— 周六
    {"child_name": "潘立言", "course_name": "线上数学",
     "weekday": 6, "start_time": "19:00", "end_time": "21:00", "location": "线上"},
    # 潘立言 —— 周日
    {"child_name": "潘立言", "course_name": "钠镁科学",
     "weekday": 7, "start_time": "08:00", "end_time": "10:00", "location": "4号教室"},
    {"child_name": "潘立言", "course_name": "社会【康奈尔】",
     "weekday": 7, "start_time": "10:30", "end_time": "12:30", "location": "2楼"},

    # 潘友闻 —— 周五
    {"child_name": "潘友闻", "course_name": "卓学堂数学",
     "weekday": 5, "start_time": "18:30", "end_time": "20:30", "location": "203"},
    # 潘友闻 —— 周六
    {"child_name": "潘友闻", "course_name": "书法",
     "weekday": 6, "start_time": "10:00", "end_time": "11:30", "location": "814"},
    {"child_name": "潘友闻", "course_name": "偲钠镁",
     "weekday": 6, "start_time": "13:30", "end_time": "15:00", "location": "203"},
    # 潘友闻 —— 周日
    {"child_name": "潘友闻", "course_name": "原力数学",
     "weekday": 7, "start_time": "10:10", "end_time": "12:10", "location": "403-1"},
    {"child_name": "潘友闻", "course_name": "杨老师语文",
     "weekday": 7, "start_time": "13:15", "end_time": "15:00", "location": "3楼"},
    {"child_name": "潘友闻", "course_name": "唱歌",
     "weekday": 7, "start_time": "15:30", "end_time": "16:10", "location": ""},
]


@bp.post("/api/schedule/seed-family")
@login_required
def seed_family():
    """为当前 owner 批量导入 潘立言 / 潘友闻 的课表. 幂等: 去重."""
    inserted = 0
    skipped = 0
    with db() as conn:
        for c in PANLIYAN_COURSES:
            exists = conn.execute(
                """SELECT 1 FROM courses
                   WHERE owner_user_id = ? AND child_name = ? AND course_name = ?
                     AND weekday = ? AND start_time = ?""",
                (g.owner_id, c["child_name"], c["course_name"],
                 c["weekday"], c["start_time"]),
            ).fetchone()
            if exists:
                skipped += 1
                continue
            conn.execute(
                """INSERT INTO courses
                   (owner_user_id, child_name, course_name, weekday, start_time,
                    end_time, location)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (g.owner_id, c["child_name"], c["course_name"], c["weekday"],
                 c["start_time"], c["end_time"], c["location"] or None),
            )
            inserted += 1
    return jsonify({"inserted": inserted, "skipped": skipped})
