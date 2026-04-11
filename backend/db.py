"""SQLite schema + helpers for the 教育模块."""
import sqlite3
from pathlib import Path
from contextlib import contextmanager

DB_PATH = Path(__file__).parent / "data" / "edu.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS exams (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    exam_name    TEXT    NOT NULL,
    exam_date    TEXT,                       -- YYYY-MM-DD (可空)
    stage        TEXT,                       -- 初一上/初一下/初二上/初二下
    total        REAL,
    class_rank   INTEGER,
    grade_rank   INTEGER,
    notes        TEXT,
    sort_order   INTEGER DEFAULT 0,          -- 用于按时间顺序展示
    created_at   TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scores (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    exam_id   INTEGER NOT NULL,
    subject   TEXT    NOT NULL,              -- 科学/英语/数学/语文/社会
    score     REAL    NOT NULL,
    full_mark REAL,
    FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    week         INTEGER NOT NULL,            -- 1~4
    day_of_week  INTEGER NOT NULL,            -- 1~7 (周一~周日)
    subject      TEXT,                        -- 可空
    title        TEXT    NOT NULL,
    description  TEXT,
    minutes      INTEGER DEFAULT 15,
    priority     INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS checkins (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id          INTEGER NOT NULL,
    checkin_date     TEXT    NOT NULL,        -- YYYY-MM-DD
    completed        INTEGER DEFAULT 1,
    duration_minutes INTEGER,
    note             TEXT,
    created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(task_id, checkin_date),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mistakes (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    subject          TEXT    NOT NULL,        -- 科学/英语/数学/语文/社会
    exam_name        TEXT,                    -- 来自哪次考试/作业
    question_text    TEXT,
    wrong_answer     TEXT,
    correct_answer   TEXT,
    reason           TEXT    NOT NULL,        -- 计算错/审题漏/不会做/步骤乱/知识遗忘/其他
    knowledge_point  TEXT,
    mastered         INTEGER DEFAULT 0,
    created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
    mastered_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_scores_exam ON scores(exam_id);
CREATE INDEX IF NOT EXISTS idx_scores_subject ON scores(subject);
CREATE INDEX IF NOT EXISTS idx_checkins_date ON checkins(checkin_date);
CREATE INDEX IF NOT EXISTS idx_tasks_week ON tasks(week, day_of_week);
CREATE INDEX IF NOT EXISTS idx_mistakes_subject ON mistakes(subject);
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
