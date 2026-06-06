"""Skills API for external agent schedule queries."""


def _login_and_seed(client, helpers):
    helpers.register_student(client, username="skills-user", password="skills1234", name="Skills")
    helpers.login(client, "skills-user", "skills1234")
    seed = client.post("/api/schedule/seed-family")
    assert seed.status_code == 200


def test_lists_schedule_query_skill(client):
    resp = client.get("/api/skills")

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["skills"][0]["name"] == "schedule.query"
    assert body["skills"][0]["auth"]["type"] == "bearer"
    assert body["skills"][0]["input_schema"]["properties"]["date"]["type"] == "string"
    assert body["skills"][0]["endpoints"]["skill_url"].endswith("/api/skills/schedule.query/SKILL.md")


def test_schedule_query_skill_exposes_public_install_assets(client):
    manifest_resp = client.get("/api/skills/schedule.query/manifest.json")
    skill_resp = client.get("/api/skills/schedule.query/SKILL.md")
    openapi_resp = client.get("/api/skills/schedule.query/openapi.json")
    well_known_resp = client.get("/.well-known/edu-skills.json")

    assert manifest_resp.status_code == 200
    manifest = manifest_resp.get_json()
    assert manifest["name"] == "schedule.query"
    assert manifest["install"]["openclaw"]["requires_env"] == ["EDU_BEARER_TOKEN"]
    assert manifest["install"]["hermes"]["url"].endswith("/api/skills/schedule.query/SKILL.md")

    assert skill_resp.status_code == 200
    skill_md = skill_resp.get_data(as_text=True)
    assert "name: edu-course-schedule" in skill_md
    assert "EDU_BEARER_TOKEN" in skill_md
    assert "/api/skills/schedule.query/invoke" in skill_md

    assert openapi_resp.status_code == 200
    openapi = openapi_resp.get_json()
    assert openapi["components"]["securitySchemes"]["bearerAuth"]["scheme"] == "bearer"
    assert "/api/skills/schedule.query/invoke" in openapi["paths"]

    assert well_known_resp.status_code == 200
    assert well_known_resp.get_json()["skills"][0]["name"] == "schedule.query"


def test_schedule_query_skill_requires_authentication(client):
    resp = client.post("/api/skills/schedule.query/invoke", json={"date": "2026-05-31"})

    assert resp.status_code == 401


def test_schedule_query_skill_returns_courses_for_date_and_child(client, helpers):
    _login_and_seed(client, helpers)

    resp = client.post(
        "/api/skills/schedule.query/invoke",
        json={"date": "2026-05-31", "child": "潘友闻"},
    )

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["ok"] is True
    assert body["skill"] == "schedule.query"
    assert body["result"]["date"] == "2026-05-31"
    assert body["result"]["weekday"] == 7
    assert body["result"]["child"] == "潘友闻"
    assert [c["course_name"] for c in body["result"]["courses"]] == [
        "原力数学",
        "杨老师语文",
        "唱歌",
    ]
    assert body["result"]["courses"][0]["start_time"] == "10:10"
    assert body["result"]["courses"][0]["location"] == "403-1"


def test_schedule_query_skill_accepts_bearer_token(client, helpers):
    _login_and_seed(client, helpers)
    token_resp = client.post(
        "/api/auth/token-login",
        json={"username": "skills-user", "password": "skills1234"},
    )
    token = token_resp.get_json()["token"]
    helpers.logout(client)

    resp = client.post(
        "/api/skills/schedule.query/invoke",
        json={"date": "2026-05-30", "child": "潘立言"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["result"]["courses"][0]["course_name"] == "黄语文"


def test_schedule_query_skill_rejects_invalid_date(client, helpers):
    _login_and_seed(client, helpers)

    resp = client.post("/api/skills/schedule.query/invoke", json={"date": "2026/05/31"})

    assert resp.status_code == 400
    assert resp.get_json()["error"] == "invalid_date"


def test_unknown_skill_returns_not_found(client, helpers):
    _login_and_seed(client, helpers)

    resp = client.post("/api/skills/unknown.invoke/invoke", json={})

    assert resp.status_code == 404
