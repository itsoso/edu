# AI Recommendation Trust + IA Consolidation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the daily recommendation explainable and make the product IA center on five primary destinations.

**Architecture:** Extend the existing rule-based `/api/agent/next-action` endpoint with reason, evidence, confidence, and estimated duration fields. Keep recommendation logic deterministic and tested in `backend/tests/`, then update the React shell and Today page to make the recommendation the dominant action while moving secondary destinations into hub pages.

**Tech Stack:** Flask + SQLite + pytest backend; React 18 + TypeScript + Vite + Vitest frontend; existing `interaction_signals` event pipeline.

---

## Task 1: Add Explainable NextAction Contract Tests

**Files:**
- Modify: `backend/tests/test_next_action.py`
- Modify: `backend/tests/test_next_action_priority.py`

**Step 1: Write failing tests for mistake reasons**

Append to `backend/tests/test_next_action.py`:

```python
def test_next_action_mistake_includes_reason_and_estimated_minutes(client, helpers):
    user = helpers.register_student(client, username="next-action-reason-mistake")

    with db_module.db() as conn:
        for idx in range(3):
            conn.execute(
                """INSERT INTO mistakes
                   (owner_user_id, subject, question_text, correct_answer, reason, knowledge_point)
                   VALUES (?, '数学', ?, 'x=1', '移项错', '分式方程')""",
                (user["id"], f"题 {idx}"),
            )

    resp = client.get("/api/agent/next-action")

    assert resp.status_code == 200
    action = resp.get_json()["action"]
    assert action["kind"] == "mistake"
    assert action["estimated_minutes"] == 10
    assert action["reason"]["primary"] == "这类题最近重复出错"
    assert "知识点：分式方程" in action["reason"]["evidence"]
    assert "未掌握错题：3 道" in action["reason"]["evidence"]
    assert action["reason"]["confidence"] == "high"
```

**Step 2: Write failing tests for practice reasons**

Append to `backend/tests/test_next_action_priority.py`:

```python
def test_next_action_practice_includes_accuracy_reason(client, helpers):
    user = helpers.register_student(client, username="next-priority-practice-reason")

    with db_module.db() as conn:
        cur = conn.execute(
            """INSERT INTO practice_sets
               (owner_user_id, source_mistake_id, title, subject, knowledge_point, status)
               VALUES (?, NULL, '数学专项', '数学', '一元二次方程', 'done')""",
            (user["id"],),
        )
        set_id = cur.lastrowid
        conn.execute(
            "INSERT INTO practice_items (set_id, question_text, is_correct, score) VALUES (?, '题 1', 0, 30)",
            (set_id,),
        )
        conn.execute(
            "INSERT INTO practice_items (set_id, question_text, is_correct, score) VALUES (?, '题 2', 1, 100)",
            (set_id,),
        )
        conn.execute(
            "INSERT INTO practice_items (set_id, question_text, is_correct, score) VALUES (?, '题 3', NULL, NULL)",
            (set_id,),
        )

    resp = client.get("/api/agent/next-action")

    assert resp.status_code == 200
    action = resp.get_json()["action"]
    assert action["practice_set_id"] == set_id
    assert action["estimated_minutes"] == 12
    assert action["reason"]["primary"] == "这组训练还没完全稳住"
    assert "已完成：2/3 题" in action["reason"]["evidence"]
    assert "正确率：1/2" in action["reason"]["evidence"]
```

**Step 3: Run tests to verify they fail**

Run:

```bash
cd backend
pytest tests/test_next_action.py::test_next_action_mistake_includes_reason_and_estimated_minutes tests/test_next_action_priority.py::test_next_action_practice_includes_accuracy_reason -q
```

Expected: FAIL because `estimated_minutes` and `reason` are missing.

**Step 4: Commit failing tests**

Do not commit failing tests alone unless the project convention requires it. Prefer implementing Task 2 immediately and committing tests + implementation together.

## Task 2: Implement Explainable NextAction Backend

**Files:**
- Modify: `backend/routes/agent.py`
- Test: `backend/tests/test_next_action.py`
- Test: `backend/tests/test_next_action_priority.py`

**Step 1: Add reason helpers**

In `backend/routes/agent.py`, add helpers near the top:

```python
def _confidence_from_count(n: int) -> str:
    if n >= 3:
        return "high"
    if n >= 2:
        return "medium"
    return "low"


def _reason(primary: str, evidence: list[str], confidence: str) -> dict:
    return {
        "primary": primary,
        "evidence": [x for x in evidence if x],
        "confidence": confidence,
    }
```

**Step 2: Add mistake reason fields**

Update `_build_next_mistake_action()` to compute all open mistakes for the selected knowledge point:

```python
open_count = row["repeat_count"] or 1
topic = row["knowledge_point"] or row["reason"] or "这道题"
primary = "这类题最近重复出错" if open_count >= 2 else "这道错题还没有处理"
evidence = [
    f"知识点：{topic}" if topic else "",
    f"未掌握错题：{open_count} 道",
]
```

Return these new fields:

```python
"estimated_minutes": 10,
"reason": _reason(primary, evidence, _confidence_from_count(open_count)),
```

**Step 3: Add practice reason fields**

In `_build_next_practice_action()`, compute:

```python
item_count = row["item_count"] or 0
graded_count = row["graded_count"] or 0
correct_count = row["correct_count"] or 0
wrong_count = row["wrong_count"] or 0
confidence = "high" if wrong_count >= 2 else "medium" if wrong_count == 1 else "low"
evidence = [
    f"知识点：{row['knowledge_point']}" if row["knowledge_point"] else "",
    f"已完成：{graded_count}/{item_count} 题",
    f"正确率：{correct_count}/{graded_count}" if graded_count else "还没有提交过",
]
```

Return:

```python
"estimated_minutes": 12,
"reason": _reason("这组训练还没完全稳住", evidence, confidence),
```

**Step 4: Add task reason fields**

In `_build_next_task_action()`, return:

```python
"estimated_minutes": minutes,
"reason": _reason(
    "今天还有一个短任务",
    [
        f"科目：{row['subject']}" if row["subject"] else "",
        f"预计用时：{minutes} 分钟",
    ],
    "medium",
),
```

**Step 5: Run targeted tests**

Run:

```bash
cd backend
pytest tests/test_next_action.py tests/test_next_action_priority.py -q
```

Expected: PASS.

**Step 6: Commit**

```bash
git add backend/routes/agent.py backend/tests/test_next_action.py backend/tests/test_next_action_priority.py
git commit -m "feat: explain daily next action"
```

## Task 3: Add NextAction Feedback Signal

**Files:**
- Modify: `backend/routes/signals.py`
- Modify: `backend/tests/test_signals_next_action.py`
- Modify: `frontend/src/lib/signals.ts`

**Step 1: Write failing backend signal test**

Append to `backend/tests/test_signals_next_action.py`:

```python
def test_next_action_feedback_signal_is_accepted(client, helpers):
    helpers.register_student(client, username="signals-next-feedback")

    resp = client.post(
        "/api/signals",
        json={
            "events": [
                {
                    "event_type": "next_action.feedback",
                    "payload": {
                        "kind": "practice",
                        "feedback": "too_hard",
                        "cta_path": "/practice?set=1",
                        "reason_primary": "这组训练还没完全稳住",
                    },
                    "session_id": "s1",
                    "client": "web",
                }
            ]
        },
    )

    assert resp.status_code == 200
    assert resp.get_json()["accepted"] == 1
```

**Step 2: Run test to verify it fails**

Run:

```bash
cd backend
pytest tests/test_signals_next_action.py::test_next_action_feedback_signal_is_accepted -q
```

Expected: FAIL with accepted `0`.

**Step 3: Add backend allowlist**

In `backend/routes/signals.py`:

```python
ALLOWED_EVENT_TYPES = {
    ...
    "next_action.feedback",
}
```

Add payload schema:

```python
"next_action.feedback": {"kind", "feedback", "cta_path", "reason_primary"},
```

**Step 4: Add frontend signal type**

In `frontend/src/lib/signals.ts`, add:

```ts
| 'next_action.feedback'
```

**Step 5: Run tests**

Run:

```bash
cd backend
pytest tests/test_signals_next_action.py -q
```

Expected: PASS.

**Step 6: Commit**

```bash
git add backend/routes/signals.py backend/tests/test_signals_next_action.py frontend/src/lib/signals.ts
git commit -m "feat: track next action feedback"
```

## Task 4: Update Frontend NextAction Types and Card UI

**Files:**
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/pages/Dashboard.tsx`
- Test: `frontend/src/pages/Dashboard.parent.test.tsx` if affected

**Step 1: Extend TypeScript type**

In `frontend/src/api.ts`, update `NextAction`:

```ts
export type NextAction = {
  kind: 'mistake' | 'practice' | 'task' | string
  title: string
  description: string
  cta_label: string
  cta_path: string
  subject?: string | null
  knowledge_point?: string | null
  source_mistake_id?: number | null
  practice_set_id?: number | null
  task_id?: number | null
  estimated_minutes?: number | null
  reason?: {
    primary: string
    evidence: string[]
    confidence: 'high' | 'medium' | 'low' | string
  }
}
```

**Step 2: Add feedback handler in `NextActionCard`**

Change props:

```ts
function NextActionCard({
  action,
  onClick,
  onFeedback,
}: {
  action: NextAction
  onClick?: () => void
  onFeedback?: (feedback: 'not_today' | 'too_hard' | 'already_know') => void
})
```

Pass from parent:

```tsx
onFeedback={(feedback) =>
  signals.track('next_action.feedback', {
    related_table:
      nextAction.kind === 'mistake'
        ? 'mistakes'
        : nextAction.kind === 'practice'
        ? 'practice_sets'
        : nextAction.kind === 'task'
        ? 'tasks'
        : undefined,
    related_id:
      nextAction.source_mistake_id ||
      nextAction.practice_set_id ||
      nextAction.task_id ||
      undefined,
    payload: {
      kind: nextAction.kind,
      feedback,
      cta_path: nextAction.cta_path,
      reason_primary: nextAction.reason?.primary || '',
    },
  })
}
```

**Step 3: Render reason and evidence**

Inside `NextActionCard`, below description:

```tsx
{action.reason && (
  <div className="mt-3 rounded-xl border border-slate-200 bg-white/80 p-3">
    <div className="text-xs font-semibold text-slate-500">为什么推荐这个</div>
    <div className="mt-1 text-sm font-medium text-slate-800">{action.reason.primary}</div>
    {action.reason.evidence.length > 0 && (
      <ul className="mt-2 space-y-1 text-xs text-slate-500">
        {action.reason.evidence.slice(0, 3).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    )}
  </div>
)}
```

Add estimated time near the badge:

```tsx
{action.estimated_minutes && (
  <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
    约 {action.estimated_minutes} 分钟
  </span>
)}
```

Add feedback buttons:

```tsx
<div className="mt-3 flex flex-wrap gap-2 text-xs">
  <button type="button" onClick={() => onFeedback?.('not_today')} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-500">
    今天不想做
  </button>
  <button type="button" onClick={() => onFeedback?.('too_hard')} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-500">
    太难了
  </button>
  <button type="button" onClick={() => onFeedback?.('already_know')} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-500">
    已经会了
  </button>
</div>
```

**Step 4: Run frontend tests and typecheck**

Run:

```bash
cd frontend
npm test -- Dashboard.parent.test.tsx
npm run build
```

Expected: tests pass and TypeScript compiles.

**Step 5: Commit**

```bash
git add frontend/src/api.ts frontend/src/pages/Dashboard.tsx frontend/src/lib/signals.ts
git commit -m "feat: show next action rationale"
```

## Task 5: Collapse Desktop Navigation to Five Primary Destinations

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/pages/GrowthHome.tsx`
- Modify: `frontend/src/pages/MyHome.tsx`
- Modify: `frontend/src/pages/ErrorBook.tsx`
- Modify: `frontend/src/pages/Practice.tsx`

**Step 1: Keep routes, reduce persistent nav**

In `frontend/src/App.tsx`, keep all route definitions unchanged. Change the desktop sidebar so it renders only `primaryItems`.

Remove the visible desktop “更多功能” section:

```tsx
<div className="flex-1 overflow-y-auto py-3">
  <nav aria-label="主导航" className="flex flex-col">
    {primaryItems.map((item) => (
      <ShellNavLink key={item.to} item={item} desktop />
    ))}
  </nav>
</div>
```

For mobile, keep the current “更多” panel for now unless it creates usability problems. The P0 goal is to remove constant desktop clutter without breaking mobile access.

**Step 2: Add secondary entry cards to hub pages**

Ensure these hub pages expose the moved functionality:

- `frontend/src/pages/GrowthHome.tsx`: trends, insights, reports, methods
- `frontend/src/pages/MyHome.tsx`: journal, essays, feynman history, settings
- `frontend/src/pages/ErrorBook.tsx`: add a visible link to `/scan`
- `frontend/src/pages/Practice.tsx`: keep print and training-set flows accessible

If `ErrorBook.tsx` does not already link to scan, add a compact top action:

```tsx
<Link
  to="/scan"
  className="inline-flex min-h-10 items-center justify-center rounded-full border border-brand-200 bg-brand-50 px-4 text-sm font-medium text-brand-700"
>
  扫试卷
</Link>
```

**Step 3: Run build**

Run:

```bash
cd frontend
npm run build
```

Expected: TypeScript and Vite build pass.

**Step 4: Visual smoke test**

Start dev server:

```bash
cd frontend
npm run dev
```

Open the app with Browser plugin and verify:

- Desktop sidebar shows only 今日、错题本、训练、成长、我的
- Old routes still work by direct URL
- Growth and My hub pages expose their secondary destinations
- Scan remains discoverable from 错题

**Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/pages/GrowthHome.tsx frontend/src/pages/MyHome.tsx frontend/src/pages/ErrorBook.tsx frontend/src/pages/Practice.tsx
git commit -m "feat: consolidate primary navigation"
```

## Task 6: Make Today Page Recommendation-Dominant

**Files:**
- Modify: `frontend/src/pages/Dashboard.tsx`

**Step 1: Reorder Today content**

Keep `NextActionCard` immediately after the page header. Move the following into a single collapsed block titled `今天其他事项`:

- `GuardianAlerts`
- `WeekendCoursesCard`
- `TutorCard`
- `CuratorBlock`
- `CoachWeekCard`
- `WeeklyGoalCeremony`

Use:

```tsx
<details className="rounded-2xl border border-slate-200 bg-white p-4">
  <summary className="cursor-pointer text-sm font-semibold text-slate-700">
    今天其他事项
  </summary>
  <div className="mt-4 space-y-4">
    ...
  </div>
</details>
```

**Step 2: Keep Today tasks below main action**

Leave the existing 今日任务 block below the recommendation card and collapsed secondary block. Do not remove task checkins.

**Step 3: Avoid duplicate CTAs**

Keep quick links at the bottom, but remove links that duplicate primary nav if the page feels crowded after visual test. Prefer preserving access over aggressive deletion in P0.

**Step 4: Run frontend build**

Run:

```bash
cd frontend
npm run build
```

Expected: build passes.

**Step 5: Visual smoke test**

Verify desktop and mobile:

- Main recommendation appears above all agent blocks
- Recommendation reason is visible without expanding anything
- Secondary agent content is still reachable
- Text does not overlap in the recommendation card

**Step 6: Commit**

```bash
git add frontend/src/pages/Dashboard.tsx
git commit -m "feat: make today recommendation first"
```

## Task 7: Add Recommendation Effectiveness API for Growth Page

**Files:**
- Modify: `backend/routes/agent.py`
- Create: `backend/tests/test_recommendation_effectiveness.py`

**Step 1: Write failing API test**

Create `backend/tests/test_recommendation_effectiveness.py`:

```python
import json

import db as db_module


def test_recommendation_effectiveness_summary(client, helpers):
    user = helpers.register_student(client, username="recommendation-effectiveness")

    with db_module.db() as conn:
        conn.execute(
            """INSERT INTO interaction_signals
               (owner_user_id, event_type, payload_json, session_id, client)
               VALUES (?, 'next_action.shown', ?, 's1', 'web')""",
            (user["id"], json.dumps({"kind": "practice", "cta_path": "/practice?set=1"})),
        )
        conn.execute(
            """INSERT INTO interaction_signals
               (owner_user_id, event_type, payload_json, session_id, client)
               VALUES (?, 'next_action.clicked', ?, 's1', 'web')""",
            (user["id"], json.dumps({"kind": "practice", "cta_path": "/practice?set=1"})),
        )
        conn.execute(
            """INSERT INTO interaction_signals
               (owner_user_id, event_type, payload_json, session_id, client)
               VALUES (?, 'next_action.completed', ?, 's1', 'web')""",
            (user["id"], json.dumps({"source_kind": "practice", "target_kind": "today"})),
        )

    resp = client.get("/api/agent/recommendation-effectiveness")

    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload["window_days"] == 7
    assert payload["shown"] == 1
    assert payload["clicked"] == 1
    assert payload["completed"] == 1
```

**Step 2: Run test to verify it fails**

Run:

```bash
cd backend
pytest tests/test_recommendation_effectiveness.py -q
```

Expected: FAIL with 404.

**Step 3: Implement endpoint**

Add to `backend/routes/agent.py`:

```python
@bp.get("/api/agent/recommendation-effectiveness")
@login_required
def recommendation_effectiveness():
    days = request.args.get("days", default=7, type=int)
    days = max(1, min(days, 30))
    since_expr = f"-{days} days"
    with db() as conn:
        rows = conn.execute(
            """SELECT event_type, COUNT(*) AS n
               FROM interaction_signals
               WHERE owner_user_id = ?
                 AND event_type IN (
                   'next_action.shown',
                   'next_action.clicked',
                   'next_action.completed',
                   'next_action.feedback'
                 )
                 AND occurred_at >= date('now', ?)
               GROUP BY event_type""",
            (g.owner_id, since_expr),
        ).fetchall()
    counts = {r["event_type"]: r["n"] for r in rows}
    return jsonify({
        "window_days": days,
        "shown": counts.get("next_action.shown", 0),
        "clicked": counts.get("next_action.clicked", 0),
        "completed": counts.get("next_action.completed", 0),
        "feedback": counts.get("next_action.feedback", 0),
    })
```

**Step 4: Run test**

Run:

```bash
cd backend
pytest tests/test_recommendation_effectiveness.py -q
```

Expected: PASS.

**Step 5: Commit**

```bash
git add backend/routes/agent.py backend/tests/test_recommendation_effectiveness.py
git commit -m "feat: summarize recommendation effectiveness"
```

## Task 8: Show Recommendation Effectiveness on Growth Page

**Files:**
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/pages/GrowthHome.tsx`

**Step 1: Add API method and type**

In `frontend/src/api.ts`:

```ts
export type RecommendationEffectiveness = {
  window_days: number
  shown: number
  clicked: number
  completed: number
  feedback: number
}
```

Add to `api`:

```ts
recommendationEffectiveness: (days = 7) =>
  request<RecommendationEffectiveness>(`/agent/recommendation-effectiveness?days=${days}`),
```

**Step 2: Load summary in GrowthHome**

In `frontend/src/pages/GrowthHome.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { api, RecommendationEffectiveness } from '../api'
```

Add state and effect:

```tsx
const [effectiveness, setEffectiveness] = useState<RecommendationEffectiveness | null>(null)

useEffect(() => {
  api.recommendationEffectiveness(7).then(setEffectiveness).catch(() => {})
}, [])
```

Add a top block below the hero:

```tsx
{effectiveness && (
  <div className="rounded-2xl border border-slate-200 bg-white p-5">
    <div className="text-sm font-semibold text-slate-900">本周推荐是否有效</div>
    <div className="mt-3 grid gap-3 sm:grid-cols-4">
      <Stat label="出现" value={effectiveness.shown} />
      <Stat label="点击" value={effectiveness.clicked} />
      <Stat label="完成" value={effectiveness.completed} />
      <Stat label="反馈" value={effectiveness.feedback} />
    </div>
  </div>
)}
```

Define local `Stat` component:

```tsx
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-slate-900">{value}</div>
    </div>
  )
}
```

**Step 3: Run build**

Run:

```bash
cd frontend
npm run build
```

Expected: build passes.

**Step 4: Commit**

```bash
git add frontend/src/api.ts frontend/src/pages/GrowthHome.tsx
git commit -m "feat: show recommendation effectiveness"
```

## Task 9: Final Verification

**Files:**
- No source edits unless verification finds issues.

**Step 1: Run backend tests**

Run:

```bash
cd backend
pytest tests/test_next_action.py tests/test_next_action_priority.py tests/test_signals_next_action.py tests/test_recommendation_effectiveness.py -q
```

Expected: PASS.

**Step 2: Run frontend build**

Run:

```bash
cd frontend
npm run build
```

Expected: PASS.

**Step 3: Run focused frontend tests**

Run:

```bash
cd frontend
npm test -- Dashboard.parent.test.tsx Practice.test.tsx
```

Expected: PASS.

**Step 4: Browser smoke test**

Start local app:

```bash
./start.sh
```

Use Browser plugin to verify:

- Today page shows one dominant recommendation card
- Recommendation reason and evidence render cleanly
- Feedback buttons send no visible errors
- Desktop navigation has five primary entries
- Growth page shows recommendation effectiveness
- Direct routes such as `/scan`, `/methods`, `/reports`, `/settings` still load

**Step 5: Commit final fixes if needed**

If any fixes were required:

```bash
git add <fixed-files>
git commit -m "fix: polish recommendation ia rollout"
```

## Execution Notes

- Keep all changes deterministic; do not use LLM calls for recommendation reasons in this phase.
- Do not change authentication behavior.
- Do not send raw question text, answer text, essay content, journal content, or reflection content through signals.
- Preserve all existing routes even when removing them from persistent navigation.
- If mobile uses separate navigation for these destinations, treat mobile IA as a follow-up unless the implementation touches shared API types.
