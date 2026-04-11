"""Auth 流程 + 跨租户隔离测试. 这是最有安全价值的部分.

覆盖:
- 注册学生 + 家长 (含失败路径: 无效 code, 重名, 短密码)
- 登录/登出/session
- 同学之间数据隔离 (alice 看不到 bob 的考试)
- 家长只读权限 (parent 能看 child 数据)
- 试图 DELETE / PUT 别人的资源返回 403
"""


# ---------------- Auth 基本流 ----------------
def test_register_login_logout(client, helpers):
    alice = helpers.register_student(client)
    assert alice["role"] == "student"
    assert alice["join_code"] is not None
    assert len(alice["join_code"]) == 6

    client.post("/api/auth/logout")
    me = client.get("/api/auth/me").get_json()
    assert me["user"] is None

    resp = helpers.login(client, "alice", "alice1234")
    assert resp.status_code == 200
    me = client.get("/api/auth/me").get_json()
    assert me["user"]["username"] == "alice"

    helpers.logout(client)
    assert client.get("/api/auth/me").get_json()["user"] is None


def test_duplicate_username_rejected(client, helpers):
    helpers.register_student(client, username="alice")
    helpers.logout(client)
    resp = client.post(
        "/api/auth/register",
        json={
            "role": "student",
            "username": "alice",
            "password": "different",
            "display_name": "Alice 2",
        },
    )
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "username_taken"


def test_short_password_rejected(client):
    resp = client.post(
        "/api/auth/register",
        json={
            "role": "student",
            "username": "shortpw",
            "password": "123",
            "display_name": "X",
        },
    )
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "password_too_short"


def test_wrong_password_login_fails(client, helpers):
    helpers.register_student(client, username="alice")
    helpers.logout(client)
    resp = helpers.login(client, "alice", "wrongpassword")
    assert resp.status_code == 401
    assert resp.get_json()["error"] == "invalid_credentials"


# ---------------- 家长绑定流程 ----------------
def test_parent_register_with_valid_code(client, helpers):
    alice = helpers.register_student(client, username="alice")
    code = alice["join_code"]
    helpers.logout(client)

    resp = helpers.register_parent(client, join_code=code, username="alice_mom")
    assert resp.status_code == 200, resp.get_json()
    parent = resp.get_json()["user"]
    assert parent["role"] == "parent"
    assert parent["student_id"] == alice["id"]

    me = client.get("/api/auth/me").get_json()
    assert me["bound_student"]["id"] == alice["id"]
    assert me["bound_student"]["display_name"] == "Alice"


def test_parent_register_with_invalid_code_rejected(client, helpers):
    resp = helpers.register_parent(client, join_code="NOPENOP", username="fake_mom")
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "invalid_join_code"


# ---------------- 登录保护 ----------------
def test_protected_endpoints_require_login(client):
    for path in ("/api/exams", "/api/tasks", "/api/mistakes",
                 "/api/uploads", "/api/dashboard/summary",
                 "/api/llm/status", "/api/reports/monthly"):
        resp = client.get(path)
        assert resp.status_code == 401, f"{path} should require login, got {resp.status_code}"


# ---------------- 跨租户数据隔离 ----------------
def test_cross_tenant_exams_isolation(client, helpers):
    # alice 登录, 建一个 exam
    helpers.register_student(client, username="alice")
    resp = client.post(
        "/api/exams",
        json={
            "exam_name": "alice 月考",
            "stage": "初二下",
            "grade_rank": 50,
            "scores": {"数学": 100},
        },
    )
    assert resp.status_code == 201
    alice_exam_id = resp.get_json()["id"]

    assert len(client.get("/api/exams").get_json()) == 1

    helpers.logout(client)
    helpers.register_student(client, username="bob", name="Bob")

    bob_exams = client.get("/api/exams").get_json()
    assert bob_exams == []

    resp = client.delete(f"/api/exams/{alice_exam_id}")
    assert resp.status_code == 403


def test_cross_tenant_mistakes_isolation(client, helpers):
    helpers.register_student(client, username="alice")
    resp = client.post(
        "/api/mistakes",
        json={"subject": "数学", "reason": "计算错", "question_text": "alice 的题"},
    )
    alice_m_id = resp.get_json()["id"]
    helpers.logout(client)

    helpers.register_student(client, username="bob")
    assert client.get("/api/mistakes").get_json() == []
    assert client.put(f"/api/mistakes/{alice_m_id}", json={"mastered": True}).status_code == 403
    assert client.delete(f"/api/mistakes/{alice_m_id}").status_code == 403


def test_cross_tenant_tasks_isolation(client, helpers):
    """每个学生注册时克隆 4 周计划, 都应该是自己的 100 条."""
    helpers.register_student(client, username="alice")
    alice_tasks = client.get("/api/tasks").get_json()
    assert len(alice_tasks) == 100
    alice_task_1 = alice_tasks[0]["id"]
    helpers.logout(client)

    helpers.register_student(client, username="bob")
    bob_tasks = client.get("/api/tasks").get_json()
    assert len(bob_tasks) == 100
    bob_ids = {t["id"] for t in bob_tasks}
    assert alice_task_1 not in bob_ids

    resp = client.post(
        "/api/checkins",
        json={"task_id": alice_task_1, "checkin_date": "2026-04-11"},
    )
    assert resp.status_code == 403


# ---------------- 家长只读视图 ----------------
def test_parent_sees_child_data(client, helpers):
    alice = helpers.register_student(client, username="alice")
    client.post(
        "/api/exams",
        json={"exam_name": "alice 月考", "scores": {"数学": 110}},
    )
    code = alice["join_code"]
    helpers.logout(client)

    helpers.register_parent(client, join_code=code, username="alice_mom")
    mom_view = client.get("/api/exams").get_json()
    assert len(mom_view) == 1
    assert mom_view[0]["exam_name"] == "alice 月考"
    assert len(client.get("/api/tasks").get_json()) == 100


def test_parent_cannot_see_other_students(client, helpers):
    """一个家长只能看自己绑定的学生, 看不到别的学生."""
    alice = helpers.register_student(client, username="alice")
    alice_code = alice["join_code"]
    helpers.logout(client)

    helpers.register_student(client, username="bob", name="Bob")
    client.post(
        "/api/exams",
        json={"exam_name": "bob 月考", "scores": {"数学": 90}},
    )
    helpers.logout(client)

    helpers.register_parent(client, join_code=alice_code, username="alice_mom")
    mom_exams = client.get("/api/exams").get_json()
    # alice 没考试, mom 应看到 0 条
    assert mom_exams == []


# ---------------- 健康检查 & 公开端点 ----------------
def test_health_is_public(client):
    assert client.get("/api/health").get_json() == {"ok": True}


def test_content_is_public(client):
    resp = client.get("/api/content")
    assert resp.status_code == 200
