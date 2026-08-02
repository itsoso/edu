"""全数据导出的完整性和失败可见性。"""

import sqlite3

import pytest


def test_export_includes_checkins_for_owned_tasks(client, helpers):
    helpers.register_student(client, username="alice")
    task_id = client.get("/api/tasks").get_json()[0]["id"]
    response = client.post(
        "/api/checkins",
        json={"task_id": task_id, "checkin_date": "2026-08-02"},
    )
    assert response.status_code == 200

    response = client.get("/api/user/export")
    assert response.status_code == 200
    payload = response.get_json()
    assert len(payload["tables"]["checkins"]) == 1
    assert payload["tables"]["checkins"][0]["task_id"] == task_id


def test_export_surfaces_schema_errors(client, helpers, monkeypatch):
    helpers.register_student(client, username="alice")
    import routes.user_export as user_export

    monkeypatch.setattr(user_export, "TABLES", ["missing_table"])
    with pytest.raises(sqlite3.OperationalError):
        client.get("/api/user/export")
