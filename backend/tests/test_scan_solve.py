"""拍照解题必须异步，并保留解题步骤。"""

from io import BytesIO


def test_scan_solve_returns_job_and_finishes_in_background(client, helpers, monkeypatch):
    helpers.register_student(client, username="alice")
    import routes.mistakes as mistakes

    submitted = {}

    def capture_submit(fn, *args, **kwargs):
        submitted["fn"] = fn
        submitted["args"] = args
        submitted["kwargs"] = kwargs

    monkeypatch.setattr(mistakes, "bg_submit", capture_submit, raising=False)
    response = client.post(
        "/api/mistakes/scan-solve",
        data={
            "file": (BytesIO(b"fake image"), "question.jpg"),
            "save_as_mistake": "1",
        },
        content_type="multipart/form-data",
    )

    assert response.status_code == 202
    job_id = response.get_json()["job_id"]
    assert submitted["fn"].__name__ == "_run_scan_solve_bg"
    assert client.get(f"/api/mistakes/scan-solve/{job_id}").status_code == 202

    class FakeLLM:
        model = "fake"

        def vision_chat(self, *_args, **_kwargs):
            return "{}"

    monkeypatch.setattr(mistakes, "get_llm", lambda: FakeLLM())
    monkeypatch.setattr(
        mistakes,
        "parse_json_or_retry",
        lambda *_args: {
            "question_text": "1+1=?",
            "subject": "数学",
            "knowledge_point": "加法",
            "difficulty": "easy",
            "answer": "2",
            "solution_steps": "1 加 1 等于 2",
            "common_mistakes": "看错符号",
        },
    )
    submitted["fn"](*submitted["args"], **submitted["kwargs"])

    response = client.get(f"/api/mistakes/scan-solve/{job_id}")
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["status"] == "done"
    assert payload["result"]["solution_steps"] == "1 加 1 等于 2"

    mistake_id = payload["result"]["mistake_id"]
    saved = client.get("/api/mistakes").get_json()
    assert next(item for item in saved if item["id"] == mistake_id)["solution_steps"] == "1 加 1 等于 2"


def test_create_mistake_persists_solution_steps(client, helpers):
    helpers.register_student(client, username="alice")
    response = client.post(
        "/api/mistakes",
        json={
            "subject": "数学",
            "reason": "不会",
            "question_text": "1+1=?",
            "solution_steps": "先数一，再数一",
        },
    )
    assert response.status_code == 201
    saved = client.get("/api/mistakes").get_json()[0]
    assert saved["solution_steps"] == "先数一，再数一"
