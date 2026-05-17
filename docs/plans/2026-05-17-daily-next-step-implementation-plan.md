# Daily Next Step Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reshape the product around a single daily “next best action” so kids open the app, get one clear action, and start with mistakes/training before general tasks.

**Architecture:** Keep the existing Flask + React architecture. Add a lightweight priority engine on the backend, surface one primary action on the dashboard, and reduce navigation weight on the frontend. Treat this as a product-shaping refactor, not a new feature island.

**Tech Stack:** Flask, SQLite, React, TypeScript, React Router, Tailwind, existing task/mistake/practice/report APIs.

---

### Task 1: Define the “next action” backend contract

**Files:**
- Modify: `backend/routes/agent.py`
- Modify: `frontend/src/api.ts`
- Test: `backend/tests/test_next_action.py`

**Step 1: Write failing backend tests**

- Add tests for:
  - newest unresolved mistake returns mistake-training action
  - unstable practice set returns retry-training action
  - no urgent mistakes falls back to task action

**Step 2: Run backend tests to verify failure**

Run: `pytest backend/tests/test_next_action.py -q`

**Step 3: Implement minimal route and response shape**

- Add a route that returns:
  - `kind`
  - `title`
  - `description`
  - `cta_label`
  - `cta_path`
  - optional `secondary_actions`

**Step 4: Re-run backend tests**

Run: `pytest backend/tests/test_next_action.py -q`

**Step 5: Commit**

```bash
git add backend/routes/agent.py backend/tests/test_next_action.py frontend/src/api.ts
git commit -m "feat: add next action api"
```

### Task 2: Add a lightweight priority engine

**Files:**
- Modify: `backend/routes/mistakes.py`
- Modify: `backend/routes/practice.py`
- Modify: `backend/routes/agent.py`
- Test: `backend/tests/test_next_action_priority.py`

**Step 1: Write failing tests for prioritization rules**

- repeated knowledge-point mistakes rank higher
- recent unresolved mistakes rank higher
- low-correctness practice sets rank higher than plain tasks

**Step 2: Run tests to verify failure**

Run: `pytest backend/tests/test_next_action_priority.py -q`

**Step 3: Implement minimal scoring**

- score mistakes by recency, repetition, unresolved state
- score practice by low correctness / incomplete state
- fall back to due tasks

**Step 4: Re-run tests**

Run: `pytest backend/tests/test_next_action_priority.py -q`

**Step 5: Commit**

```bash
git add backend/routes/mistakes.py backend/routes/practice.py backend/routes/agent.py backend/tests/test_next_action_priority.py
git commit -m "feat: prioritize daily learning actions"
```

### Task 3: Turn dashboard into a next-action home

**Files:**
- Modify: `frontend/src/pages/Dashboard.tsx`
- Create: `frontend/src/components/NextActionCard.tsx`
- Test: `frontend/src/components/NextActionCard.test.tsx`

**Step 1: Write failing component test**

- dashboard shows next action card when action exists
- primary CTA navigates correctly
- only limited secondary actions are shown

**Step 2: Run frontend test to verify failure**

Run: `cd frontend && npm test -- src/components/NextActionCard.test.tsx`

**Step 3: Implement UI**

- put next action card at top of dashboard
- keep summary cards below
- make copy action-oriented, not dashboard-like

**Step 4: Re-run test**

Run: `cd frontend && npm test -- src/components/NextActionCard.test.tsx`

**Step 5: Commit**

```bash
git add frontend/src/pages/Dashboard.tsx frontend/src/components/NextActionCard.tsx frontend/src/components/NextActionCard.test.tsx
git commit -m "feat: add next action dashboard card"
```

### Task 4: Auto-return to the next step after training

**Files:**
- Modify: `frontend/src/pages/Practice.tsx`
- Modify: `frontend/src/pages/ErrorBook.tsx`
- Test: `frontend/src/pages/Practice.test.tsx`

**Step 1: Write failing flow test**

- after completing a practice item/set, user sees a clear “next step” affordance

**Step 2: Run test to verify failure**

Run: `cd frontend && npm test -- src/pages/Practice.test.tsx`

**Step 3: Implement minimal flow**

- after key completion, show CTA back to dashboard or next recommended action
- avoid leaving user at a dead end

**Step 4: Re-run test**

Run: `cd frontend && npm test -- src/pages/Practice.test.tsx`

**Step 5: Commit**

```bash
git add frontend/src/pages/Practice.tsx frontend/src/pages/ErrorBook.tsx frontend/src/pages/Practice.test.tsx
git commit -m "feat: guide users to the next step after practice"
```

### Task 5: Slim primary navigation

**Files:**
- Modify: `frontend/src/App.tsx`
- Test: `frontend/src/App.test.tsx`

**Step 1: Write failing nav test**

- primary nav only exposes the reduced core destinations
- secondary features live in the more/desktop secondary area

**Step 2: Run test to verify failure**

Run: `cd frontend && npm test -- src/App.test.tsx`

**Step 3: Implement nav simplification**

- keep Today / Mistakes / Practice / Growth / Mine as primary mental model
- remap secondary destinations into grouped menus

**Step 4: Re-run test**

Run: `cd frontend && npm test -- src/App.test.tsx`

**Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/App.test.tsx
git commit -m "refactor: simplify primary navigation"
```

### Task 6: Build a parent-facing “worth seeing” summary

**Files:**
- Modify: `frontend/src/pages/Dashboard.tsx`
- Modify: `frontend/src/components/GuardianAlerts.tsx`
- Create: `frontend/src/components/ParentFocusCard.tsx`

**Step 1: Write failing UI test**

- parent dashboard highlights risk, progress, and suggested conversation

**Step 2: Run test to verify failure**

Run: `cd frontend && npm test -- src/pages/Dashboard.test.tsx`

**Step 3: Implement parent summary card**

- show current risk area
- show whether child addressed key weaknesses this week
- show one plain-language prompt for parent conversation

**Step 4: Re-run test**

Run: `cd frontend && npm test -- src/pages/Dashboard.test.tsx`

**Step 5: Commit**

```bash
git add frontend/src/pages/Dashboard.tsx frontend/src/components/GuardianAlerts.tsx frontend/src/components/ParentFocusCard.tsx
git commit -m "feat: add parent focus summary"
```

### Task 7: Add measurement for adoption

**Files:**
- Modify: `frontend/src/lib/signals.ts`
- Modify: `backend/routes/signals.py`
- Test: `backend/tests/test_signals_next_action.py`

**Step 1: Write failing analytics test**

- next action impression tracked
- next action click tracked
- practice completion tracked as follow-up outcome

**Step 2: Run test to verify failure**

Run: `pytest backend/tests/test_signals_next_action.py -q`

**Step 3: Implement event logging**

- track impression
- track click
- track completion chain

**Step 4: Re-run test**

Run: `pytest backend/tests/test_signals_next_action.py -q`

**Step 5: Commit**

```bash
git add frontend/src/lib/signals.ts backend/routes/signals.py backend/tests/test_signals_next_action.py
git commit -m "feat: instrument next action funnel"
```

### Task 8: Final verification

**Files:**
- No code changes required unless failures appear

**Step 1: Run backend verification**

Run:

```bash
pytest backend/tests/test_next_action.py backend/tests/test_next_action_priority.py backend/tests/test_signals_next_action.py -q
```

**Step 2: Run frontend verification**

Run:

```bash
cd frontend && npm test
cd frontend && npm run build
```

**Step 3: Smoke-test critical flows**

- student opens dashboard and sees one clear action
- mistake -> training -> next step chain works
- parent view shows focused summary

**Step 4: Commit final polish**

```bash
git add .
git commit -m "feat: introduce daily next action experience"
```
