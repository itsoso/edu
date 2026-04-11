"""错题本分页 + 过滤测试."""


def _register_and_create_many(client, helpers, count: int):
    helpers.register_student(client, username="alice")
    for i in range(count):
        client.post(
            "/api/mistakes",
            json={
                "subject": "数学" if i % 2 == 0 else "英语",
                "reason": "计算错" if i % 3 == 0 else "审题漏",
                "question_text": f"题目 {i}",
            },
        )


def test_default_limit(client, helpers):
    _register_and_create_many(client, helpers, 60)

    # 第一页 (默认 50)
    resp = client.get("/api/mistakes")
    assert resp.status_code == 200
    assert resp.headers.get("X-Total-Count") == "60"
    items = resp.get_json()
    assert len(items) == 50  # 默认 limit


def test_custom_limit_and_offset(client, helpers):
    _register_and_create_many(client, helpers, 60)

    # 取第 2 页
    resp = client.get("/api/mistakes?limit=30&offset=30")
    assert resp.status_code == 200
    assert resp.headers["X-Total-Count"] == "60"
    items = resp.get_json()
    assert len(items) == 30

    # 第 3 页应该只剩 0 条 (60 - 30 - 30 = 0)
    resp = client.get("/api/mistakes?limit=30&offset=60")
    assert len(resp.get_json()) == 0


def test_max_limit_capped(client, helpers):
    _register_and_create_many(client, helpers, 250)

    # 请求 500, 后端应该截断到 200
    resp = client.get("/api/mistakes?limit=500")
    items = resp.get_json()
    assert len(items) == 200
    assert resp.headers["X-Total-Count"] == "250"


def test_filter_with_pagination(client, helpers):
    _register_and_create_many(client, helpers, 60)

    # 按科目过滤: 数学有 30 条 (偶数 index)
    resp = client.get("/api/mistakes?subject=数学&limit=20")
    assert resp.headers["X-Total-Count"] == "30"
    items = resp.get_json()
    assert len(items) == 20
    assert all(m["subject"] == "数学" for m in items)


def test_invalid_limit_falls_back(client, helpers):
    _register_and_create_many(client, helpers, 5)
    # 非数字 limit 不应该崩
    resp = client.get("/api/mistakes?limit=abc")
    assert resp.status_code == 200
    assert len(resp.get_json()) == 5
