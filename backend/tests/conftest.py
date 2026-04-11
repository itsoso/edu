"""pytest 固件: 临时 DB + 测试 Flask client.

每个测试函数拿一份全新的空 DB, 所以测试之间不会串数据.
"""
import os
import sys
import tempfile
from pathlib import Path

import pytest

# 把 backend/ 加进 sys.path 让 tests 可以 import db/app
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

# 把 DB 路径指向临时文件 — 必须在 import db 之前!
_tmpdir = tempfile.mkdtemp(prefix="edu_test_")
os.environ["EDU_TEST_MODE"] = "1"


@pytest.fixture
def test_db_path(tmp_path, monkeypatch):
    """每个测试一份独立 DB. 同时 patch UPLOAD_DIR 到 tmp_path."""
    import db as db_module
    import constants

    fake_db = tmp_path / "edu.db"
    fake_uploads = tmp_path / "uploads"
    fake_uploads.mkdir()

    monkeypatch.setattr(db_module, "DB_PATH", fake_db)
    monkeypatch.setattr(constants, "UPLOAD_DIR", fake_uploads)
    monkeypatch.setattr("routes.uploads.UPLOAD_DIR", fake_uploads)

    db_module.init_db()
    yield fake_db


@pytest.fixture
def client(test_db_path, monkeypatch):
    """Flask test client, 每个 case 独立 session cookie."""
    # 阻止 cleanup daemon 在测试里起线程
    import cleanup
    monkeypatch.setattr(cleanup, "start_cleanup_daemon", lambda: None)

    # 必须在 DB 替换之后 import app
    from app import create_app
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


@pytest.fixture
def helpers():
    """Callable helpers, avoid needing to import conftest directly."""
    class H:
        @staticmethod
        def register_student(client, username="alice", password="alice1234", name="Alice"):
            resp = client.post(
                "/api/auth/register",
                json={
                    "role": "student",
                    "username": username,
                    "password": password,
                    "display_name": name,
                    "stage": "初二下",
                },
            )
            assert resp.status_code == 200, resp.get_json()
            return resp.get_json()["user"]

        @staticmethod
        def register_parent(client, join_code, username="mom", password="mom12345", name="妈妈"):
            return client.post(
                "/api/auth/register",
                json={
                    "role": "parent",
                    "username": username,
                    "password": password,
                    "display_name": name,
                    "join_code": join_code,
                },
            )

        @staticmethod
        def login(client, username, password):
            return client.post(
                "/api/auth/login",
                json={"username": username, "password": password},
            )

        @staticmethod
        def logout(client):
            return client.post("/api/auth/logout")

    return H()
