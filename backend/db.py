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
    subject_rank INTEGER,
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
    solution_steps   TEXT,                        -- 完整解题过程 (Markdown + LaTeX)
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
    tags              TEXT,                          -- JSON 数组, 如 ["专项突破", "中考真题"]
    created_at        TEXT    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_user_id)     REFERENCES users(id)     ON DELETE CASCADE,
    FOREIGN KEY (source_mistake_id) REFERENCES mistakes(id)  ON DELETE SET NULL
);

-- 家长"窥视"日志: 家长每次主动展开孩子数据时记录一次 (家长独立线)
-- 设计理由: 把家长从"被动监控者"转成"自觉观察者".
-- 月末告诉家长"你这个月展开了 X 次" — 让他/她自己看到参与度.
-- 这不是惩罚, 是反馈循环.
CREATE TABLE IF NOT EXISTS parent_views (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_user_id  INTEGER NOT NULL,              -- 家长 user.id
    student_id      INTEGER NOT NULL,              -- 他看的学生 user.id (冗余, 便于查询)
    view_type       TEXT    NOT NULL,              -- 'exams'|'mistakes'|'tasks'|'calendar'|'journal_stats'|'any'
    created_at      TEXT    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id)     REFERENCES users(id) ON DELETE CASCADE
);

-- 家长沉默周: 家长自己设置的本周不看承诺
-- 这是"家长为自己练习退出机制"的工具
CREATE TABLE IF NOT EXISTS parent_silent_weeks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_user_id  INTEGER NOT NULL,
    week_start      TEXT    NOT NULL,              -- YYYY-MM-DD (周一)
    note            TEXT,                           -- 可选: 他/她想对自己说的一句话
    created_at      TEXT    DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(parent_user_id, week_start),
    FOREIGN KEY (parent_user_id) REFERENCES users(id) ON DELETE CASCADE
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
CREATE INDEX IF NOT EXISTS idx_parent_views_parent  ON parent_views(parent_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_parent_silent_parent ON parent_silent_weeks(parent_user_id, week_start);

-- Journal 多媒体: 音频/视频附件. 与 reflections 是独立信任边界.
-- reflections.content 永远不喂 AI, 但 journal_media CAN be analyzed if ai_opt_in=1.
CREATE TABLE IF NOT EXISTS journal_media (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id   INTEGER NOT NULL,
    reflection_id   INTEGER,                      -- FK → reflections.id, nullable
    media_type      TEXT    NOT NULL,              -- 'audio' | 'video'
    file_path       TEXT    NOT NULL,              -- 相对 data/uploads/journal/
    file_name       TEXT,
    mime_type       TEXT,
    duration_secs   INTEGER,
    file_size_bytes INTEGER,
    ai_opt_in       INTEGER DEFAULT 0,            -- 0=私密, 1=用户显式同意 AI 分析
    analysis_status TEXT    DEFAULT 'none',        -- none|extracting_frames|analyzing|done|failed
    frames_json     TEXT,                          -- JSON: 提取的帧文件路径
    analysis_json   TEXT,                          -- LLM 分析结果
    analysis_prompt TEXT,                          -- 用户的提问
    error_message   TEXT,
    created_at      TEXT    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_user_id)  REFERENCES users(id)       ON DELETE CASCADE,
    FOREIGN KEY (reflection_id)  REFERENCES reflections(id)  ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_journal_media_owner ON journal_media(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_journal_media_refl  ON journal_media(reflection_id);

-- 作文管理
CREATE TABLE IF NOT EXISTS essays (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id   INTEGER NOT NULL,
    title           TEXT,
    content         TEXT    NOT NULL DEFAULT '',
    source_type     TEXT    NOT NULL,              -- 'photo'|'document'|'text'
    file_path       TEXT,
    file_name       TEXT,
    essay_type      TEXT,                          -- '记叙文'|'议论文'|'说明文'|'应用文'
    topic           TEXT,
    word_count      INTEGER DEFAULT 0,
    status          TEXT    DEFAULT 'uploaded',    -- uploaded|ocr_processing|ocr_done|analyzing|analyzed|failed
    ocr_result_json TEXT,
    analysis_json   TEXT,
    error_message   TEXT,
    extra_files     TEXT,                          -- JSON 数组, 相对路径; 多图作文时存第 2~N 张
    created_at      TEXT    DEFAULT CURRENT_TIMESTAMP,
    updated_at      TEXT    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_essays_owner    ON essays(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_essays_type     ON essays(owner_user_id, essay_type);
CREATE INDEX IF NOT EXISTS idx_essays_topic    ON essays(owner_user_id, topic);

-- 范文生成后台任务. 任务只保存作文元数据生成的结果, 不复制学生原文.
CREATE TABLE IF NOT EXISTS essay_model_jobs (
    id               TEXT PRIMARY KEY,
    owner_user_id    INTEGER NOT NULL,
    essay_id         INTEGER NOT NULL,
    status           TEXT NOT NULL DEFAULT 'processing', -- processing|done|failed
    result_json      TEXT,
    error_code       TEXT,
    error_message    TEXT,
    created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at       TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (essay_id) REFERENCES essays(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_essay_model_jobs_owner
    ON essay_model_jobs(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_calls_owner    ON llm_calls(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_calls_date     ON llm_calls(created_at DESC);

-- ====================== Agent Native: P0 信号 + P1 画像 ======================

-- 用户行为信号. 仅元数据, 不含原始内容 (题目/答案/反思/日记内容).
-- 90 天 TTL, 每天清理一次.
CREATE TABLE IF NOT EXISTS interaction_signals (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id   INTEGER NOT NULL,
    event_type      TEXT    NOT NULL,           -- 见 routes/signals.py 的 ALLOWED_EVENT_TYPES
    related_table   TEXT,                       -- 'mistakes' | 'practice_items' | 'essays' | 'tasks' | NULL
    related_id      INTEGER,
    payload_json    TEXT,                       -- 事件特定元数据 (JSON, 服务端校验)
    session_id      TEXT,                       -- 客户端启动时分配的 UUID
    client          TEXT NOT NULL DEFAULT 'unknown',  -- 'web' | 'mobile-ios' | 'mobile-android'
    occurred_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_signals_owner_time ON interaction_signals(owner_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_owner_type ON interaction_signals(owner_user_id, event_type, occurred_at DESC);

-- 学生画像. 每次 build 写入新 version, 历史保留 30 天 + 月度快照.
-- profile_json 是后续所有 agent 的输入. 用户可见、可改、可删.
CREATE TABLE IF NOT EXISTS student_profile (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id     INTEGER NOT NULL,
    version           INTEGER NOT NULL,        -- 单调递增, 同 user 内唯一
    profile_json      TEXT    NOT NULL,        -- 完整画像 JSON, schema_version=1
    source_summary    TEXT,                    -- 80 字内中文 "她最近怎么样" (LLM 写, 给学生看)
    computed_from     TEXT,                    -- 描述本次 build 的输入窗口
    build_method      TEXT NOT NULL,           -- 'cron_daily' | 'manual_rebuild' | 'after_correction'
    build_cost_usd    REAL DEFAULT 0,
    build_duration_ms INTEGER DEFAULT 0,
    is_monthly_snapshot INTEGER DEFAULT 0,     -- 月度快照不参与 30 天 GC
    created_at        TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (owner_user_id, version)
);

CREATE INDEX IF NOT EXISTS idx_profile_owner_version ON student_profile(owner_user_id, version DESC);

-- 用户对画像的反馈. build job 在生成新画像时必须遵守.
-- 例: 用户 dismiss 一个 error_pattern → 下次 build 不再生成这条
CREATE TABLE IF NOT EXISTS profile_corrections (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id   INTEGER NOT NULL,
    field_path      TEXT    NOT NULL,           -- 'error_patterns.含参不分类讨论' / 'knowledge.数学.一元二次方程.mastery'
    action          TEXT    NOT NULL,           -- 'dismiss' | 'lock_value' | 'reset'
    value_json      TEXT,                       -- action='lock_value' 时存锁定值
    reason          TEXT,                       -- 用户给出的原因, 不喂 LLM
    created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_corrections_owner ON profile_corrections(owner_user_id, created_at DESC);

-- 用户开关: 是否参与画像构建 / 信号收集
-- 默认开启, 学生可以在设置里关
-- 用 settings_json on users 也行, 但单独表更清晰
CREATE TABLE IF NOT EXISTS profile_settings (
    owner_user_id        INTEGER PRIMARY KEY,
    signals_enabled      INTEGER DEFAULT 1,    -- 0=不收集任何 signal
    profile_enabled      INTEGER DEFAULT 1,    -- 0=不构建画像
    journal_volume_in_profile INTEGER DEFAULT 1,  -- 0=连日记字数也不进画像
    agent_enabled        INTEGER DEFAULT 1,    -- 0=不出主动建议
    agent_snoozed_until  TEXT,                 -- ISO 日期, NULL=不暂停
    updated_at           TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Agent action trace. P0+P1 阶段不写入, schema 先建, P2 Tutor 上线时填.
-- 让她可以审计 "agent 为什么这么说"
CREATE TABLE IF NOT EXISTS agent_actions (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id     INTEGER NOT NULL,
    agent_name        TEXT NOT NULL,            -- 'tutor' | 'reflector' | 'curator' | 'coach' | 'guardian'
    action_type       TEXT NOT NULL,            -- 'suggest' | 'ask' | 'alert' | 'rearrange'
    suggestion_id     TEXT NOT NULL,            -- UUID, 用于和 user_response 关联
    payload_json      TEXT,                     -- 建议的具体内容
    rationale         TEXT,                     -- 一句话: 为什么给这个建议
    profile_version   INTEGER,                  -- 当时基于的画像版本
    user_response     TEXT,                     -- 'accepted' | 'dismissed' | 'expired'
    response_at       TEXT,
    created_at        TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_actions_owner ON agent_actions(owner_user_id, created_at DESC);

-- ====================== P3 费曼模式: 反向教学 ======================
-- 学生"教"AI, AI 装作初中同学问 1-3 个跟进问题, 最后评估理解深度.
-- 这是建知识模型最深的学习方式.
CREATE TABLE IF NOT EXISTS feynman_sessions (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id       INTEGER NOT NULL,
    source_table        TEXT,                       -- 'mistakes' | 'practice_items' | 'manual' | NULL
    source_id           INTEGER,                    -- 对应主键
    topic_seed          TEXT,                       -- 触发时携带的话题描述 (题面/知识点)
    topic_inferred      TEXT,                       -- LLM 提炼的更精确话题
    conversation_json   TEXT NOT NULL DEFAULT '[]', -- [{role, content, ts}]
    ai_assessment_json  TEXT,                       -- 仅 finished 后写入
    status              TEXT NOT NULL DEFAULT 'in_progress',  -- in_progress | finished | abandoned
    turn_count          INTEGER DEFAULT 0,          -- 学生发言轮数
    student_id_for_profile INTEGER,                 -- 缓存 user_id, profile_builder 用
    manual_subject      TEXT,                       -- 主动发起时的 subject (source_table='manual')
    manual_knowledge_point TEXT,                    -- 主动发起时的 kp (作为 mastery 键)
    manual_source_note  TEXT,                       -- 主动发起时的 "我在哪学的" (会进开场白)
    created_at          TEXT DEFAULT CURRENT_TIMESTAMP,
    finished_at         TEXT,
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_feynman_owner_time ON feynman_sessions(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feynman_owner_source ON feynman_sessions(owner_user_id, source_table, source_id);

-- ====================== P5 Curator: 智能今日推荐项 ======================
-- 不替代固定 plan, 是补充. 每天 cron 生成 0-5 项, 用户可完成/跳过.
CREATE TABLE IF NOT EXISTS curated_items (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id     INTEGER NOT NULL,
    date              TEXT    NOT NULL,             -- YYYY-MM-DD
    kind              TEXT    NOT NULL,             -- review_mistake|pattern_drill|goal_aligned|challenge|rest_recommended
    source_table      TEXT,                          -- mistakes|practice_sets|weekly_goals|NULL
    source_id         INTEGER,
    title             TEXT    NOT NULL,
    description       TEXT,
    rationale         TEXT,                          -- "为什么是这个" 一句话
    estimated_minutes INTEGER,
    priority          INTEGER DEFAULT 3,            -- 1=最高, 5=最低 (排序用)
    status            TEXT    DEFAULT 'pending',     -- pending|completed|dismissed|expired
    completed_at      TEXT,
    profile_version   INTEGER,                       -- 当时基于的画像版本
    created_at        TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_curator_owner_date ON curated_items(owner_user_id, date DESC, priority);
CREATE INDEX IF NOT EXISTS idx_curator_owner_status ON curated_items(owner_user_id, status, date DESC);

-- ====================== P6 Coach: 周日战略复盘 ======================
CREATE TABLE IF NOT EXISTS coach_reviews (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id   INTEGER NOT NULL,
    week_start      TEXT    NOT NULL,             -- YYYY-MM-DD (周一)
    content_md      TEXT,                          -- LLM 写的 markdown 复盘
    highlights_json TEXT,                          -- {strengths, watchouts, focus_for_next_week}
    metrics_json    TEXT,                          -- {checkin_days, mistakes, practice, feynman, ...}
    status          TEXT DEFAULT 'generating',    -- generating|done|failed
    error_message   TEXT,
    build_method    TEXT,                          -- 'cron_sunday' | 'manual'
    build_cost_usd  REAL DEFAULT 0,
    created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (owner_user_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_coach_owner_week ON coach_reviews(owner_user_id, week_start DESC);

-- ====================== P7 Guardian: \u5f02\u5e38\u76d1\u63a7 ======================
-- 检测全用规则, LLM 只措辞. 学生看自己, 家长看孩子.
CREATE TABLE IF NOT EXISTS guardian_alerts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id   INTEGER NOT NULL,             -- 关于谁的状态
    target_user_id  INTEGER NOT NULL,             -- 谁会看到这条 alert (学生本人 or 绑定家长)
    severity        TEXT NOT NULL DEFAULT 'low',   -- low|medium|high
    category        TEXT NOT NULL,                  -- engagement_drop|give_up_pattern|pace_too_high|reflection_drop|goal_drift
    title           TEXT NOT NULL,
    message         TEXT,                            -- LLM 措辞 (温和)
    evidence_json   TEXT,                            -- 触发的具体数据
    audience        TEXT NOT NULL,                  -- 'student' | 'parent'
    acknowledged_at TEXT,
    expires_at      TEXT,                            -- 过期自动隐藏
    created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_guardian_target_active
    ON guardian_alerts(target_user_id, acknowledged_at, expires_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guardian_owner_cat
    ON guardian_alerts(owner_user_id, category, created_at DESC);

-- ====================== 课程日历: 家长接送用 ======================
-- 每条 = 一个固定时段的课 (如"周六 13:00-15:00 黄语文 213 教室").
-- 家庭内可能多个孩子 (child_name 文本区分, 不引 users 表, 因为孩子不一定有账号).
-- specific_date 非空时表示仅该日生效的"临时调课"(如五一假期补课),
-- NULL 表示按 weekday 每周重复.
CREATE TABLE IF NOT EXISTS courses (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id  INTEGER NOT NULL,
    child_name     TEXT    NOT NULL,
    course_name    TEXT    NOT NULL,
    weekday        INTEGER NOT NULL,             -- 1=周一 ... 7=周日
    start_time     TEXT    NOT NULL,             -- 'HH:MM' 24h
    end_time       TEXT    NOT NULL,             -- 'HH:MM'
    location       TEXT,                          -- 教室/地址
    pickup_note    TEXT,                          -- 接送备注 (谁送谁接, 几点出发)
    notes          TEXT,
    sort_order     INTEGER DEFAULT 0,
    specific_date  TEXT,                          -- YYYY-MM-DD. 非空=单次课(临时调课), NULL=每周重复
    created_at     TEXT    DEFAULT CURRENT_TIMESTAMP,
    updated_at     TEXT    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_courses_owner_day
    ON courses(owner_user_id, weekday, start_time);
-- 注意: idx_courses_owner_date(specific_date) 在 _run_migrations 里建,
-- 避免旧库升级时 SCHEMA 尝试建索引撞上还不存在的列.

-- 拍照解题后台任务. 原图只保留到任务完成, 结果按 owner 隔离.
CREATE TABLE IF NOT EXISTS scan_solve_jobs (
    id               TEXT PRIMARY KEY,
    owner_user_id    INTEGER NOT NULL,
    file_path        TEXT NOT NULL,
    save_as_mistake  INTEGER NOT NULL DEFAULT 0,
    status           TEXT NOT NULL DEFAULT 'processing', -- processing|done|failed
    result_json      TEXT,
    error_code       TEXT,
    error_message    TEXT,
    created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at       TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_scan_solve_jobs_owner
    ON scan_solve_jobs(owner_user_id, created_at DESC);

-- 家长布置任务 / 学生待办
-- student_id: 任务接收者 (学生 user.id)
-- assigner_user_id: 布置者 (家长 user.id; 学生自己布置时 = student_id, 即 self-assigned)
-- kind: 'practice' | 'essay' | 'reading' | 'custom'
-- status: 'pending' | 'completed' | 'cancelled'
CREATE TABLE IF NOT EXISTS assignments (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id        INTEGER NOT NULL,
    assigner_user_id  INTEGER NOT NULL,
    kind              TEXT    NOT NULL DEFAULT 'custom',
    title             TEXT    NOT NULL,
    description       TEXT,
    due_date          TEXT,                          -- YYYY-MM-DD, 可空
    status            TEXT    NOT NULL DEFAULT 'pending',
    completed_at      TEXT,
    created_at        TEXT    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (assigner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_assignments_student
    ON assignments(student_id, status, due_date);
"""


def get_conn():
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA busy_timeout = 10000")
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


def _table_exists(conn, table: str) -> bool:
    cur = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)
    )
    return cur.fetchone() is not None


def _run_migrations(conn):
    """轻量 migration: 给已有表加新列. PRAGMA table_info 检查过后再 ALTER, 幂等."""
    # P2 agent fields
    if not _column_exists(conn, "profile_settings", "agent_enabled"):
        try:
            conn.execute("ALTER TABLE profile_settings ADD COLUMN agent_enabled INTEGER DEFAULT 1")
        except sqlite3.OperationalError:
            pass
    if not _column_exists(conn, "profile_settings", "agent_snoozed_until"):
        try:
            conn.execute("ALTER TABLE profile_settings ADD COLUMN agent_snoozed_until TEXT")
        except sqlite3.OperationalError:
            pass
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
    # mistakes.solution_steps (完整解题过程, Markdown + LaTeX)
    if not _column_exists(conn, "mistakes", "solution_steps"):
        conn.execute("ALTER TABLE mistakes ADD COLUMN solution_steps TEXT")
    # exam_uploads: 持久化压缩版本 (thumb) + 体积统计
    if not _column_exists(conn, "exam_uploads", "thumb_path"):
        conn.execute("ALTER TABLE exam_uploads ADD COLUMN thumb_path TEXT")
    if not _column_exists(conn, "exam_uploads", "orig_size"):
        conn.execute("ALTER TABLE exam_uploads ADD COLUMN orig_size INTEGER")
    if not _column_exists(conn, "exam_uploads", "thumb_size"):
        conn.execute("ALTER TABLE exam_uploads ADD COLUMN thumb_size INTEGER")
    # exam_uploads: 内容哈希 (hex sha256) 用于去重 + LLM 结果复用
    if not _column_exists(conn, "exam_uploads", "image_hash"):
        conn.execute("ALTER TABLE exam_uploads ADD COLUMN image_hash TEXT")
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_uploads_owner_hash "
            "ON exam_uploads(owner_user_id, image_hash)"
        )
    # exam_uploads: 400px preview (列表/卡片展示用)
    if not _column_exists(conn, "exam_uploads", "preview_path"):
        conn.execute("ALTER TABLE exam_uploads ADD COLUMN preview_path TEXT")
    # exam_uploads: updated_at (僵尸任务恢复需要)
    # 注意: SQLite 的 ALTER TABLE ADD COLUMN 不支持 non-constant default,
    # 所以先加 NULL 列, 再回填 created_at 作为初值, 后续写入由应用层填.
    if not _column_exists(conn, "exam_uploads", "updated_at"):
        conn.execute("ALTER TABLE exam_uploads ADD COLUMN updated_at TEXT")
        conn.execute(
            "UPDATE exam_uploads SET updated_at = created_at WHERE updated_at IS NULL"
        )
    # feynman_sessions: 主动发起的 manual session 携带的 subject/kp/note
    # 让"学生主动讲一个新学到的知识点"也能成为画像 mastery 信号
    if not _column_exists(conn, "feynman_sessions", "manual_subject"):
        conn.execute("ALTER TABLE feynman_sessions ADD COLUMN manual_subject TEXT")
    if not _column_exists(conn, "feynman_sessions", "manual_knowledge_point"):
        conn.execute("ALTER TABLE feynman_sessions ADD COLUMN manual_knowledge_point TEXT")
    if not _column_exists(conn, "feynman_sessions", "manual_source_note"):
        conn.execute("ALTER TABLE feynman_sessions ADD COLUMN manual_source_note TEXT")
    # courses: 单次日期覆盖 (临时调课 / 假期补课). NULL=每周重复.
    if _table_exists(conn, "courses"):
        if not _column_exists(conn, "courses", "specific_date"):
            conn.execute("ALTER TABLE courses ADD COLUMN specific_date TEXT")
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_courses_owner_date "
            "ON courses(owner_user_id, specific_date)"
        )
    # essays: 多图作文 (最多 9 张), extra_files 存第 2~N 张相对路径的 JSON 数组
    if _table_exists(conn, "essays"):
        if not _column_exists(conn, "essays", "extra_files"):
            conn.execute("ALTER TABLE essays ADD COLUMN extra_files TEXT")
    # practice_sets: 自定义标签 (JSON 数组)
    if _table_exists(conn, "practice_sets"):
        if not _column_exists(conn, "practice_sets", "tags"):
            conn.execute("ALTER TABLE practice_sets ADD COLUMN tags TEXT")
    # scores: 单科排名. 录入成绩单时结构化保存, 供考试复盘/next-action 使用.
    if _table_exists(conn, "scores"):
        if not _column_exists(conn, "scores", "subject_rank"):
            conn.execute("ALTER TABLE scores ADD COLUMN subject_rank INTEGER")


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
