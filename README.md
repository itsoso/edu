# 学习系统 (edu)

> 🌐 线上地址：**https://edu.executor.life**

多租户学业追踪 + AI 提升系统。学生打卡、家长看护、错题归因、试卷 AI 识别、基于错题的二次训练一体化。
技术栈：**Flask + SQLite + React + TypeScript + Vite + Tailwind + OpenClaw 视觉大模型**。

---

## 1. 核心功能

| 模块 | 入口 | 说明 |
|---|---|---|
| 🏠 **今日** | `/` | 当日任务打卡、成绩卡片、join code 显示 |
| 📈 **趋势** | `/trends` | 各科得分率 / 总分 / 年排折线图 + 录入新考试 |
| 📅 **计划** | `/plan` | 4 周 100 条执行计划，按天拆分打卡 |
| 📸 **扫试卷** | `/scan` | 拍照上传 → AI 识别错题 → 全卷分析 |
| 📓 **错题本** | `/mistakes` | 错题归因 + 分布统计 + 一键生成类题 |
| 🏋️ **训练** | `/practice` | 基于错题的类题训练 + AI 自动批改 |
| 🎯 **方法卡** | `/methods` | 5 科学习方法速查卡 + 习惯清单 |
| 📄 **分析** | `/analysis` | 完整学业诊断报告 |

---

## 2. 使用说明

### 2.1 首次使用 — 学生注册

1. 打开 https://edu.executor.life
2. 点"**注册**" → 选 **🎓 我是学生**
3. 填写用户名（如 `zhangsan`）、密码、昵称、当前阶段
4. 提交后自动登录，侧边栏出现自己的名字
5. Dashboard 顶部橙色框会显示一个 **6 位 Join Code**（如 `QR4BEN`），把这串给家长

注册即得：一份**空白的 4 周执行计划**（100 条任务），可以立即开始打卡。

### 2.2 家长绑定学生

1. 打开 https://edu.executor.life
2. 点"**注册**" → 选 **👨‍👩‍👧 我是家长**
3. 填写自己的用户名/密码/昵称
4. **绑定码**一栏输入孩子的 6 位 Join Code
5. 提交 → 成功后进入家长视图，侧边栏显示"家长视图 · 孩子的名字"

家长看到的是**只读的孩子全部数据**：成绩趋势、错题分布、今日任务完成情况、试卷扫描结果等。

### 2.3 种子账号（可直接登录体验）

```
用户名: liyan
密码:   liyan123
```

这是内置账号，含 13 次初一到初二的历史成绩、完整 4 周计划、完整学业分析报告。

---

### 2.4 日常使用流程（学生）

#### 每天 5 分钟

1. 登录 → 🏠 **今日**
2. 勾选已完成的任务（会自动保存）
3. 今天做作业/小测时如果有错题，去 📸 **扫试卷**

#### 📸 扫试卷完整流程（AI 识别错题）

```
① 点"扫试卷"
      ↓
② 填考试名称(如"5月月考") → 点"📸 拍照 / 选图上传"
   (手机浏览器会直接打开相机, 电脑会弹文件选择)
      ↓
③ 上传完成后显示预览图
      ↓
④ 点"🔍 识别错题" (等 10-30 秒, AI 看图抽错题)
      ↓
⑤ 显示识别到的错题列表, 每条包含:
   - 题面、错答、正答
   - 归因 (计算错/审题漏/不会做/...)
   - 知识点
   - 置信度
      ↓
⑥ 勾选要保存的错题 → "💾 保存到错题本"
      ↓
⑦ 点"📊 全卷分析" (再等 15-40 秒)
   AI 给出: 估分 / 亮点 / 薄弱点 / 需补知识点 / 具体建议
```

#### 🏋️ 基于错题做二次训练

```
① 去 📓 错题本
      ↓
② 找一道想巩固的错题, 点"🏋️ 生成类题" (等 20 秒)
      ↓
③ 自动跳转到 🏋️ 训练页面, 看到 3 道类题 (带难度标签)
      ↓
④ 每道题:
   - 在文本框写作答
   - 卡住时点"看思路"
   - 写完点"提交作答"
      ↓
⑤ AI 立刻批改 (约 3-5 秒):
   - 正确 ✓: 显示 100 分 + 鼓励
   - 错误 ✗: 显示具体错因 + 改进建议 + 参考思路
      ↓
⑥ 做完所有题, 侧边栏显示"对 X / 共 Y"
```

#### 📈 每次月考后

```
① 去 📈 趋势
      ↓
② 点"+ 录入新成绩"
      ↓
③ 填科目分数 + 年级排名 + 备注
      ↓
④ 折线图自动更新, 能看到总分趋势、各科得分率、排名变化
```

### 2.5 每周复盘建议

周日花 30 分钟：

1. 📓 **错题本** → 看本周归因分布，是不是某类错在反复犯
2. 🏋️ **训练** → 看上周生成的训练题完成率和正确率
3. 📈 **趋势** → 和上周比哪科在进步
4. 📄 **分析** → 回读完整方案，对照自己的节奏调整

家长可以用同样的账号登录做一样的检视。

---

## 3. 整体架构

### 3.1 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 + TypeScript + Vite + Tailwind CSS + React Router 6 + Recharts |
| 后端 | Python 3.12 + Flask 3 + Flask-CORS + Werkzeug + httpx |
| 数据库 | SQLite (单文件, 本地/服务器同款) |
| AI 网关 | OpenClaw (`https://bot.executor.life/v1`) — OpenAI 兼容 vision + text |
| 认证 | Flask session cookie (HttpOnly + SameSite=Lax + Secure in prod) |
| 生产部署 | Gunicorn 22 + systemd + Nginx 1.24 + Let's Encrypt |

### 3.2 系统架构图

```
          ┌──────────────────────────────────────────┐
          │          https://edu.executor.life        │
          └────────────────────┬─────────────────────┘
                               │  HTTPS (Let's Encrypt)
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                         Nginx 1.24                            │
│   · /           → /opt/edu/frontend/dist (React SPA 静态)     │
│   · /assets/    → 同上 (immutable cache)                      │
│   · /api/*      → proxy_pass http://127.0.0.1:5060            │
│   · HTTP 80     → 301 → HTTPS                                 │
└──────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│          Gunicorn (N workers × 2 threads, preload)            │
│                         Flask app.py                          │
│                                                                │
│  ┌─────────────────┐  ┌──────────────┐  ┌──────────────────┐│
│  │  Auth           │  │  Business    │  │   LLM (llm.py)   ││
│  │  /api/auth/*    │  │  exams       │  │                  ││
│  │  session cookie │  │  tasks       │  │   vision_chat()  ││
│  │  pbkdf2 hash    │  │  checkins    │──│   json_chat()    ││
│  │  join_code      │  │  mistakes    │  │                  ││
│  └────────┬────────┘  │  uploads     │  │  base64 img URL  ││
│           │           │  practice    │  └────────┬─────────┘│
│           │           └──────┬───────┘           │          │
│           │                  │                   │          │
│           ▼                  ▼                   │          │
│  ┌─────────────────────────────────────┐         │          │
│  │        login_required 装饰器          │         │          │
│  │  g.current_user / g.owner_id        │         │          │
│  │  所有查询 WHERE owner_user_id = ?    │         │          │
│  └──────────────┬──────────────────────┘         │          │
│                 ▼                                 │          │
│  ┌─────────────────────────────────────┐         │          │
│  │        SQLite (edu.db, 9 表)         │         │          │
│  └─────────────────────────────────────┘         │          │
│                                                    │          │
│         backend/data/uploads/<uid>/<uuid>.ext     │          │
│         backend/data/.env     (LLM key, 600)      │          │
│         backend/data/.secret_key (Flask key)      │          │
└───────────────────────────────────────────────────┼──────────┘
                                                    │
                                                    ▼
                                    ┌──────────────────────────┐
                                    │  OpenClaw Gateway         │
                                    │  https://bot.executor     │
                                    │                .life/v1   │
                                    │  OpenAI-compatible        │
                                    │  多模型路由 (GLM/Claude/…) │
                                    └──────────────────────────┘
```

### 3.3 数据库 Schema

```sql
-- 用户: 学生和家长都在这张表
users (
  id, username, password_hash, display_name,
  role,           -- 'student' | 'parent'
  student_id,     -- 家长 → 绑定的学生 id
  join_code,      -- 学生 → 给家长用的 6 位码
  stage, settings_json, created_at
)

-- 考试
exams (
  id, owner_user_id,            -- → users.id (学生)
  exam_name, exam_date, stage, total,
  class_rank, grade_rank, notes, sort_order
)
scores (id, exam_id, subject, score, full_mark)

-- 4 周执行计划 (注册时克隆模板)
tasks (
  id, owner_user_id, week, day_of_week,
  subject, title, description, minutes
)
checkins (
  id, task_id, checkin_date, completed,
  duration_minutes, UNIQUE(task_id, checkin_date)
)

-- 错题本
mistakes (
  id, owner_user_id, subject, exam_name,
  question_text, wrong_answer, correct_answer,
  reason, knowledge_point, mastered, mastered_at
)

-- 试卷上传 (拍照原图 + AI 分析结果缓存)
exam_uploads (
  id, owner_user_id, file_path, file_name,
  subject, exam_name,
  status,            -- 'uploaded' | 'extracted' | 'analyzed' | 'failed'
  extracted_json,    -- AI 识别的错题列表
  analysis_json,     -- AI 全卷分析
  error_message, created_at
)

-- 二次训练: 题集 + 题目
practice_sets (
  id, owner_user_id,
  source_mistake_id, -- 来自哪道错题
  title, subject, knowledge_point, created_at
)
practice_items (
  id, set_id, question_text, expected_answer,
  solution_steps, difficulty,
  student_answer, is_correct, score,
  feedback, graded_at
)
```

所有业务表带 `owner_user_id`，查询按此过滤 + 写操作显式校验。外键 `ON DELETE CASCADE`，删用户时级联清理。

### 3.4 完整 API 索引

```
# 认证 (公开)
POST   /api/auth/register           注册 (role=student|parent, join_code 绑定)
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me                 当前会话 + 家长看的孩子信息

# 以下都要求登录, 按 owner_user_id 隔离
GET    /api/health                  健康检查
GET    /api/llm/status              前端检测 AI 是否可用

# 考试
GET    /api/exams
POST   /api/exams
DELETE /api/exams/:id
GET    /api/scores/trend

# 任务 / 打卡
GET    /api/tasks?week=1&day=1
GET    /api/checkins?date=...
POST   /api/checkins                upsert (幂等)
GET    /api/checkins/stats          按日聚合

# 错题本
GET    /api/mistakes?subject=&mastered=
POST   /api/mistakes
PUT    /api/mistakes/:id            update (含 mastered 切换)
DELETE /api/mistakes/:id
GET    /api/mistakes/stats          失分归因 + 各科统计

# 试卷扫描
POST   /api/uploads                 (multipart) 上传图片
GET    /api/uploads                 历史列表
GET    /api/uploads/:id
GET    /api/uploads/:id/file        图片文件 (走后端鉴权)
DELETE /api/uploads/:id
POST   /api/uploads/:id/extract     AI 识别错题
POST   /api/uploads/:id/analyze     AI 全卷分析
POST   /api/uploads/:id/save-mistakes   把识别结果写入错题本

# 二次训练
GET    /api/practice                训练题集列表
GET    /api/practice/:set_id
POST   /api/mistakes/:id/generate-practice   AI 出类题
POST   /api/practice/items/:id/grade         AI 批改作答
DELETE /api/practice/:set_id

# Markdown 内容 (公开)
GET    /api/content
GET    /api/content/:name           分析报告 / 方法卡
```

### 3.5 AI 调用机制

所有 LLM 调用走 `backend/llm.py` → OpenClaw 网关（OpenAI 兼容格式）：

```python
# 文本调用
llm.chat([{"role": "user", "content": "..."}], temperature=0.3)

# 视觉调用 (图片自动转 base64 data URL)
llm.vision_chat("分析这张图...", [Path("/path/to.jpg")])

# JSON 严格输出 (带容错解析, 处理 markdown 代码块)
llm.json_chat(prompt, image_paths=[p], response_format_json=True)
```

**Prompts** 全部写在 `llm.py` 里，强约束返回 JSON：

- `EXTRACT_MISTAKES_PROMPT` — 从图提取错题列表
- `FULL_ANALYSIS_PROMPT` — 全卷诊断
- `GENERATE_PRACTICE_PROMPT` — 基于错题出类题
- `GRADE_PRACTICE_PROMPT` — 学生作答批改

Key 放在 `backend/data/.env`（权限 600），首次启动自动加载。

---

## 4. 目录结构

```
edu/
├── README.md                        (本文件)
├── start.sh                         本地一键启动
│
├── backend/                         Flask 后端
│   ├── app.py                       API 主入口 (40+ endpoints)
│   ├── db.py                        SQLite schema + 连接
│   ├── auth.py                      注册/登录/装饰器/join_code
│   ├── llm.py                       OpenClaw 视觉 LLM 客户端 + prompts
│   ├── plan_template.py             4 周计划模板 (100 条任务)
│   ├── seed.py                      种子: 立言账号 + 13 次考试
│   ├── server.py                    supervisor 风格适配层
│   ├── requirements.txt             flask/gunicorn/httpx/...
│   └── data/                        运行时数据 (不入 git)
│       ├── edu.db                   SQLite 主库
│       ├── .env                     LLM API key (chmod 600)
│       ├── .secret_key              Flask session key
│       └── uploads/<uid>/<uuid>.ext 用户上传的试卷原图
│
├── content/                         Markdown 知识内容 (API /content 读取)
│   ├── analysis.md                  完整学业诊断报告
│   ├── habits.md                    学习习惯清单
│   ├── method-math.md               数学速查卡
│   ├── method-science.md
│   ├── method-english.md
│   ├── method-chinese.md
│   └── method-social.md
│
├── frontend/                        React 前端
│   ├── index.html
│   ├── vite.config.ts               端口 5173, /api 代理到 5060
│   ├── tailwind.config.js
│   ├── src/
│   │   ├── main.tsx                 入口, AuthProvider
│   │   ├── App.tsx                  路由 + 侧边栏 + 路由守卫
│   │   ├── index.css                Tailwind + .md-content 样式
│   │   ├── api.ts                   fetch 封装 + types + 所有 API 方法
│   │   ├── auth.tsx                 AuthProvider + useAuth
│   │   ├── components/
│   │   │   └── MdViewer.tsx         react-markdown 渲染
│   │   └── pages/
│   │       ├── Login.tsx
│   │       ├── Register.tsx         (学生/家长角色切换)
│   │       ├── Dashboard.tsx        🏠 今日
│   │       ├── Trends.tsx           📈 趋势
│   │       ├── Plan.tsx             📅 计划
│   │       ├── Scan.tsx             📸 扫试卷
│   │       ├── ErrorBook.tsx        📓 错题本
│   │       ├── Practice.tsx         🏋️ 训练
│   │       ├── Methods.tsx          🎯 方法卡
│   │       └── Analysis.tsx         📄 分析
│   └── package.json
│
└── deploy/                          生产部署配置
    ├── push.sh                      本地一键部署脚本 (rsync + build + restart)
    ├── deploy.sh                    服务器上执行版 (git pull 版)
    ├── gunicorn.conf.py             workers × threads 配置
    ├── edu-backend.service          systemd unit
    └── nginx-edu.executor.life.conf HTTPS + SPA + /api 代理
```

---

## 5. 本地开发

### 一键启动

```bash
cd /Users/liqiuhua/work/personal/edu
./start.sh
```

首次运行会自动：
1. 初始化 SQLite (`backend/data/edu.db`)
2. 灌入立言历史成绩 + 4 周计划
3. 安装前端依赖
4. 启动后端 (`:5060`) + 前端 (`:5173`)

访问 http://127.0.0.1:5173。

### 分步启动（调试用）

**后端：**
```bash
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python3 seed.py         # 只第一次
python3 app.py          # Flask dev server
```

**前端：**
```bash
cd frontend
npm install             # 只第一次
npm run dev             # Vite dev server
```

### 本地启用 AI（可选）

本地默认不调用 AI（扫试卷会提示"AI 服务尚未配置"）。要在本地开发 AI 功能，在 `backend/data/.env` 创建：

```env
EDU_LLM_BASE_URL=https://bot.executor.life/v1
EDU_LLM_API_KEY=<your-openclaw-gateway-key>
EDU_LLM_MODEL=openclaw
```

重启后端即可。

---

## 6. 生产部署

### 一键部署（本地 → 线上）

```bash
./deploy/push.sh
```

5 步流水线：
1. `rsync` 源码到 `/opt/edu/`（排除 `node_modules` / `venv` / `*.db` / `.env` / `uploads`）
2. 差量 `pip install -r requirements.txt`
3. 远端 `npm run build`
4. `systemctl restart edu-backend`
5. 本地 + HTTPS 健康检查

环境变量可覆盖（默认指向已有服务器）：
```bash
EDU_SERVER_HOST=47.237.191.17
EDU_SERVER_PORT=22222
EDU_SERVER_USER=root
EDU_REMOTE_DIR=/opt/edu
EDU_DOMAIN=edu.executor.life
```

### 服务器布局

| 组件 | 位置 |
|---|---|
| 代码 | `/opt/edu/` |
| venv | `/opt/edu/venv/` |
| SQLite | `/opt/edu/backend/data/edu.db` |
| LLM Key | `/opt/edu/backend/data/.env` (chmod 600) |
| 用户上传 | `/opt/edu/backend/data/uploads/<uid>/` |
| 前端构建 | `/opt/edu/frontend/dist/` |
| systemd unit | `/etc/systemd/system/edu-backend.service` |
| Nginx conf | `/etc/nginx/conf.d/edu.executor.life.conf` |
| SSL 证书 | `/etc/letsencrypt/live/edu.executor.life/` |
| 应用日志 | `/var/log/edu/backend.{log,err}` · `journalctl -u edu-backend` |
| 运行模式 | Gunicorn 22 (preload, N workers × 2 threads) 监听 `127.0.0.1:5060` |

### 数据保护

`push.sh` 的 rsync 排除规则明确**不会覆盖**：
- `backend/data/*.db` — 用户数据（打卡、错题、训练）
- `backend/data/.secret_key` — Flask session key
- `backend/data/.env` — LLM API key
- `backend/data/uploads/` — 用户上传的试卷原图

服务器上的用户数据永远只受管理员影响，部署流程碰不到。

---

## 7. 设计要点

1. **多租户隔离** — 所有业务表带 `owner_user_id`，`@login_required` 装饰器注入 `g.owner_id`，查询按此过滤，修改类操作显式校验 `row.owner_user_id == g.owner_id` 不匹配返回 403。
2. **学生/家长同一前端** — 学生看自己，家长通过 `student_id` 看绑定学生。后端 `get_owner_student_id()` 统一返回，前端只有视图区别（join code 显示 / "正在查看 xxx"）。
3. **MD 驱动内容** — 分析报告和方法卡都是 `content/*.md`，前端 `MdViewer` 走 `/api/content/:name` 渲染。改内容不动代码。
4. **打卡幂等** — `checkins(task_id, checkin_date) UNIQUE` + `ON CONFLICT DO UPDATE`，反复点击不会产生脏数据。
5. **计划克隆** — `plan_template.py` 存 100 条模板任务，新学生注册时 `install_plan_for_student()` 克隆到自己的 tasks 表。不同学生可独立编辑/打卡。
6. **AI 调用同步阻塞** — LLM 请求 10-40s，前端显示 loading 状态，不搞异步队列，保持架构简单。
7. **JSON 严格输出** — 所有 AI 调用用 `response_format={"type":"json_object"}` + `_parse_json_loose()` 多级容错（去 markdown 代码块、提取 `{...}` 片段）。
8. **LLM Key 环境隔离** — `backend/data/.env` 存 key，chmod 600，`.gitignore` + `rsync --exclude` 双重保护。
9. **gunicorn preload 兼容** — `init_db()` 调用放在 `app.py` 模块顶层（而非 `__main__`），保证任何启动路径（flask dev / gunicorn / server.py）都能建表。

---

## 8. 常见操作

### 清库重来（危险）

```bash
cd backend
rm data/edu.db
python3 seed.py
```

会丢失所有用户、打卡、错题、上传。生产环境请先备份 `edu.db`。

### 服务器上看日志

```bash
ssh -p 22222 root@47.237.191.17

# 应用层
tail -f /var/log/edu/backend.log
tail -f /var/log/edu/backend.err

# systemd 层
journalctl -u edu-backend -f

# Nginx
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log
```

### 服务器上手动重启

```bash
systemctl restart edu-backend
systemctl status edu-backend
nginx -s reload
```

### 备份数据库

```bash
ssh -p 22222 root@47.237.191.17 "sqlite3 /opt/edu/backend/data/edu.db .dump" \
    > edu-backup-$(date +%Y%m%d).sql
```

### 证书续签

Certbot 已装定时任务自动续签，手动触发：

```bash
ssh -p 22222 root@47.237.191.17 "certbot renew && nginx -s reload"
```

---

## 9. 未来可扩展

- **大图前端压缩** — 手机拍照原图 3-5MB，前端压到 1MB 以内降低 token 成本
- **多张拼接上传** — 一份试卷拍多张合并识别
- **月度复盘报告** — 每月初基于当月错题自动生成诊断报告
- **训练日历** — Dashboard 加"连续打卡天数"、"今日训练完成率"
- **家长推送** — 家长账号收到孩子新错题 / 训练完成的提醒
- **自定义科目** — `users.settings_json` 已预留，可让用户配置本校的科目和满分
- **学习笔记** — 可与 `content/` 的 MD 知识点联动

---

## 10. 许可与致谢

- Repo: https://github.com/itsoso/edu (private)
- 线上: https://edu.executor.life
- 技术栈参考: `base.executor.life` (llms-board)
- AI 网关: `https://bot.executor.life/v1` (OpenClaw)
