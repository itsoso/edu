"""课程日历 schedule 路由测试."""


def _login(client, helpers):
    user = helpers.register_student(client)
    helpers.login(client, "alice", "alice1234")
    return user


def test_list_empty(client, helpers):
    _login(client, helpers)
    r = client.get("/api/schedule/courses")
    assert r.status_code == 200
    assert r.get_json() == []


def test_seed_family_inserts_11_courses(client, helpers):
    _login(client, helpers)
    r = client.post("/api/schedule/seed-family")
    assert r.status_code == 200
    body = r.get_json()
    assert body["inserted"] == 11
    assert body["skipped"] == 0

    # 第二次调用应全部跳过 (幂等)
    r2 = client.post("/api/schedule/seed-family")
    body2 = r2.get_json()
    assert body2["inserted"] == 0
    assert body2["skipped"] == 11

    all_courses = client.get("/api/schedule/courses").get_json()
    assert len(all_courses) == 11
    kids = {c["child_name"] for c in all_courses}
    assert kids == {"潘立言", "潘友闻"}


def test_create_and_filter(client, helpers):
    _login(client, helpers)
    r = client.post("/api/schedule/courses", json={
        "child_name": "test_kid", "course_name": "英语",
        "weekday": 6, "start_time": "09:00", "end_time": "10:30",
        "location": "A 101", "pickup_note": "爸爸送",
    })
    assert r.status_code == 200
    cid = r.get_json()["id"]

    # weekend filter
    r = client.get("/api/schedule/courses?weekend=1")
    assert len(r.get_json()) == 1

    # child filter
    r = client.get("/api/schedule/courses?child=test_kid")
    assert len(r.get_json()) == 1
    r = client.get("/api/schedule/courses?child=ghost")
    assert len(r.get_json()) == 0

    # delete
    r = client.delete(f"/api/schedule/courses/{cid}")
    assert r.status_code == 200
    assert client.get("/api/schedule/courses").get_json() == []


def test_validation_rejects_bad_time(client, helpers):
    _login(client, helpers)
    r = client.post("/api/schedule/courses", json={
        "child_name": "x", "course_name": "y",
        "weekday": 8, "start_time": "09:00", "end_time": "10:00",
    })
    assert r.status_code == 400
    assert r.get_json()["error"] == "invalid_weekday"

    r = client.post("/api/schedule/courses", json={
        "child_name": "x", "course_name": "y",
        "weekday": 6, "start_time": "25:00", "end_time": "10:00",
    })
    assert r.status_code == 400
    assert r.get_json()["error"] == "invalid_start_time"

    r = client.post("/api/schedule/courses", json={
        "child_name": "x", "course_name": "y",
        "weekday": 6, "start_time": "10:00", "end_time": "09:00",
    })
    assert r.status_code == 400
    assert r.get_json()["error"] == "end_before_start"


def test_tenant_isolation(client, helpers):
    """A 创建的课 B 看不到也删不掉."""
    # A 登录 + 创建
    helpers.register_student(client, username="alice", password="alice1234", name="A")
    helpers.login(client, "alice", "alice1234")
    r = client.post("/api/schedule/courses", json={
        "child_name": "a_kid", "course_name": "z",
        "weekday": 6, "start_time": "09:00", "end_time": "10:00",
    })
    cid = r.get_json()["id"]
    helpers.logout(client)

    # B 登录 —— 看不到
    helpers.register_student(client, username="bob", password="bob12345", name="B")
    helpers.login(client, "bob", "bob12345")
    r = client.get("/api/schedule/courses")
    assert r.get_json() == []

    # B 不能删 A 的
    r = client.delete(f"/api/schedule/courses/{cid}")
    assert r.status_code == 403

    # B 也不能改 A 的
    r = client.put(f"/api/schedule/courses/{cid}", json={
        "child_name": "x", "course_name": "y",
        "weekday": 6, "start_time": "09:00", "end_time": "10:00",
    })
    assert r.status_code == 403
