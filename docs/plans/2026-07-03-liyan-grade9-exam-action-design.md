# 潘立言升初三考试驱动行动闭环

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use TDD for behavior changes.

**Goal:** 把系统从“记录成绩/课表”推进到“最近考试 -> 学科缺口 -> 今日行动 -> 周复盘”的升初三冲刺闭环。第一版只做确定性规则，不让 LLM 决策。

**Student Context:** 潘立言初二期末总分 569、年级排名 56。语文和英语是强项；社会 88、单科排名 112，是当前最明确短板；科学 141 低于个人近期均值；数学 112.5 分数不低但单科排名 95，需要高分段稳定性。

**Architecture:** Extend the existing Flask + SQLite exam and `next-action` stack. Add structured subject ranks, deterministic exam insight generation, and an `exam_gap` fallback before generic tasks. Keep all queries tenant-scoped via `g.owner_id`.

---

## P0 Scope

### Task 1: Structure Subject Ranks

**Files:**
- Modify: `backend/db.py`
- Modify: `backend/routes/exams.py`
- Modify: `frontend/src/api.ts`
- Test: `backend/tests/test_exam_action_insights.py`

**Behavior:**
- `scores` gets `subject_rank INTEGER`.
- `POST /api/exams` accepts `score_ranks: { [subject]: number }`.
- `GET /api/exams` returns `score_ranks` next to `scores`.

### Task 2: Add Latest Exam Insight

**Files:**
- Add: `backend/exam_insights.py`
- Modify: `backend/routes/exams.py`
- Test: `backend/tests/test_exam_action_insights.py`

**Behavior:**
- `GET /api/exams/insights/latest` returns latest exam, prior exam, focus subjects, strengths, and concise recommendations.
- Ranking and score-rate rules are deterministic and explainable.
- For 潘立言's current data, the focus order should start with `社会`, then include `科学` and `数学`.

### Task 3: Add Exam-Gap Next Action

**Files:**
- Modify: `backend/routes/agent.py`
- Modify: `frontend/src/api.ts`
- Test: `backend/tests/test_exam_action_insights.py`

**Behavior:**
- Existing priority remains: open mistake -> unfinished practice -> exam gap -> task.
- If there is no actionable mistake/practice, `next-action` can return:
  - `kind: "exam_gap"`
  - `subject`
  - `title`
  - `description`
  - `reason`
  - `cta_path: "/trends"`

### Task 4: Surface Insight In Trends

**Files:**
- Modify: `frontend/src/pages/Trends.tsx`
- Modify: `frontend/src/api.ts`

**Behavior:**
- Trends shows a compact latest-exam insight card above the chart.
- Copy stays action-oriented: one priority, evidence, and next training suggestion.

---

## Non-Goals

- Do not replace the existing plan module.
- Do not generate new practice questions in this pass.
- Do not let LLM read private reflections for this feature.
- Do not deploy automatically without a separate verification step.
