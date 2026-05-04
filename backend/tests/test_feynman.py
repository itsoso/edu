"""Feynman manual-kp session: 学生主动声明知识点, 作为正向 mastery 信号."""
import json


def _start_manual(client, **body):
    return client.post("/api/feynman/start", json=body)


def test_start_manual_kp_happy_path(client, helpers):
    helpers.register_student(client, username="alice")
    resp = _start_manual(
        client,
        source_table="manual",
        subject="数学",
        knowledge_point="勾股定理",
        learned_from="课堂",
    )
    assert resp.status_code == 200, resp.get_json()
    data = resp.get_json()
    assert data["session_id"] > 0
    assert data["topic_seed"] == "勾股定理"
    assert data["max_turns"] == 4
    # opening 来自 fallback (LLM 未配置), 但起码非空
    assert isinstance(data.get("opening_question"), str) and data["opening_question"]


def test_start_manual_kp_persists_columns(client, helpers):
    """确认 manual_subject / manual_knowledge_point / manual_source_note 落库."""
    from db import db

    helpers.register_student(client, username="alice")
    resp = _start_manual(
        client,
        subject="科学",
        knowledge_point="浮力",
        learned_from="B 站某视频",
    )
    assert resp.status_code == 200, resp.get_json()
    sid = resp.get_json()["session_id"]
    with db() as conn:
        row = conn.execute(
            "SELECT source_table, manual_subject, manual_knowledge_point, manual_source_note "
            "FROM feynman_sessions WHERE id = ?",
            (sid,),
        ).fetchone()
    assert row is not None
    assert row["source_table"] == "manual"
    assert row["manual_subject"] == "科学"
    assert row["manual_knowledge_point"] == "浮力"
    assert row["manual_source_note"] == "B 站某视频"


def test_start_manual_kp_invalid_subject(client, helpers):
    helpers.register_student(client, username="alice")
    resp = _start_manual(client, subject="编程", knowledge_point="变量")
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "invalid_subject"


def test_start_manual_kp_missing_knowledge_point(client, helpers):
    helpers.register_student(client, username="alice")
    resp = _start_manual(client, subject="数学", learned_from="课堂")
    assert resp.status_code == 400
    assert resp.get_json()["error"] in ("knowledge_point_required", "invalid_subject")
    # 同样若只传 learned_from 也 400
    resp2 = _start_manual(client, learned_from="课堂")
    assert resp2.status_code == 400


def test_start_manual_kp_too_long_fields(client, helpers):
    helpers.register_student(client, username="alice")
    resp = _start_manual(client, subject="数学", knowledge_point="x" * 200)
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "knowledge_point_too_long"

    resp2 = _start_manual(
        client, subject="数学", knowledge_point="合法 KP", learned_from="y" * 500,
    )
    assert resp2.status_code == 400
    assert resp2.get_json()["error"] == "learned_from_too_long"


def test_start_manual_kp_owner_isolation(client, helpers):
    helpers.register_student(client, username="alice")
    resp = _start_manual(client, subject="数学", knowledge_point="一次函数")
    assert resp.status_code == 200
    sid = resp.get_json()["session_id"]

    # 切到 bob
    helpers.logout(client)
    helpers.register_student(client, username="bob", name="Bob")

    # bob 拿不到 alice 的 session
    resp_get = client.get(f"/api/feynman/{sid}")
    assert resp_get.status_code == 404

    # bob 的 list 不含 alice 的 session
    resp_list = client.get("/api/feynman/sessions")
    assert resp_list.status_code == 200
    assert all(s["id"] != sid for s in resp_list.get_json())


def test_start_conflicting_source_manual_fields(client, helpers):
    """传了 subject/kp 又显式写 source_table=mistakes → 400."""
    helpers.register_student(client, username="alice")
    resp = _start_manual(
        client,
        source_table="mistakes",
        source_id=1,
        subject="数学",
        knowledge_point="勾股定理",
    )
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "manual_fields_require_manual_source"


# ==========================================================
# recent-kps: 最近讲过的知识点 (for FeynmanNew chips)
# ==========================================================

def test_recent_kps_empty_when_no_manual_sessions(client, helpers):
    helpers.register_student(client, username="alice")
    resp = client.get("/api/feynman/recent-kps")
    assert resp.status_code == 200
    assert resp.get_json() == []


def test_recent_kps_dedupe_and_count(client, helpers):
    """同一 (subject, kp) 多次讲, 返回 session_count=N, 单条."""
    helpers.register_student(client, username="alice")
    for _ in range(3):
        r = _start_manual(client, subject="数学", knowledge_point="勾股定理")
        assert r.status_code == 200
    # 再讲一个不同的
    r = _start_manual(client, subject="科学", knowledge_point="浮力")
    assert r.status_code == 200

    resp = client.get("/api/feynman/recent-kps")
    assert resp.status_code == 200
    data = resp.get_json()
    # 应去重到 2 条
    keys = [(d["subject"], d["knowledge_point"]) for d in data]
    assert ("数学", "勾股定理") in keys
    assert ("科学", "浮力") in keys
    assert len(data) == 2
    # count 反映次数
    gougu = next(d for d in data if d["knowledge_point"] == "勾股定理")
    assert gougu["session_count"] == 3
    assert gougu["last_understood"] is False  # 都没 finish


def test_recent_kps_order_by_most_recent(client, helpers):
    """先讲 A, 再讲 B → B 排前面."""
    helpers.register_student(client, username="alice")
    _start_manual(client, subject="数学", knowledge_point="A题")
    _start_manual(client, subject="数学", knowledge_point="B题")
    resp = client.get("/api/feynman/recent-kps")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data[0]["knowledge_point"] == "B题"
    assert data[1]["knowledge_point"] == "A题"


def test_recent_kps_isolation(client, helpers):
    """alice 讲过的不能被 bob 看到."""
    helpers.register_student(client, username="alice")
    _start_manual(client, subject="数学", knowledge_point="勾股定理")
    helpers.logout(client)
    helpers.register_student(client, username="bob", name="Bob")
    resp = client.get("/api/feynman/recent-kps")
    assert resp.status_code == 200
    assert resp.get_json() == []


def test_recent_kps_respects_limit(client, helpers):
    helpers.register_student(client, username="alice")
    for i in range(5):
        _start_manual(client, subject="数学", knowledge_point=f"kp{i}")
    resp = client.get("/api/feynman/recent-kps?limit=3")
    assert resp.status_code == 200
    assert len(resp.get_json()) == 3


def test_session_detail_surfaces_manual_fields(client, helpers):
    """GET /feynman/<id> 返回 manual_subject / manual_knowledge_point,
    前端据此在 assessment 卡片上展示 "已计入 {subject} 知识图谱"."""
    helpers.register_student(client, username="alice")
    resp = _start_manual(
        client, subject="科学", knowledge_point="浮力", learned_from="课堂",
    )
    sid = resp.get_json()["session_id"]

    # 单个 session
    detail = client.get(f"/api/feynman/{sid}")
    assert detail.status_code == 200
    d = detail.get_json()
    assert d["manual_subject"] == "科学"
    assert d["manual_knowledge_point"] == "浮力"

    # list 也带上 (FeynmanHistory 使用)
    listing = client.get("/api/feynman/sessions")
    assert listing.status_code == 200
    row = next(x for x in listing.get_json() if x["id"] == sid)
    assert row["manual_subject"] == "科学"
    assert row["manual_knowledge_point"] == "浮力"
