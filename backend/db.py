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

-- 试卷上传: 原图 + LLM 分析结果缓存
CREATE TABLE IF NOT EXISTS exam_uploads (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id    INTEGER NOT NULL,
    file_path        TEXT    NOT NULL,              -- 相对 data/uploads/ 的路径
    file_name        TEXT,                          -- 原始文件名
    subject          TEXT,                          -- LLM 识别的科目
    exam_name        TEXT,                          -- 用户填写的考试名
    status           TEXT    DEFAULT 'uploaded',    -- uploaded|extracted|analyzed|failed
    extracted_json   TEXT,                          -- /mistakes 抽取结果 (JSON)
    analysis_json    TEXT,                          -- /analysis 全卷分析 (JSON)
    error_message    TEXT,
    created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 训练题集: 基于哪道错题生成的
CREATE TABLE IF NOT EXISTS practice_sets (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id     INTEGER NOT NULL,
    source_mistake_id INTEGER,                      -- 可空: 也允许不绑定错题
    title             TEXT    NOT NULL,
    subject           TEXT,
    knowledge_point   TEXT,
    status            TEXT    DEFAULT 'done',       -- generating|done|failed
    error_message     TEXT,
    created_at        TEXT    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_user_id)     REFERENCES users(id)     ON DELETE CASCADE,
    FOREIGN KEY (source_mistake_id) REFERENCES mistakes(id)  ON DELETE SET NULL
);

-- 周目标: 她每周一主动设定的学习目标 (阶段 3)
-- 设计理由: 元学习的核心是"识别自己当下该学什么".
-- 没有 goal 时系统不强塞, 让她感受到选择的空间.
CREATE TABLE IF NOT EXISTS weekly_goals (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id   INTEGER NOT NULL,
    week_start      TEXT    NOT NULL,             -- YYYY-MM-DD (周一)
    goal_text       TEXT    NOT NULL,             -- 她写的目标
    focus_type      TEXT,                          -- 'redo_mistakes'|'learn_new'|'challenge'|'custom'
    created_at      TEXT    DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(owner_user_id, week_start),
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 任务覆盖: 她对模板任务的"跳过/替换" (阶段 3)
-- 设计理由: 默认状态应该是空的, 她不选才用模板.
-- 但为了不动现有 tasks 表, 用覆盖层实现 — 模板任务保留, 覆盖是一层.
-- action ∈ { skip | replace }
--   skip: 本周跳过这个任务, 不算数
--   replace: 用她自己的内容替换, custom_title/description 生效
CREATE TABLE IF NOT EXISTS task_overrides (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id   INTEGER NOT NULL,
    task_id         INTEGER NOT NULL,             -- → tasks.id (模板任务)
    week_start      TEXT    NOT NULL,             -- YYYY-MM-DD 归属哪一周
    action          TEXT    NOT NULL,
    custom_title    TEXT,
    custom_description TEXT,
    custom_minutes  INTEGER,
    created_at      TEXT    DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(owner_user_id, task_id, week_start),
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (task_id)       REFERENCES tasks(id) ON DELETE CASCADE
);

-- 反思 / 主观表达 (她的声音). **这张表永远不喂给 LLM**.
-- kind ∈ { mistake_note | weekly_note | free_write | exam_feeling }
-- 设计理由: 学习不只是数据, 还有她对学习的感受和思考.
-- 一旦 AI 开始分析, 她会为了被 AI 理解而写, 不是为了她自己.
-- 严格禁止在任何 LLM prompt / llm_audit / background task 里读取这张表.
CREATE TABLE IF NOT EXISTS reflections (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id   INTEGER NOT NULL,
    kind            TEXT    NOT NULL,
    related_id      INTEGER,                    -- mistake.id / exam.id, null 时用 related_key
    related_key     TEXT,                        -- 例: "2026-04-06" (周一日期) for weekly_note
    content         TEXT    NOT NULL,
    created_at      TEXT    DEFAULT CURRENT_TIMESTAMP,
    updated_at      TEXT    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 每日一句话建议 (按 owner + date 缓存, 每天只调一次 LLM)
CREATE TABLE IF NOT EXISTS daily_tips (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id  INTEGER NOT NULL,
    tip_date       TEXT    NOT NULL,             -- YYYY-MM-DD
    content        TEXT    DEFAULT '',
    status         TEXT    DEFAULT 'done',       -- generating | done | failed
    error_message  TEXT,
    created_at     TEXT    DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(owner_user_id, tip_date),
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- LLM 调用审计日志 (成本/性能追踪)
CREATE TABLE IF NOT EXISTS llm_calls (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id  INTEGER,                       -- 可空 (后台任务时可能没 owner 上下文)
    endpoint       TEXT,                          -- 例: extract_mistakes / generate_practice
    model          TEXT,
    prompt_chars   INTEGER,                       -- 用字符数作为 token 代理
    response_chars INTEGER,
    latency_ms     INTEGER,
    status         TEXT,                          -- ok | error
    error_message  TEXT,
    created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 月度复盘报告 (LLM 生成, 按 month 缓存)
CREATE TABLE IF NOT EXISTS monthly_reports (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER NOT NULL,
    month         TEXT    NOT NULL,                 -- YYYY-MM
    content_md    TEXT    NOT NULL DEFAULT '',     -- Markdown 报告正文 (生成中为空)
    metrics_json  TEXT,                             -- 原始指标, 便于前端二次渲染
    status        TEXT    DEFAULT 'done',          -- generating|done|failed
    error_message TEXT,
    created_at    TEXT    DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(owner_user_id, month),
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 训练题条目
CREATE TABLE IF NOT EXISTS practice_items (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    set_id           INTEGER NOT NULL,
    question_text    TEXT    NOT NULL,
    expected_answer  TEXT,
    solution_steps   TEXT,
    difficulty       TEXT,
    student_answer   TEXT,
    is_correct       INTEGER,                       -- NULL=未作答, 0=错, 1=对
    score            INTEGER,                       -- 0-100
    feedback         TEXT,
    graded_at        TEXT,
    FOREIGN KEY (set_id) REFERENCES practice_sets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_exams_owner        ON exams(owner_user_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_scores_exam        ON scores(exam_id);
CREATE INDEX IF NOT EXISTS idx_tasks_owner        ON tasks(owner_user_id, week, day_of_week);
CREATE INDEX IF NOT EXISTS idx_checkins_task      ON checkins(task_id, checkin_date);
CREATE INDEX IF NOT EXISTS idx_checkins_date      ON checkins(checkin_date);
CREATE INDEX IF NOT EXISTS idx_mistakes_owner     ON mistakes(owner_user_id, subject);
CREATE INDEX IF NOT EXISTS idx_users_student      ON users(student_id);
CREATE INDEX IF NOT EXISTS idx_users_code         ON users(join_code);
CREATE INDEX IF NOT EXISTS idx_uploads_owner      ON exam_uploads(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_practice_sets_own  ON practice_sets(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_practice_items_set ON practice_items(set_id);
CREATE INDEX IF NOT EXISTS idx_monthly_reports_ow ON monthly_reports(owner_user_id, month DESC);
CREATE INDEX IF NOT EXISTS idx_daily_tips_owner    ON daily_tips(owner_user_id, tip_date DESC);
CREATE INDEX IF NOT EXISTS idx_reflections_owner_k ON reflections(owner_user_id, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reflections_related ON reflections(owner_user_id, kind, related_id);
CREATE INDEX IF NOT EXISTS idx_reflections_rkey    ON reflections(owner_user_id, kind, related_key);
CREATE INDEX IF NOT EXISTS idx_weekly_goals_owner   ON weekly_goals(owner_user_id, week_start DESC);
CREATE INDEX IF NOT EXISTS idx_task_overrides_week  ON task_overrides(owner_user_id, week_start);
CREATE INDEX IF NOT EXISTS idx_llm_calls_owner    ON llm_calls(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_calls_date     ON llm_calls(created_at DESC);
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


def _column_exists(conn, table: str, col: str) -> bool:
    cur = conn.execute(f"PRAGMA table_info({table})")
    return any(r[1] == col for r in cur.fetchall())


def _run_migrations(conn):
    """轻量 migration: 给已有表加新列. PRAGMA table_info 检查过后再 ALTER, 幂等."""
    # practice_sets.status / error_message
    if not _column_exists(conn, "practice_sets", "status"):
        conn.execute("ALTER TABLE practice_sets ADD COLUMN status TEXT DEFAULT 'done'")
    if not _column_exists(conn, "practice_sets", "error_message"):
        conn.execute("ALTER TABLE practice_sets ADD COLUMN error_message TEXT")
    # monthly_reports.status / error_message / content_md default
    if not _column_exists(conn, "monthly_reports", "status"):
        conn.execute("ALTER TABLE monthly_reports ADD COLUMN status TEXT DEFAULT 'done'")
    if not _column_exists(conn, "monthly_reports", "error_message"):
        conn.execute("ALTER TABLE monthly_reports ADD COLUMN error_message TEXT")


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with db() as conn:
        conn.executescript(SCHEMA)
        _run_migrations(conn)


def row_to_dict(row):
    return {k: row[k] for k in row.keys()} if row else None


def rows_to_dicts(rows):
    return [row_to_dict(r) for r in rows]


if __name__ == "__main__":
    init_db()
    print(f"Initialized DB at {DB_PATH}")
