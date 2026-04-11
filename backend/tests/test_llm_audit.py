"""LLM 调用审计测试."""
import pytest

from llm_audit import llm_audit
from db import db


def test_audit_writes_ok_row(client, helpers):
    # 先建个用户
    alice = helpers.register_student(client, username="alice")

    with llm_audit("test_endpoint", owner_id=alice["id"], model="test-model") as audit:
        audit.set_prompt_chars(100)
        audit.set_response_chars(200)

    with db() as conn:
        row = conn.execute(
            "SELECT * FROM llm_calls WHERE endpoint = 'test_endpoint'"
        ).fetchone()
    assert row is not None
    assert row["owner_user_id"] == alice["id"]
    assert row["status"] == "ok"
    assert row["prompt_chars"] == 100
    assert row["response_chars"] == 200
    assert row["latency_ms"] >= 0
    assert row["error_message"] is None


def test_audit_records_error_on_exception(client, helpers):
    alice = helpers.register_student(client, username="alice")

    with pytest.raises(ValueError):
        with llm_audit("failing_endpoint", owner_id=alice["id"]) as audit:
            audit.set_prompt_chars(50)
            raise ValueError("boom")

    with db() as conn:
        row = conn.execute(
            "SELECT * FROM llm_calls WHERE endpoint = 'failing_endpoint'"
        ).fetchone()
    assert row is not None
    assert row["status"] == "error"
    assert "boom" in (row["error_message"] or "")


def test_usage_endpoint(client, helpers):
    alice = helpers.register_student(client, username="alice")

    # 造几条假数据
    for endpoint in ["extract_mistakes", "extract_mistakes", "generate_practice"]:
        with llm_audit(endpoint, owner_id=alice["id"]) as audit:
            audit.set_prompt_chars(500)
            audit.set_response_chars(1000)

    resp = client.get("/api/stats/llm/usage")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["totals"]["calls"] == 3
    assert data["totals"]["ok"] == 3
    assert data["totals"]["total_prompt_chars"] == 1500
    # extract_mistakes 应该在 by_endpoint 里出现 2 次
    endpoints = {e["endpoint"]: e["calls"] for e in data["by_endpoint"]}
    assert endpoints.get("extract_mistakes") == 2
    assert endpoints.get("generate_practice") == 1


def test_usage_requires_login(client):
    resp = client.get("/api/stats/llm/usage")
    assert resp.status_code == 401
