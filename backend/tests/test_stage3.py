"""阶段 3 测试: weekly_goals + task_overrides."""
import pytest


# ---------------- weekly_goals ----------------
def test_goal_upsert_basic(client, helpers):
    helpers.register_student(client, username="alice")

    resp = client.post(
        "/api/goals/weekly",
        json={
            "week_start": "2026-04-06",
            "goal_text": "这周我想搞定一元二次方程的判别式",
            "focus_type": "learn_new",
        },
    )
    assert resp.status_code == 200
    g = resp.get_json()
    assert g["goal_text"].startswith("这周我想搞定")
    assert g["focus_type"] == "learn_new"

    # 二次 POST 相同周应覆盖
    resp2 = client.post(
        "/api/goals/weekly",
        json={
            "week_start": "2026-04-06",
            "goal_text": "updated",
            "focus_type": "challenge",
        },
    )
    assert resp2.status_code == 200
    assert resp2.get_json()["goal_text"] == "updated"
    assert resp2.get_json()["focus_type"] == "challenge"


def test_goal_invalid_week_start(client, helpers):
    helpers.register_student(client, username="alice")
    resp = client.post(
        "/api/goals/weekly",
        json={"week_start": "not-a-date", "goal_text": "x"},
    )
    assert resp.status_code == 400


def test_goal_empty_text_rejected(client, helpers):
    helpers.register_student(client, username="alice")
    resp = client.post(
        "/api/goals/weekly",
        json={"week_start": "2026-04-06", "goal_text": "   "},
    )
    assert resp.status_code == 400


def test_goal_too_long_rejected(client, helpers):
    helpers.register_student(client, username="alice")
    resp = client.post(
        "/api/goals/weekly",
        json={"week_start": "2026-04-06", "goal_text": "x" * 501},
    )
    assert resp.status_code == 400


def test_get_goal_nonexistent_returns_exists_false(client, helpers):
    helpers.register_student(client, username="alice")
    resp = client.get("/api/goals/weekly/2026-04-06")
    assert resp.status_code == 200
    assert resp.get_json()["exists"] is False


def test_get_goal_existing(client, helpers):
    helpers.register_student(client, username="alice")
    client.post(
        "/api/goals/weekly",
        json={"week_start": "2026-04-06", "goal_text": "attack calculation"},
    )
    resp = client.get("/api/goals/weekly/2026-04-06")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["exists"] is True
    assert data["goal_text"] == "attack calculation"


def test_goal_cross_tenant_isolation(client, helpers):
    helpers.register_student(client, username="alice")
    client.post(
        "/api/goals/weekly",
        json={"week_start": "2026-04-06", "goal_text": "alice goal"},
    )
    helpers.logout(client)

    helpers.register_student(client, username="bob")
    # bob 看不到 alice 的
    resp = client.get("/api/goals/weekly/2026-04-06")
    assert resp.get_json()["exists"] is False

    resp = client.get("/api/goals/weekly?limit=10")
    assert resp.get_json() == []


# ---------------- task_overrides ----------------
def _get_alice_first_task_id(client):
    tasks = client.get("/api/tasks?week=1&day=1").get_json()
    assert len(tasks) > 0
    return tasks[0]["id"]


def test_skip_task_appears_in_listing(client, helpers):
    helpers.register_student(client, username="alice")
    tid = _get_alice_first_task_id(client)

    resp = client.post(
        f"/api/tasks/{tid}/override",
        json={"week_start": "2026-04-06", "action": "skip"},
    )
    assert resp.status_code == 200

    # 不带 week_start 的 listing 没有 override 信息
    tasks = client.get("/api/tasks?week=1&day=1").get_json()
    tid_row = next(t for t in tasks if t["id"] == tid)
    assert tid_row.get("override_action") is None

    # 带 week_start 应该看到 override
    tasks = client.get("/api/tasks?week=1&day=1&week_start=2026-04-06").get_json()
    tid_row = next(t for t in tasks if t["id"] == tid)
    assert tid_row["override_action"] == "skip"
    # effective 字段应该还是原模板 (skip 不替换内容, 只标记跳过)
    assert tid_row["effective_title"] == tid_row["title"]


def test_replace_task_overrides_effective_fields(client, helpers):
    helpers.register_student(client, username="alice")
    tid = _get_alice_first_task_id(client)

    resp = client.post(
        f"/api/tasks/{tid}/override",
        json={
            "week_start": "2026-04-06",
            "action": "replace",
            "custom_title": "我要重做上周的所有数学错题",
            "custom_description": "重点是方程",
            "custom_minutes": 25,
        },
    )
    assert resp.status_code == 200

    tasks = client.get("/api/tasks?week=1&day=1&week_start=2026-04-06").get_json()
    tid_row = next(t for t in tasks if t["id"] == tid)
    assert tid_row["override_action"] == "replace"
    assert tid_row["effective_title"] == "我要重做上周的所有数学错题"
    assert tid_row["effective_description"] == "重点是方程"
    assert tid_row["effective_minutes"] == 25
    # 原模板字段保留, 用于 UI "恢复默认" 提示
    assert tid_row["title"] != "我要重做上周的所有数学错题"


def test_replace_requires_custom_title(client, helpers):
    helpers.register_student(client, username="alice")
    tid = _get_alice_first_task_id(client)
    resp = client.post(
        f"/api/tasks/{tid}/override",
        json={"week_start": "2026-04-06", "action": "replace"},
    )
    assert resp.status_code == 400


def test_override_upsert_same_week(client, helpers):
    helpers.register_student(client, username="alice")
    tid = _get_alice_first_task_id(client)

    # 先 skip
    client.post(
        f"/api/tasks/{tid}/override",
        json={"week_start": "2026-04-06", "action": "skip"},
    )
    # 再 replace — 应该覆盖, 不是创建第二条
    client.post(
        f"/api/tasks/{tid}/override",
        json={
            "week_start": "2026-04-06",
            "action": "replace",
            "custom_title": "new",
        },
    )
    tasks = client.get("/api/tasks?week=1&day=1&week_start=2026-04-06").get_json()
    tid_row = next(t for t in tasks if t["id"] == tid)
    assert tid_row["override_action"] == "replace"


def test_override_delete_restores_default(client, helpers):
    helpers.register_student(client, username="alice")
    tid = _get_alice_first_task_id(client)

    client.post(
        f"/api/tasks/{tid}/override",
        json={
            "week_start": "2026-04-06",
            "action": "replace",
            "custom_title": "my way",
        },
    )

    client.delete(f"/api/tasks/{tid}/override?week_start=2026-04-06")

    tasks = client.get("/api/tasks?week=1&day=1&week_start=2026-04-06").get_json()
    tid_row = next(t for t in tasks if t["id"] == tid)
    assert tid_row.get("override_action") is None
    assert tid_row["effective_title"] == tid_row["title"]


def test_override_cross_tenant_forbidden(client, helpers):
    helpers.register_student(client, username="alice")
    alice_tid = _get_alice_first_task_id(client)
    helpers.logout(client)

    helpers.register_student(client, username="bob")
    resp = client.post(
        f"/api/tasks/{alice_tid}/override",
        json={"week_start": "2026-04-06", "action": "skip"},
    )
    assert resp.status_code == 403


def test_override_different_weeks_independent(client, helpers):
    """同一个任务在不同周的 override 独立存在."""
    helpers.register_student(client, username="alice")
    tid = _get_alice_first_task_id(client)

    client.post(
        f"/api/tasks/{tid}/override",
        json={"week_start": "2026-04-06", "action": "skip"},
    )
    client.post(
        f"/api/tasks/{tid}/override",
        json={
            "week_start": "2026-04-13",
            "action": "replace",
            "custom_title": "next week version",
        },
    )

    # Week 1: skip
    t1 = next(
        t for t in client.get("/api/tasks?week=1&day=1&week_start=2026-04-06").get_json()
        if t["id"] == tid
    )
    assert t1["override_action"] == "skip"

    # Week 2: replace
    t2 = next(
        t for t in client.get("/api/tasks?week=1&day=1&week_start=2026-04-13").get_json()
        if t["id"] == tid
    )
    assert t2["override_action"] == "replace"
    assert t2["effective_title"] == "next week version"


def test_stage3_requires_login(client):
    assert client.get("/api/goals/weekly").status_code == 401
    assert client.post(
        "/api/goals/weekly",
        json={"week_start": "2026-04-06", "goal_text": "x"},
    ).status_code == 401
    assert client.post(
        "/api/tasks/1/override",
        json={"week_start": "2026-04-06", "action": "skip"},
    ).status_code == 401
