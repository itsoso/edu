# P0 + P1: 信号收集 + 学生画像 详细 Plan

> 这是 Agent Native 改造的地基。所有后续 agent (Tutor / Reflector / Curator / Coach / Guardian) 都依赖这两层。
>
> 不实现, 仅规划。先论证 schema 与流程, 再分小步提交。

## 目标

**P0 — 信号收集**: 把现在散落在各 screen 的"用户做了什么"统一捕获、结构化、写库。不做分析, 只攒数据。

**P1 — 学生画像 (student profile)**: 周期性把 episodic 信号 + 已有的错题/打卡/反思统计抽取成一份**结构化 + 可读 + 可改**的"她是谁的学习者"。这份画像是后续所有 agent 的输入。

## 边界 (明确不做的)

- **不**做 vector DB / RAG。raw events 是结构化 SQL 就够。
- **不**做实时画像更新。每天 1 次后台 build, 成本可控。
- **不**把反思 (reflections 表) 内容喂给 LLM。仅统计字数、频率、关键词命中, 内容永不进入 prompt。
- **不**追求"完美画像"。冷启动期数据稀疏, 设计要容忍空白。
- **不**让 agent 写画像。画像由 build job 唯一写入, agent 只读。

---

## P0 — 信号收集

### 1. 新表 `interaction_signals`

```sql
CREATE TABLE interaction_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  event_type TEXT NOT NULL,         -- 见下表事件清单
  related_table TEXT,                -- 'mistakes' | 'practice_items' | 'essays' | 'tasks' | NULL
  related_id INTEGER,                -- 对应主键, 可空
  payload_json TEXT,                 -- 事件特定字段 (无内容, 仅元数据)

  session_id TEXT,                   -- 同一次 app 启动内的 UUID
  client TEXT NOT NULL,              -- 'web' | 'mobile-ios'
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_signals_owner_time ON interaction_signals(owner_user_id, occurred_at DESC);
CREATE INDEX idx_signals_owner_type ON interaction_signals(owner_user_id, event_type, occurred_at DESC);
```

**保留策略**: 90 天后归档/丢弃 (TTL 删除, 可选另起 archive 表)。画像构建只用最近 30 天 + 上次画像。

### 2. 事件清单 (v1)

按价值排序, 选 ~15 个高信号事件, 不堆量:

| event_type | 触发点 | payload 关键字段 | 价值 |
|---|---|---|---|
| `session.start` | App 启动 / web 首次 fetch | platform, version | 基线: 使用频率 |
| `session.end` | 切后台 / 关 tab 5 min | duration_secs | 单次会话长度 |
| `task.checkin.toggle` | 打卡勾选 | task_id, completed, hour_of_day | 时段偏好 + 完成率 |
| `task.override.skip` | 跳过本周任务 | task_id, week | 抗拒信号 |
| `task.override.replace` | 替换任务 | task_id | 主动调整意愿 |
| `mistake.create` | 录入错题 | subject, reason, source ('manual'/'scan'/'extracted') | 录入习惯 |
| `mistake.view_detail` | iPad 选中 / iPhone 展开 | mistake_id, subject | 关注哪些题 |
| `mistake.mark_mastered` | 标记掌握 | mistake_id, days_since_create | 真掌握 vs 应付 |
| `practice.item.start` | 题目卡片 mount | item_id, subject, difficulty | 训练量 |
| `practice.item.input_pause` | 输入框停顿 ≥5s | item_id, pause_count_so_far | 困难/犹豫 |
| `practice.item.hint_used` | 点"卡住了? 看思路" | item_id, time_before_hint_secs | 自助求救 vs 一上来就看 |
| `practice.item.submit` | 提交批改 | item_id, elapsed_secs, answer_length, hint_used (bool) | 难度感 + 努力度 |
| `practice.item.skip` | 离开未提交 | item_id, elapsed_secs | 放弃信号 |
| `essay.create` | 录入作文 | source_type, word_count | 产出量 |
| `journal.write` | 文字日记保存 | char_count (不传内容) | 反思频率/篇幅 (仅元数据) |
| `weekly_goal.set` | 周目标设立 | focus_type, week_start | 主动规划意愿 |
| `agent.suggestion.shown` (P2 才有) | agent 建议出现 | agent_name, suggestion_id | reward signal 基线 |
| `agent.suggestion.accepted` / `dismissed` (P2) | 用户响应 | agent_name, suggestion_id | reward signal |

**禁止字段**: 任何 question_text / answer_text / journal_content / reflection_content。只传 ID 和元数据。

### 3. 后端 API

```
POST /api/signals
Body: { events: [ { event_type, related_table?, related_id?, payload, session_id, client } ] }
Response: { ok: true, accepted: N }
```

- 接受批量, 客户端可累积发送 (减少请求)
- 失败静默 (不阻塞 UX)
- session_id 在客户端启动时生成 UUID
- 服务端补 `owner_user_id` (从 auth) + `occurred_at`

### 4. 前端埋点接入

**统一 helper** `src/lib/signals.ts` (mobile + frontend 各一份, API 一致):

```typescript
// 用法
signals.track('practice.item.submit', {
  related_table: 'practice_items',
  related_id: item.id,
  payload: { elapsed_secs: 45, answer_length: 120, hint_used: true }
})
```

内部:
- 缓存到内存 queue, 满 10 条或超 5s 批量 POST
- 失败重试 1 次, 仍失败丢弃 (信号是 best-effort)
- 切后台时 flush
- 暴露 `signals.startSession()` / `signals.endSession()` 给 App.tsx 用

**接入触点 (mobile, P0 范围)**:
- `App.tsx` — session.start / end
- `TodayScreen` / `DashboardScreen` — task.checkin.toggle
- `PlanScreen` — task.override.skip / replace, weekly_goal.set
- `MistakesScreen` — mistake.create, mistake.view_detail (selectedId 变化), mistake.mark_mastered
- `PracticeScreen` — practice.item.start (ItemCard mount), input_pause (TextInput 停顿计时), hint_used, submit, skip (unmount 未提交)
- `EssaysScreen` — essay.create
- `JournalScreen` — journal.write (只传 char_count)

Web 端同步加, 简单, 复用同 helper。

### 5. 隐私

- 用户在 Settings 增加: "数据收集详情" 链接, 列出所有 event_type 和字段
- 一个总开关: "停止收集行为信号"。打开则 `signals.track` 直接 noop, 不发请求, 已存的 90 天后过期
- 反思内容、作文内容、日记内容**永不**作为 payload 出现

---

## P1 — 学生画像 (student_profile)

### 1. 新表 `student_profile`

```sql
CREATE TABLE student_profile (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  version INTEGER NOT NULL,          -- 单调递增, 每次 build +1
  profile_json TEXT NOT NULL,        -- 见下方 schema
  source_summary TEXT,                -- LLM 写的人话总结, 给学生看 (不是给 LLM 看)
  computed_from TEXT,                 -- "signals 1234..5678 + episodic 2025-04-10..04-17"

  build_method TEXT NOT NULL,        -- 'cron_daily' | 'manual_rebuild' | 'after_correction'
  build_cost_usd REAL,                -- LLM 调用成本, 用于预算监控
  build_duration_ms INTEGER,

  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_profile_owner_version ON student_profile(owner_user_id, version DESC);

-- 查询永远 SELECT ... ORDER BY version DESC LIMIT 1
```

**版本策略**: 全部保留 90 天。让她可以"回看上个月的我", 也方便 audit。30 天前的可以折叠为月度快照, 节省空间。

### 2. profile_json schema

```json
{
  "schema_version": 1,
  "computed_at": "2025-04-17T03:00:00Z",
  "data_window_days": 30,

  "knowledge": {
    "数学": {
      "一元二次方程": {
        "mastery": 0.72,
        "confidence": 0.6,
        "last_practiced_at": "2025-04-15",
        "practice_count": 8,
        "correct_rate": 0.625,
        "evidence_mistake_ids": [42, 51, 78],
        "trend_7d": "rising"
      },
      "因式分解": { ... }
    },
    "语文": { ... }
  },

  "error_patterns": [
    {
      "id": "含参不分类讨论",
      "subject": "数学",
      "description": "遇到含参方程/不等式时, 没意识到要按参数取值范围讨论",
      "evidence_mistake_ids": [42, 51, 78],
      "first_seen": "2025-03-20",
      "last_seen": "2025-04-15",
      "occurrences": 5,
      "confidence": 0.85,
      "user_dismissed": false
    }
  ],

  "cognitive_style": {
    "explanation_preference": "example_first",
    "ideal_session_length_min": 25,
    "best_time_window": "20:00-21:30",
    "hint_usage_pattern": "tries_first",
    "evidence": "30 天内有 22 次 hint_used 中 18 次发生在提交后, 仅 4 次未答先看"
  },

  "engagement": {
    "score_7d": 0.62,
    "checkin_rate_7d": 0.71,
    "avg_session_minutes_7d": 18,
    "trend": "stable",
    "low_signals": ["周四晚连续 3 周打卡率 0%"]
  },

  "self_narrative": {
    "journal_volume_30d": { "free_write_count": 12, "avg_chars": 95 },
    "reflection_volume_30d": { "mistake_note_count": 8 },
    "_note": "内容不在画像里, 只统计量."
  },

  "user_corrections": [
    { "field": "error_patterns.含参不分类讨论", "action": "dismissed", "at": "2025-04-12", "reason": "我已经懂了" }
  ]
}
```

**关键设计**:
- 每条都带 `evidence_*_ids` — 可追溯回 raw, 可解释
- `confidence` 让 agent 知道这条多可信
- `user_corrections` 是用户的反向反馈, build job 必须遵守
- `_note` 等下划线开头的字段不进 LLM context (前缀约定)

### 3. Build pipeline

```
每天 03:00 (cron) 触发, 按 owner_user_id 串行:

  step 1. SQL 聚合 (无 LLM, 纯计算)
    ├── knowledge.{subject}.{kp}.mastery   <-  Bayesian update from practice + mistakes
    ├── knowledge.{subject}.{kp}.correct_rate  <-  count
    ├── engagement.checkin_rate_7d         <-  count(checkins) / 7
    ├── engagement.avg_session_minutes_7d  <-  avg(session.end.duration)
    ├── cognitive_style.best_time_window   <-  histogram of checkin hour with completed=1
    ├── cognitive_style.hint_usage_pattern <-  ratio of hint_used before submit
    └── self_narrative.* (reflection/journal counts)

  step 2. LLM 增量 (Haiku, 廉价)
    Input: 上次 profile + 最近 7 天的 mistakes 行 + signals 摘要
    Task: 仅产出 error_patterns.diff (新增 / 强化已有 / 标记淘汰), 严格 JSON
    Cost cap: 每次 < $0.05, 单次 prompt < 2000 tokens

  step 3. 程序化合并
    - SQL 算的字段直接覆盖
    - error_patterns: 上次 + LLM diff, 做 dedupe + confidence 衰减
    - user_corrections 始终保留, 被 dismiss 的 pattern 不再生成

  step 4. source_summary (LLM, Haiku)
    Input: 新画像 (knowledge top 5 + error_patterns + engagement)
    Task: 写一段 80 字内的"她最近怎么样"中文给她自己看
    样例: "你这周数学一元二次方程做对率从 50% 升到 70%. 仍有 3 道含参的题困住你. 周四晚效率最低, 也许是体育课后累了."

  step 5. 写入新 version, GC 30 天前的
```

### 4. LLM Prompt 设计 (error_pattern 抽取)

```
你是一个学习行为分析器. 输入是一个学生最近 7 天的错题列表 + 上次抽取的错误模式.
任务: 找出"她特有的、重复出现的"错误模式, 不是通用错误.

判断标准:
- 至少 3 道题体现同类错误
- 描述要具体到操作层面 (不是"基础不扎实"这种空话)
- 给出 confidence 0.0-1.0
- 如果某个旧 pattern 这 7 天没有新证据, mark trend="weakening"

输入 JSON:
{
  "previous_patterns": [...],
  "user_dismissed": [...],   // 这些不能再生成
  "recent_mistakes": [
    { "id": 42, "subject": "数学", "question_text": "...", "wrong_answer": "...",
      "correct_answer": "...", "reason": "...", "knowledge_point": "..." },
    ...
  ]
}

输出 JSON 严格 schema:
{
  "new_patterns": [ { id, subject, description, evidence_mistake_ids, confidence } ],
  "reinforced": [ { id, additional_evidence_ids } ],
  "weakening": [ { id, reason } ]
}

不要给"加油"之类评价. 只做事实抽取.
```

**为什么用 Haiku**: 单次成本 $0.001 量级。每天每用户一次, 30 用户 / 月也就几块钱。

### 5. 画像可视页 (元认知镜子)

新路由:
- web: `/me/insights`
- mobile: Settings → "看看 AI 怎么看我" 入口

UI 卡片 (按重要性):

1. **本期总结** — 显示 source_summary 那段话, 大字, 平静色调
2. **知识地图** — 按学科折叠, 每个知识点显示色块 (mastery 0-1 → 灰到 brand) + last_seen + practice_count。点击展开 evidence 错题
3. **我的"小坑" (error_patterns)** — 列表, 每条显示 description + 证据题数 + confidence 条。**右侧**有"我不同意"按钮, 点击后:
   - 写入 user_corrections
   - 这条立即从画像隐藏
   - 下次 build 不再生成
4. **节奏与状态** — best_time_window / ideal_session_length / engagement 7天曲线
5. **历史画像** — 时间轴, 可看上个月/上上个月的画像快照, 对比"我变了什么"

每条数据旁边都有小问号 → 点击显示"这条是怎么算出来的" (evidence_*_ids 链接)。

**家长视图**: 只读, 标注"这是 AI 的观察, 不是定论"。家长不能编辑。

### 6. 用户编辑权限

她可以做:
- 删除某条 error_pattern → 写 user_corrections
- 标记某个知识点 "我已经会了" → mastery 锁定 1.0, 不被覆盖
- 全量删除画像 → 触发 wipe (signals 表也清), 从 0 开始
- 暂停画像构建 → 下次 cron 跳过她

她不能做:
- 直接编辑 mastery / confidence 数值 (避免画像变成自我吹嘘)

---

## 验证与可观测性

### 单元测试

- Bayesian mastery: 给固定输入, 验证输出在合理区间
- error_pattern 合并: 上次 + diff → 预期合并结果
- user_corrections: 被 dismiss 的 pattern 在下次 build 不出现
- 隐私: 所有 LLM prompt 不含 reflection/journal/essay 内容 (单测扫 prompt 字符串)

### 集成测试

- 模拟 30 天 raw events → 触发 build → 检查 profile_json 字段齐全 + 数值合理
- 同样输入跑 2 次, 画像稳定性 (knowledge 字段 jaccard ≥0.85)

### 在线监控

- 新 admin endpoint `/api/admin/profile-stats`:
  - 每日 build 成功/失败数
  - 平均 build 耗时
  - 平均 LLM 成本
  - profile_json 大小分布
- 异常告警: 单次 build > $0.20, 或耗时 > 30s

### 教育有效性 (P1 暂不评, 但要先埋好)

为了后期能评估 "agent 是否真的帮助提升认知", 现在就要保留:

- 所有 mistakes 的 created_at + (可选) "重新做对" 标记 → 算错误重复率
- 所有 weekly_goals → 后续看完成度
- 所有 reflection 字数趋势 → 看反思具体度变化

不增加新表, 用现有数据, 但要确认查询能跑出来。

---

## 实施顺序 (任务级, 不带时间承诺)

```
后端
─ B1. 新建 interaction_signals 表 + 索引 + 90 天 TTL job
─ B2. POST /api/signals 端点 (批量接收, 鉴权, 限流)
─ B3. 新建 student_profile 表 + 索引
─ B4. SQL 聚合层 (mastery / engagement / cognitive_style 几个纯计算字段)
─ B5. LLM 增量层 (error_pattern 抽取, Haiku, JSON schema 强校验)
─ B6. 程序化合并 + user_corrections 应用
─ B7. source_summary 生成 (LLM)
─ B8. cron job (每日 03:00, 串行所有用户)
─ B9. /api/me/profile (读最新版本) + /api/me/profile/history (列版本)
─ B10. /api/me/profile/correct (写 user_corrections)
─ B11. admin 监控端点

前端 (mobile + web 同步)
─ F1. signals helper + 内存 queue + 批量发送 + flush hook
─ F2. App 启动 / 切后台时 session 信号
─ F3. 6 个高优触点接入 (mistakes / practice / journal / task)
─ F4. Settings 加 "数据收集详情" + 总开关
─ F5. /me/insights 路由 (mobile + web)
─ F6. 总结卡片 + 知识地图 + error_patterns 列表
─ F7. "我不同意" 编辑 → 调 correct API
─ F8. 历史版本时间轴

发布
─ R1. 灰度: 仅 owner 自己用一周, 看 build 稳定性 + LLM 成本
─ R2. 加家长视图 (只读)
─ R3. 全开

```

每条任务对应一个小 PR / 小 commit。B1-B3 是基建可以先跑起来。B4 后就有第一个可见画像 (没 LLM 也能用)。B5+B6 才上 LLM。

---

## 开放问题 (要决策才能动)

| 问题 | 备选 | 倾向 |
|---|---|---|
| Mastery 衰减曲线 | 线性/指数/分段 | 一周不练扣 0.05 (线性), 简单可调 |
| "够多" 算 pattern 的阈值 | 3 或 5 道 | 3 道, 鼓励早发现 |
| 画像版本保留 | 全留 / 只留 30 天 / 月度快照 | 30 天滚动 + 月度快照 |
| 反思字数是否进画像 | 进 / 不进 | 进 (字数无内容), 但用户可关 |
| build 失败重试 | 立即重试 / 第二天 / 不重试 | 不重试, 第二天的 build 自然覆盖 |
| 新用户冷启动 | 等够 7 天再 build / 立即 build | 立即 build, 字段大量空白即可, 让她从一开始就看到画像在长出来 |
| 多语言 | 仅中文 / 双语 | 仅中文 (用户单一) |

## 未来 hooks (P0+P1 之外的预留口子)

P0+P1 的设计要给后续 agent 留接口, 不要返工:

- `agent_actions` 表占位 schema 先想好 (P2 引入)
- `student_profile` 加预留字段 `agent_strategies` (procedural memory, P2 写入)
- signals helper 预留 `signals.trackAgent('shown'|'accepted'|'dismissed', agent_name, suggestion_id)`
- profile build job 输出预留 `next_actions` 字段 (P2 由 Tutor 读取作为出题依据)

---

## 风险

1. **build job 跑爆**: cron 串行, 如果用户多, 凌晨 3 点跑不完。**对策**: 后期改为分批 cron (按 user_id 分桶), 或迁到 worker queue。当前 owner 自己 + 家人, 1-3 用户, 不是问题。

2. **LLM 抽出垃圾 pattern**: "她基础薄弱" 这种废话 pattern 污染画像。**对策**: prompt 反复强调 "操作层面具体描述", 加 reject list, build 后人工抽查 first 1 周。

3. **Mastery 漂移**: 一道题做对 mastery 升, 但她可能只是蒙对的。**对策**: confidence 字段同时算 (短答 + 不查思路 → 高 confidence; 长时间 + 查思路 → 低 confidence)。mastery × confidence 才是 agent 看的"真懂"指数。

4. **用户感觉被监控**: 第一次看见画像可能感到不适。**对策**: 第一次进入 /me/insights 显示一个"序言"页, 解释这份画像是给她的镜子, 不是评价。家长进入时显示同样的话。

5. **画像编辑滥用**: 她把所有 error_pattern 都 dismiss, 系统失明。**对策**: dismiss 时让她写一行原因 (短文本, 不喂 LLM), 月度 audit 提醒 "你这个月 dismiss 了 N 条, 看看是不是真的不需要"。

---

## 完成标准 (P0 + P1 何时算 done)

- [ ] 30 天连续运行, signals 表每天 ≥100 条, 无丢失
- [ ] 每天 build 成功率 ≥99%, 平均成本 < $0.05/用户/天
- [ ] /me/insights 页面打开, 至少能看到 knowledge top 3 + error_patterns 1-2 条
- [ ] 用户做过至少一次 user_correction, 下次 build 已遵守
- [ ] 隐私单测全绿: 任何 LLM call 的 prompt 不含 reflection/journal/essay 原文
- [ ] 画像版本时间轴可看, 历史可对比

完成后才进入 P2 (Tutor agent), Tutor 直接读 /me/profile 当上下文出建议。

---

## 一句话总结

**P0 是埋点, P1 是从埋点抽出"她是谁的学习者"。两者都不直接产生 agent 行为, 但是没有这两层, 后面的 agent 都是无源之水。**

把这两步做扎实、做透明、可让她自己删, 后面所有 agent 才有合法性。
