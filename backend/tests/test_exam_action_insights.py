"""Exam insight and exam-gap next action behavior."""

import db as db_module


def _create_panliyan_exam_history(client):
    previous = client.post(
        "/api/exams",
        json={
            "exam_name": "4月月考",
            "exam_date": "2026-04-30",
            "stage": "初二下",
            "total": 558.5,
            "grade_rank": 48,
            "scores": {
                "语文": 103.5,
                "数学": 106,
                "英语": 111,
                "科学": 143,
                "社会": 95,
            },
            "score_ranks": {
                "语文": 42,
                "数学": 110,
                "英语": 36,
                "科学": 55,
                "社会": 42,
            },
        },
    )
    assert previous.status_code == 201, previous.get_json()

    latest = client.post(
        "/api/exams",
        json={
            "exam_name": "初二期末考试",
            "exam_date": "2026-06-30",
            "stage": "初二下",
            "total": 569,
            "grade_rank": 56,
            "scores": {
                "语文": 109.5,
                "数学": 112.5,
                "英语": 118,
                "科学": 141,
                "社会": 88,
            },
            "score_ranks": {
                "语文": 18,
                "数学": 95,
                "英语": 21,
                "科学": 74,
                "社会": 112,
            },
        },
    )
    assert latest.status_code == 201, latest.get_json()
    return latest.get_json()["id"]


def test_exam_create_and_list_preserves_subject_ranks(client, helpers):
    helpers.register_student(client, username="exam-ranks")

    exam_id = _create_panliyan_exam_history(client)

    resp = client.get("/api/exams")

    assert resp.status_code == 200
    latest = [e for e in resp.get_json() if e["id"] == exam_id][0]
    assert latest["scores"]["社会"] == 88
    assert latest["score_ranks"]["社会"] == 112
    assert latest["score_ranks"]["数学"] == 95


def test_latest_exam_insight_prioritizes_panliyan_grade9_gaps(client, helpers):
    helpers.register_student(client, username="exam-insight")
    _create_panliyan_exam_history(client)

    resp = client.get("/api/exams/insights/latest")

    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload["exists"] is True
    assert payload["latest_exam"]["exam_name"] == "初二期末考试"
    assert payload["latest_exam"]["grade_rank"] == 56
    assert [s["subject"] for s in payload["focus_subjects"][:3]] == ["社会", "科学", "数学"]
    assert payload["focus_subjects"][0]["latest_score"] == 88
    assert payload["focus_subjects"][0]["subject_rank"] == 112
    assert "社会" in payload["summary"]
    assert "语文" in payload["strengths"][0]["subject"] or "英语" in payload["strengths"][0]["subject"]


def test_next_action_uses_exam_gap_before_plain_task(client, helpers):
    user = helpers.register_student(client, username="exam-gap-action")
    _create_panliyan_exam_history(client)

    with db_module.db() as conn:
        conn.execute("DELETE FROM tasks WHERE owner_user_id = ?", (user["id"],))

    resp = client.get("/api/agent/next-action")

    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload["exists"] is True
    action = payload["action"]
    assert action["kind"] == "exam_gap"
    assert action["subject"] == "社会"
    assert action["cta_path"] == "/trends"
    assert action["reason"]["primary"] == "最近考试暴露了最优先修复的学科缺口"
    assert "单科排名 112" in action["reason"]["evidence"]
