# 学习系统 (edu)

多租户学业追踪 + 提升系统。学生和家长都能登录，数据按账户隔离。
参考 `base.executor.life` 模式：**Flask + SQLite + React + TypeScript + Vite + Tailwind**。

## 用户模型

- **学生**：注册后获得 6 位 `join_code`（在"今日"页面可见），自动克隆 4 周计划模板
- **家长**：注册时凭学生的 `join_code` 绑定，只读查看自己孩子的全部数据
- **数据隔离**：所有考试/任务/错题按 `owner_user_id`（学生 id）隔离，跨账户访问返回 403

## 默认种子账号

```
用户名: liyan
密码:   liyan123
昵称:   潘立言
阶段:   初二下
(含 13 次历史考试 + 4 周计划)
```

## 核心功能

| 模块 | 说明 |
|---|---|
| 🏠 今日 | 今日任务打卡 · 最新成绩与趋势摘要 |
| 📈 趋势 | 各科得分率 / 总分 / 年排 折线图 + 手动录入新考试 |
| 📅 计划 | 4 周执行计划按天拆分 · 每日打卡 |
| 📓 错题本 | 错题录入 + 归因统计 (计算错/审题漏/...) + 标记掌握 |
| 🎯 方法卡 | 5 科学习方法速查卡 + 学习习惯清单 |
| 📄 分析 | 完整的学业诊断报告 |

## 目录结构

```
edu/
├── backend/               Flask + SQLite
│   ├── app.py             API 主入口 (端口 5060)
│   ├── db.py              Schema + 连接
│   ├── seed.py            历史成绩 + 4 周计划种子
│   ├── data/edu.db        SQLite 文件 (自动生成)
│   └── requirements.txt
├── content/               Markdown 内容 (分析 + 方法卡)
│   ├── analysis.md
│   ├── habits.md
│   ├── method-math.md
│   ├── method-science.md
│   ├── method-english.md
│   ├── method-chinese.md
│   └── method-social.md
├── frontend/              React + Vite + TS + Tailwind
│   ├── src/
│   │   ├── main.tsx / App.tsx
│   │   ├── api.ts
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Trends.tsx
│   │   │   ├── Plan.tsx
│   │   │   ├── ErrorBook.tsx
│   │   │   ├── Methods.tsx
│   │   │   └── Analysis.tsx
│   │   └── components/MdViewer.tsx
│   └── package.json
├── start.sh               一键启动脚本
└── README.md
```

## 快速开始

### 一键启动

```bash
cd /Users/liqiuhua/work/personal/edu
./start.sh
```

首次运行会自动：
1. 初始化 SQLite 数据库 (`backend/data/edu.db`)
2. 灌入 13 次历史考试成绩 + 100 条 4 周计划任务
3. 安装前端依赖 (`npm install`)
4. 启动后端 (5060) 和前端 (5173)

访问 http://127.0.0.1:5173 即可使用。

### 分步启动 (调试用)

**后端：**
```bash
cd backend
pip install -r requirements.txt
python3 seed.py          # 只第一次运行
python3 app.py           # 启动 Flask (端口 5060)
```

**前端：**
```bash
cd frontend
npm install              # 只第一次运行
npm run dev              # 启动 Vite (端口 5173)
```

## 数据库 Schema

```sql
users      (id, username, password_hash, display_name, role, student_id, join_code, stage, ...)
exams      (id, owner_user_id, exam_name, stage, total, grade_rank, ...)
scores     (id, exam_id, subject, score, full_mark)
tasks      (id, owner_user_id, week, day_of_week, subject, title, description, minutes)
checkins   (id, task_id, checkin_date, completed, duration_minutes)
mistakes   (id, owner_user_id, subject, reason, knowledge_point, mastered, ...)
```

所有业务表外键级联，删除学生账号会自动清理其全部数据。

## API 概览

```
# Auth (公开)
POST   /api/auth/register        注册 (role=student|parent)
POST   /api/auth/login           登录
POST   /api/auth/logout          退出
GET    /api/auth/me              当前会话

# 以下全部要求登录, 数据按 owner_user_id 过滤
GET    /api/exams                考试列表
POST   /api/exams                录入新考试
DELETE /api/exams/:id
GET    /api/scores/trend         趋势数据

GET    /api/tasks?week=1&day=1   任务列表
GET    /api/checkins?date=...    打卡
POST   /api/checkins             打卡 upsert
GET    /api/checkins/stats

GET    /api/mistakes             错题列表
POST   /api/mistakes
PUT    /api/mistakes/:id
DELETE /api/mistakes/:id
GET    /api/mistakes/stats

# 公共 MD 内容 (无需登录)
GET    /api/content
GET    /api/content/:name
```

## 认证机制

- Flask session cookie (HttpOnly, SameSite=Lax)
- 密码用 `werkzeug.security.generate_password_hash` 存 (pbkdf2)
- `SECRET_KEY` 首次启动自动生成并存到 `backend/data/.secret_key` (gitignored)
- 跨租户访问：端点里显式校验 `row.owner_user_id == g.owner_id`，不匹配返回 403

## 设计要点

1. **MD 驱动内容**：分析报告、方法卡都用 Markdown 写在 `content/` 下，前端走 `/api/content/:name` 渲染。改内容不用动代码。
2. **打卡幂等**：`checkins (task_id, checkin_date)` 有 UNIQUE 约束，反复勾选不会产生脏数据。
3. **满分推断**：科学 150 / 数学 120 / 英语 120 / 语文 120 / 社会 100 —— 如果与学校实际不符，改 `backend/seed.py::FULL_MARKS` 后重跑 seed。
4. **双用户视图**：同一前端既给立言每日打卡，也给家长看趋势，无需切账号。
5. **可扩展**：后续可加"笔记"、"计划调整"、"月度复盘"等模块，只需在 `backend/app.py` 加 endpoint + `frontend/src/pages/` 加页面。

## 再次灌种子 (清库重来)

```bash
cd backend
rm data/edu.db
python3 seed.py
```

⚠️ 这会丢失所有打卡记录和错题。生产使用后请谨慎。
