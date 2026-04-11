"""DELETE /api/auth/me 测试."""


def test_delete_me_requires_password(client, helpers):
    helpers.register_student(client, username="alice", password="alice1234")

    # 空 body 不应删除
    resp = client.delete("/api/auth/me", json={})
    assert resp.status_code == 401
    assert resp.get_json()["error"] == "wrong_password"

    # 错密码不应删除
    resp = client.delete("/api/auth/me", json={"password": "wrong"})
    assert resp.status_code == 401

    # 账号还能登录
    assert client.get("/api/auth/me").get_json()["user"] is not None


def test_delete_me_success(client, helpers):
    alice = helpers.register_student(client, username="alice", password="alice1234")
    # alice 建点数据
    client.post("/api/exams", json={"exam_name": "x", "scores": {"数学": 100}})
    client.post("/api/mistakes", json={"subject": "数学", "reason": "计算错"})

    # 删除账号
    resp = client.delete("/api/auth/me", json={"password": "alice1234"})
    assert resp.status_code == 200
    assert resp.get_json() == {"ok": True}

    # session 应该被清掉
    me = client.get("/api/auth/me").get_json()
    assert me["user"] is None

    # 无法用原密码重新登录 (账号不存在)
    resp = helpers.login(client, "alice", "alice1234")
    assert resp.status_code == 401


def test_delete_requires_login(client):
    resp = client.delete("/api/auth/me", json={"password": "whatever"})
    assert resp.status_code == 401


def test_delete_student_orphans_parent(client, helpers):
    """删学生后, 绑定该学生的家长 student_id 应变 NULL (因为 ON DELETE SET NULL)."""
    alice = helpers.register_student(client, username="alice", password="alice1234")
    code = alice["join_code"]
    helpers.logout(client)

    helpers.register_parent(client, join_code=code, username="alice_mom")
    helpers.logout(client)

    # alice 删自己账号
    helpers.login(client, "alice", "alice1234")
    resp = client.delete("/api/auth/me", json={"password": "alice1234"})
    assert resp.status_code == 200

    # mom 还能登录, 但 bound_student 应该为 None
    helpers.login(client, "alice_mom", "mom12345")
    me = client.get("/api/auth/me").get_json()
    assert me["user"]["username"] == "alice_mom"
    assert me["user"]["student_id"] is None
    assert "bound_student" not in me or me.get("bound_student") is None
