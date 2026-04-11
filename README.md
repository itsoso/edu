# 立言学习系统 (edu)

为初二女儿潘立言定制的学业追踪 + 提升系统。参考 `base.executor.life` 模式：
**Flask + SQLite + React + TypeScript + Vite + Tailwind**。

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
exams      (id, exam_name, exam_date, stage, total, grade_rank, ...)
scores     (id, exam_id, subject, score, full_mark)
tasks      (id, week, day_of_week, subject, title, description, minutes)
checkins   (id, task_id, checkin_date, completed, duration_minutes)
mistakes   (id, subject, question_text, reason, knowledge_point, mastered, ...)
```

## API 概览

```
GET    /api/exams                  列出所有考试 + 各科分数
POST   /api/exams                  录入新考试
DELETE /api/exams/:id              删除
GET    /api/scores/trend           趋势数据

GET    /api/tasks?week=1&day=1     查询任务
GET    /api/checkins?date=...      查询打卡
POST   /api/checkins               打卡 (upsert)
GET    /api/checkins/stats         按日聚合

GET    /api/mistakes               错题列表
POST   /api/mistakes               添加错题
PUT    /api/mistakes/:id           更新 (包括 mastered)
DELETE /api/mistakes/:id
GET    /api/mistakes/stats         失分归因统计

GET    /api/content                列出所有 MD 内容
GET    /api/content/:name          读取某篇 MD
```

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
