"""Flask backend for 教育模块 (edu) — 多租户版本.

App 工厂, 负责:
- 基础配置 (secret key, cookie, CORS, body size)
- 初始化 SQLite schema (CREATE TABLE IF NOT EXISTS, 幂等)
- 注册所有业务 blueprints
- 启动后台清理 daemon

业务端点按域拆在 routes/ 目录下, 每个 blueprint 一个文件.
"""
import logging
import os

from flask import Flask
from flask_cors import CORS

# 生产环境 gunicorn 把 stdout/stderr 捕获到 /var/log/edu/backend.{log,err}
# 这里统一配 basicConfig 让各模块的 logger 都能输出到那里
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)

from db import init_db
from auth import get_secret_key
from constants import MAX_UPLOAD_BYTES
from cleanup import start_cleanup_daemon

from routes.auth_routes import bp as auth_bp
from routes.exams import bp as exams_bp
from routes.tasks import bp as tasks_bp
from routes.mistakes import bp as mistakes_bp
from routes.uploads import bp as uploads_bp
from routes.practice import bp as practice_bp
from routes.reports import bp as reports_bp
from routes.content import bp as content_bp
from routes.admin_stats import bp as admin_stats_bp
from routes.reflections import bp as reflections_bp
from routes.goals import bp as goals_bp
from routes.journal_media import bp as journal_media_bp
from routes.essays import bp as essays_bp
from routes.signals import bp as signals_bp
from routes.profile import bp as profile_bp
from routes.agent import bp as agent_bp
from routes.feynman import bp as feynman_bp
from routes.reflector import bp as reflector_bp
from routes.curator import bp as curator_bp
from routes.coach import bp as coach_bp
from routes.guardian import bp as guardian_bp
from routes.schedule import bp as schedule_bp
from routes.assignments import bp as assignments_bp
from routes.user_export import bp as user_export_bp


def create_app() -> Flask:
    # 任何启动路径 (flask dev / gunicorn / server.py) 都确保 schema 最新.
    # CREATE TABLE IF NOT EXISTS 是幂等的.
    init_db()

    app = Flask(__name__)
    # 全局 body 上限覆盖视频上传 (25MB). 各端点有自己的细粒度检查.
    app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024
    app.config["SECRET_KEY"] = get_secret_key()
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
    app.config["SESSION_COOKIE_HTTPONLY"] = True

    if os.environ.get("EDU_ENV") == "prod":
        app.config["SESSION_COOKIE_SECURE"] = True
        app.config["PREFERRED_URL_SCHEME"] = "https"
        # 生产环境由 nginx 统一域名, 同源无需 CORS 白名单
        CORS(app, supports_credentials=True)
    else:
        CORS(
            app,
            supports_credentials=True,
            origins=["http://127.0.0.1:5173", "http://localhost:5173"],
        )

    # 注册 blueprints
    for bp in (auth_bp, exams_bp, tasks_bp, mistakes_bp,
               uploads_bp, practice_bp, reports_bp, content_bp,
               admin_stats_bp, reflections_bp, goals_bp, journal_media_bp,
               essays_bp, signals_bp, profile_bp, agent_bp, feynman_bp,
               reflector_bp, curator_bp, coach_bp, guardian_bp, schedule_bp,
               assignments_bp, user_export_bp):
        app.register_blueprint(bp)

    # 启动后台清理 daemon (30 天前的试卷原图). 幂等, 多 worker 每个进程自己起.
    start_cleanup_daemon()

    return app


# gunicorn / flask dev / server.py 都 import 这个模块级别的 app
app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5060, debug=True)
