"""范文生成必须异步，且不能把学生原文发给模型。"""


def test_model_essay_is_async_and_excludes_student_content(client, helpers, monkeypatch):
    helpers.register_student(client, username="alice")
    sentinel = "PRIVATE_STUDENT_ESSAY_DO_NOT_SEND"
    created = client.post(
        "/api/essays",
        json={
            "content": sentinel + " 一篇很长的学生作文",
            "title": "我的秘密标题",
            "essay_type": "记叙文",
            "topic": "一次勇敢的尝试",
        },
    )
    assert created.status_code == 201
    essay_id = created.get_json()["id"]

    import routes.essays as essays

    submitted = {}

    def capture_submit(fn, *args, **kwargs):
        submitted["fn"] = fn
        submitted["args"] = args
        submitted["kwargs"] = kwargs

    monkeypatch.setattr(essays, "bg_submit", capture_submit)
    queued = client.post(f"/api/essays/{essay_id}/model-essay")
    assert queued.status_code == 202
    job_id = queued.get_json()["job_id"]
    assert submitted["fn"].__name__ == "_run_model_essay_bg"
    assert sentinel not in repr(submitted["args"])

    captured = {}

    class FakeLLM:
        model = "fake"

        def chat(self, messages, **_kwargs):
            captured["prompt"] = repr(messages)
            return "{}"

    monkeypatch.setattr(essays, "get_llm", lambda: FakeLLM())
    monkeypatch.setattr(
        essays,
        "parse_json_or_retry",
        lambda *_args: {
            "title": "范文",
            "content": "新的独立范文",
            "highlights": ["结构清晰"],
            "structure_note": "首尾呼应",
        },
    )
    submitted["fn"](*submitted["args"], **submitted["kwargs"])

    assert sentinel not in captured["prompt"]
    assert "我的秘密标题" not in captured["prompt"]
    result = client.get(f"/api/essays/model-essay/{job_id}")
    assert result.status_code == 200
    assert result.get_json()["result"]["content"] == "新的独立范文"
