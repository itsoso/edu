"""Deterministic exam insight rules for grade-transition action planning."""

from constants import FULL_MARKS, SUBJECTS
from db import row_to_dict


ACTION_TEXT = {
    "社会": "先做社会框架梳理, 再练主观题关键词",
    "科学": "优先修复实验题、图像题和综合推理题",
    "数学": "用限时训练稳住高分段正确率",
    "语文": "保持阅读和作文手感, 不抢主攻时间",
    "英语": "保持完形/阅读节奏, 低频维护即可",
}


def _score_rate(score, full_mark):
    if score is None or not full_mark:
        return None
    return round(float(score) / float(full_mark) * 100, 1)


def _exam_public(row):
    if not row:
        return None
    d = row_to_dict(row)
    return {
        "id": d["id"],
        "exam_name": d["exam_name"],
        "exam_date": d["exam_date"],
        "stage": d["stage"],
        "total": d["total"],
        "grade_rank": d["grade_rank"],
    }


def _scores_by_exam(conn, exam_ids):
    if not exam_ids:
        return {}
    placeholders = ",".join("?" * len(exam_ids))
    rows = conn.execute(
        f"""SELECT exam_id, subject, score, full_mark, subject_rank
            FROM scores
            WHERE exam_id IN ({placeholders})""",
        exam_ids,
    ).fetchall()
    out = {}
    for r in rows:
        out.setdefault(r["exam_id"], {})[r["subject"]] = {
            "score": r["score"],
            "full_mark": r["full_mark"] or FULL_MARKS.get(r["subject"]),
            "subject_rank": r["subject_rank"],
        }
    return out


def _rank_pressure(rank):
    if rank is None:
        return 0
    if rank >= 100:
        return 50
    if rank >= 70:
        return 22
    if rank >= 50:
        return 12
    return 0


def _gap_score(subject, latest, previous, avg_score):
    score = latest.get("score")
    full_mark = latest.get("full_mark") or FULL_MARKS.get(subject)
    rate = _score_rate(score, full_mark)
    rank = latest.get("subject_rank")
    prev_score = previous.get("score") if previous else None
    delta = None if prev_score is None or score is None else round(score - prev_score, 1)

    gap = _rank_pressure(rank)
    if delta is not None and delta < 0:
        gap += abs(delta) * 2
    if rate is not None and rate < 90:
        gap += 25
    elif rate is not None and rate < 93:
        gap += 10
    if avg_score is not None and score is not None and score < avg_score:
        gap += avg_score - score
    if subject == "数学" and rank is not None and rank >= 90:
        gap += 5
    return round(gap, 1), rate, delta


def build_latest_exam_insight(conn, owner_id: int):
    exams = conn.execute(
        """SELECT *
           FROM exams
           WHERE owner_user_id = ?
           ORDER BY sort_order DESC, id DESC
           LIMIT 8""",
        (owner_id,),
    ).fetchall()
    if not exams:
        return {"exists": False}

    latest = exams[0]
    previous = exams[1] if len(exams) > 1 else None
    score_map = _scores_by_exam(conn, [e["id"] for e in exams])
    latest_scores = score_map.get(latest["id"], {})
    previous_scores = score_map.get(previous["id"], {}) if previous else {}

    historical = {}
    for exam in exams[1:]:
        for subject, data in score_map.get(exam["id"], {}).items():
            historical.setdefault(subject, []).append(data["score"])

    focus_subjects = []
    strengths = []
    for subject in SUBJECTS:
        latest_data = latest_scores.get(subject)
        if not latest_data:
            continue
        prev_data = previous_scores.get(subject)
        avg_values = historical.get(subject) or []
        avg_score = sum(avg_values) / len(avg_values) if avg_values else None
        gap, rate, delta = _gap_score(subject, latest_data, prev_data, avg_score)
        rank = latest_data.get("subject_rank")
        item = {
            "subject": subject,
            "latest_score": latest_data["score"],
            "full_mark": latest_data.get("full_mark") or FULL_MARKS.get(subject),
            "score_rate": rate,
            "subject_rank": rank,
            "delta_from_previous": delta,
            "gap_score": gap,
            "recommendation": ACTION_TEXT.get(subject, "做一次短复盘, 找出下一步动作"),
        }
        if gap > 0:
            focus_subjects.append(item)
        if rate is not None and (rate >= 95 or (rank is not None and rank <= 30)):
            strengths.append(item)

    focus_subjects.sort(key=lambda x: (-x["gap_score"], x["subject"]))
    strengths.sort(
        key=lambda x: (
            x["subject_rank"] if x["subject_rank"] is not None else 999,
            -(x["score_rate"] or 0),
        )
    )

    lead = focus_subjects[0]["subject"] if focus_subjects else "最近考试"
    summary = (
        f"{latest['exam_name']} 后, 优先修复 {lead}; "
        f"总分 {latest['total'] if latest['total'] is not None else '-'}, "
        f"年级排名 {latest['grade_rank'] if latest['grade_rank'] is not None else '-'}."
    )
    return {
        "exists": True,
        "latest_exam": _exam_public(latest),
        "previous_exam": _exam_public(previous),
        "summary": summary,
        "focus_subjects": focus_subjects[:5],
        "strengths": strengths[:3],
    }
