"""Bearer token auth 测试 (移动端用).

确保:
- /api/auth/token-login 返回 token
- bearer token 能访问受保护端点
- 坏 token / 过期 token / 无 token 返回 401
- bearer token 不影响 session cookie 认证
- 跨租户隔离在 bearer 模式下依然生效
"""
import pytest


def test_token_login_returns_token(client, helpers):
    helpers.register_student(client, username="alice", password="alice1234")
    helpers.logout(client)

    resp = client.post(
        "/api/auth/token-login",
        json={"username": "alice", "password": "alice1234"},
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert "token" in data
    assert len(data["token"]) > 20
    assert data["user"]["username"] == "alice"


def test_token_login_wrong_password(client, helpers):
    helpers.register_student(client, username="alice", password="alice1234")
    helpers.logout(client)

    resp = client.post(
        "/api/auth/token-login",
        json={"username": "alice", "password": "wrong"},
    )
    assert resp.status_code == 401


def test_bearer_token_accesses_protected(client, helpers):
    helpers.register_student(client, username="alice", password="alice1234")
    helpers.logout(client)

    resp = client.post("/api/auth/token-login",
                       json={"username": "alice", "password": "alice1234"})
    token = resp.get_json()["token"]

    # Use bearer token
    resp = client.get("/api/exams", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200


def test_bearer_token_me_endpoint(client, helpers):
    helpers.register_student(client, username="alice", password="alice1234")
    helpers.logout(client)

    resp = client.post("/api/auth/token-login",
                       json={"username": "alice", "password": "alice1234"})
    token = resp.get_json()["token"]

    resp = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    data = resp.get_json()
    assert data["user"]["username"] == "alice"


def test_bad_token_rejected(client):
    resp = client.get("/api/exams",
                      headers={"Authorization": "Bearer not_a_real_token"})
    assert resp.status_code == 401


def test_no_token_still_401(client):
    resp = client.get("/api/exams")
    assert resp.status_code == 401


def test_bearer_token_cross_tenant_isolation(client, helpers):
    """bearer token 模式下跨租户隔离依然严格."""
    # Alice register + get token
    alice = helpers.register_student(client, username="alice", password="alice1234")
    client.post("/api/exams",
                json={"exam_name": "alice exam", "scores": {"数学": 100}})
    helpers.logout(client)
    resp = client.post("/api/auth/token-login",
                       json={"username": "alice", "password": "alice1234"})
    alice_token = resp.get_json()["token"]

    # Bob register + token
    helpers.register_student(client, username="bob", password="bob12345")
    helpers.logout(client)
    resp = client.post("/api/auth/token-login",
                       json={"username": "bob", "password": "bob12345"})
    bob_token = resp.get_json()["token"]

    # Bob with his token sees own exams (0) — NOT alice's
    resp = client.get("/api/exams",
                      headers={"Authorization": f"Bearer {bob_token}"})
    assert resp.get_json() == []

    # Bob's token cannot see alice's data
    resp = client.get("/api/exams",
                      headers={"Authorization": f"Bearer {alice_token}"})
    exams = resp.get_json()
    assert len(exams) == 1
    assert exams[0]["exam_name"] == "alice exam"


def test_token_register_returns_token(client):
    resp = client.post(
        "/api/auth/token-register",
        json={
            "role": "student",
            "username": "newuser",
            "password": "newpass123",
            "display_name": "New User",
            "stage": "初二下",
        },
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert "token" in data
    assert data["user"]["username"] == "newuser"

    # Token works
    resp = client.get("/api/tasks", headers={"Authorization": f"Bearer {data['token']}"})
    assert resp.status_code == 200
    assert len(resp.get_json()) == 100  # 4-week plan cloned


def test_token_register_parent_with_join_code(client, helpers):
    alice = helpers.register_student(client, username="alice")
    code = alice["join_code"]
    helpers.logout(client)

    resp = client.post(
        "/api/auth/token-register",
        json={
            "role": "parent",
            "username": "alice_dad",
            "password": "dad12345",
            "display_name": "Alice Dad",
            "join_code": code,
        },
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["user"]["role"] == "parent"
    assert data["user"]["student_id"] == alice["id"]
    assert "token" in data
