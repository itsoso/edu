"""家长任务权限边界。"""


def _parent_assignment(client, helpers):
    student = helpers.register_student(client, username="alice")
    helpers.logout(client)
    response = helpers.register_parent(
        client,
        join_code=student["join_code"],
        username="alice_mom",
    )
    assert response.status_code == 200
    response = client.post(
        "/api/assignments",
        json={"title": "完成数学订正", "kind": "practice"},
    )
    assert response.status_code == 201
    return response.get_json()["id"]


def test_student_can_complete_but_not_cancel_parent_assignment(client, helpers):
    assignment_id = _parent_assignment(client, helpers)
    helpers.logout(client)
    assert helpers.login(client, "alice", "alice1234").status_code == 200

    response = client.patch(
        f"/api/assignments/{assignment_id}",
        json={"status": "cancelled"},
    )
    assert response.status_code == 403

    response = client.patch(
        f"/api/assignments/{assignment_id}",
        json={"status": "completed"},
    )
    assert response.status_code == 200
    assert response.get_json()["status"] == "completed"


def test_other_student_cannot_read_or_update_assignment(client, helpers):
    assignment_id = _parent_assignment(client, helpers)
    helpers.logout(client)
    helpers.register_student(client, username="bob", password="bob12345")

    assert client.get("/api/assignments").get_json() == []
    response = client.patch(
        f"/api/assignments/{assignment_id}",
        json={"status": "completed"},
    )
    assert response.status_code == 403
