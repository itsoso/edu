"""Reflections 测试. 除了基本 CRUD + 隔离, 还强制执行"AI 永远看不到"的架构保证."""
import re
from pathlib import Path

import pytest


# ---------------- CRUD 基础 ----------------
def test_create_free_write(client, helpers):
    helpers.register_student(client, username="alice")
    resp = client.post(
        "/api/reflections",
        json={"kind": "free_write", "content": "今天数学很难, 但我坚持了."},
    )
    assert resp.status_code == 201
    row = resp.get_json()
    assert row["kind"] == "free_write"
    assert row["content"].startswith("今天数学")
    assert row["owner_user_id"]  # set


def test_create_requires_content(client, helpers):
    helpers.register_student(client, username="alice")
    resp = client.post("/api/reflections", json={"kind": "free_write", "content": ""})
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "empty_content"


def test_invalid_kind_rejected(client, helpers):
    helpers.register_student(client, username="alice")
    resp = client.post(
        "/api/reflections",
        json={"kind": "gossip", "content": "x"},
    )
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "invalid_kind"


def test_content_length_capped(client, helpers):
    helpers.register_student(client, username="alice")
    resp = client.post(
        "/api/reflections",
        json={"kind": "free_write", "content": "x" * 2001},
    )
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "content_too_long"


# ---------------- Upsert 语义 (一题一条) ----------------
def test_mistake_note_upserts(client, helpers):
    helpers.register_student(client, username="alice")

    # 先建一道错题获得 id
    mresp = client.post(
        "/api/mistakes",
        json={"subject": "数学", "reason": "计算错", "question_text": "2x+5=15"},
    )
    mid = mresp.get_json()["id"]

    # 第一次写
    r1 = client.post(
        "/api/reflections",
        json={"kind": "mistake_note", "related_id": mid, "content": "当时想复杂了"},
    )
    assert r1.status_code == 201
    id1 = r1.get_json()["id"]

    # 第二次写同一道错题 — 应该 update 而不是新建
    r2 = client.post(
        "/api/reflections",
        json={"kind": "mistake_note", "related_id": mid, "content": "现在懂了"},
    )
    assert r2.status_code == 200  # update 返回 200 不是 201
    assert r2.get_json()["id"] == id1  # 同一条
    assert r2.get_json()["content"] == "现在懂了"

    # list 应该只有 1 条
    resp = client.get(f"/api/reflections?kind=mistake_note&related_id={mid}")
    items = resp.get_json()
    assert len(items) == 1


def test_mistake_note_without_related_id_rejected(client, helpers):
    helpers.register_student(client, username="alice")
    resp = client.post(
        "/api/reflections",
        json={"kind": "mistake_note", "content": "some note"},
    )
    assert resp.status_code == 400


def test_weekly_note_uses_related_key(client, helpers):
    helpers.register_student(client, username="alice")
    resp = client.post(
        "/api/reflections",
        json={
            "kind": "weekly_note",
            "related_key": "2026-04-06",
            "content": "本周我学到了..."
        },
    )
    assert resp.status_code == 201

    # 第二次 upsert 应替换
    resp2 = client.post(
        "/api/reflections",
        json={
            "kind": "weekly_note",
            "related_key": "2026-04-06",
            "content": "updated"
        },
    )
    assert resp2.status_code == 200
    assert resp2.get_json()["content"] == "updated"


def test_free_write_always_inserts(client, helpers):
    """free_write 每次都是新条目, 不 upsert."""
    helpers.register_student(client, username="alice")
    for content in ["第一篇", "第二篇", "第三篇"]:
        client.post("/api/reflections", json={"kind": "free_write", "content": content})
    items = client.get("/api/reflections?kind=free_write").get_json()
    assert len(items) == 3


# ---------------- 跨租户隔离 ----------------
def test_reflections_cross_tenant_isolation(client, helpers):
    helpers.register_student(client, username="alice")
    r = client.post("/api/reflections", json={"kind": "free_write", "content": "alice 写的"})
    alice_ref_id = r.get_json()["id"]
    helpers.logout(client)

    helpers.register_student(client, username="bob")
    # bob 看自己的应该为 0
    assert client.get("/api/reflections").get_json() == []

    # bob 尝试删 alice 的 -> 403
    assert client.delete(f"/api/reflections/{alice_ref_id}").status_code == 403


def test_reflections_requires_login(client):
    resp = client.post("/api/reflections", json={"kind": "free_write", "content": "x"})
    assert resp.status_code == 401
    assert client.get("/api/reflections").status_code == 401


# ---------------- Stats ----------------
def test_reflections_stats(client, helpers):
    helpers.register_student(client, username="alice")
    for c in ["aaa", "bbbb"]:
        client.post("/api/reflections", json={"kind": "free_write", "content": c})
    client.post(
        "/api/reflections",
        json={"kind": "weekly_note", "related_key": "2026-04-06", "content": "weekly"},
    )
    stats = client.get("/api/reflections/stats").get_json()
    by_kind = {r["kind"]: r for r in stats}
    assert by_kind["free_write"]["count"] == 2
    assert by_kind["free_write"]["total_chars"] == 3 + 4
    assert by_kind["weekly_note"]["count"] == 1


# ---------------- 架构保证: AI 永远看不到 reflections ----------------
def test_llm_module_does_not_import_reflections():
    """llm.py 和 llm_audit.py 不能 import reflections 模块或提到 reflections 表."""
    backend_dir = Path(__file__).resolve().parent.parent
    for fname in ("llm.py", "llm_audit.py"):
        src = (backend_dir / fname).read_text()
        assert "reflections" not in src, (
            f"{fname} mentions 'reflections' — 违反阶段 2 架构保证! "
            f"reflections 表的内容永远不能进入 LLM 调用链."
        )


def test_background_tasks_do_not_read_reflections():
    """所有调 llm 的 bg 任务 (uploads/practice/reports/tasks) 都不能 SELECT reflections."""
    backend_dir = Path(__file__).resolve().parent.parent
    suspect_files = [
        "routes/uploads.py",
        "routes/practice.py",
        "routes/reports.py",
        "routes/tasks.py",
    ]
    for rel in suspect_files:
        src = (backend_dir / rel).read_text()
        # 如果文件里既有 get_llm/llm_audit 又有 'reflections', 就是红旗
        has_llm = bool(re.search(r"\b(get_llm|llm_audit|vision_chat)\b", src))
        has_reflections = "reflections" in src
        assert not (has_llm and has_reflections), (
            f"{rel} 同时引用 LLM 和 reflections — "
            f"reflections 永远不能被喂给 LLM, 这是阶段 2 的核心设计保证"
        )
