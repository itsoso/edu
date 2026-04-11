"""SQLite schema + helpers — 多租户版本."""
import sqlite3
from pathlib import Path
from contextlib import contextmanager

DB_PATH = Path(__file__).parent / "data" / "edu.db"

SCHEMA = """
-- 用户表: 学生 和 家长
CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    username       TEXT    UNIQUE NOT NULL,        -- 登录名
    password_hash  TEXT    NOT NULL,
    display_name   TEXT    NOT NULL,               -- 显示名称
    role           TEXT    NOT NULL,               -- 'student' | 'parent'
    student_id     INTEGER,                        -- role=parent 时指向学生 user.id
    join_code      TEXT    UNIQUE,                 -- role=student 时有值, 家长注册时凭此绑定
    stage          TEXT,                           -- 学生当前阶段 (初二下等)
    settings_json  TEXT,                           -- 学生个性化设置 (满分/科目)
    created_at     TEXT    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 考试记录: owner 始终是学生 user.id
CREATE TABLE IF NOT EXISTS exams (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id  INTEGER NOT NULL,
    exam_name      TEXT    NOT NULL,
    exam_date      TEXT,
    stage          TEXT,
    total          REAL,
    class_rank     INTEGER,
    grade_rank     INTEGER,
    notes          TEXT,
    sort_order     INTEGER DEFAULT 0,
    created_at     TEXT    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS scores (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    exam_id   INTEGER NOT NULL,
    subject   TEXT    NOT NULL,
    score     REAL    NOT NULL,
    full_mark REAL,
    FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
);

-- 任务: 每个学生有自己的一份计划(可编辑)
CREATE TABLE IF NOT EXISTS tasks (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id  INTEGER NOT NULL,
    week           INTEGER NOT NULL,
    day_of_week    INTEGER NOT NULL,
    subject        TEXT,
    title          TEXT    NOT NULL,
    description    TEXT,
    minutes        INTEGER DEFAULT 15,
    priority       INTEGER DEFAULT 0,
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS checkins (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id          INTEGER NOT NULL,
    checkin_date     TEXT    NOT NULL,
    completed        INTEGER DEFAULT 1,
    duration_minutes INTEGER,
    note             TEXT,
    created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(task_id, checkin_date),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mistakes (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id    INTEGER NOT NULL,
    subject          TEXT    NOT NULL,
    exam_name        TEXT,
    question_text    TEXT,
    wrong_answer     TEXT,
    correct_answer   TEXT,
    reason           TEXT    NOT NULL,
    knowledge_point  TEXT,
    mastered         INTEGER DEFAULT 0,
    created_at       TEXT    DEFAULT CURRENT_TIMESTAMP,
    mastered_at      TEXT,
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_exams_owner    ON exams(owner_user_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_scores_exam    ON scores(exam_id);
CREATE INDEX IF NOT EXISTS idx_tasks_owner    ON tasks(owner_user_id, week, day_of_week);
CREATE INDEX IF NOT EXISTS idx_checkins_task  ON checkins(task_id, checkin_date);
CREATE INDEX IF NOT EXISTS idx_checkins_date  ON checkins(checkin_date);
CREATE INDEX IF NOT EXISTS idx_mistakes_owner ON mistakes(owner_user_id, subject);
CREATE INDEX IF NOT EXISTS idx_users_student  ON users(student_id);
CREATE INDEX IF NOT EXISTS idx_users_code     ON users(join_code);
"""


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def db():
    conn = get_conn()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with db() as conn:
        conn.executescript(SCHEMA)


def row_to_dict(row):
    return {k: row[k] for k in row.keys()} if row else None


def rows_to_dicts(rows):
    return [row_to_dict(r) for r in rows]


if __name__ == "__main__":
    init_db()
    print(f"Initialized DB at {DB_PATH}")
