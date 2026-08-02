# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 跨项目工程规范 (所有项目共享)

优先遵循 `~/work/personal/PRACTICES/` 下的通用实践 + `~/.claude/CLAUDE.md` 全局规则:

- 移动端 / Expo / iOS 开发 → [`mobile-expo-dev-workflow.md`](../PRACTICES/mobile-expo-dev-workflow.md) — 4 通道模型、反馈环、Metro 坑、凭证/Sentry env 配置
- Expo local native module → [`expo-local-module-podspec.md`](../PRACTICES/expo-local-module-podspec.md)
- LLM Agent / Orchestrator 设计 → [`~/work/personal/health-llm-driven/docs/HARNESS.md`](../health-llm-driven/docs/HARNESS.md)

项目特有规范写在下面,与上面冲突时项目内的优先。

## Repository layout

Three deployable surfaces, one backend:

- `backend/` — Flask 3 + SQLite + OpenAI-compatible LLM gateway ("OpenClaw"). Single source of truth for data.
- `frontend/` — React 18 + Vite + Tailwind web app. Also wrapped by Capacitor (`frontend/ios/`) as a thin native shell that loads `https://<domain>`.
- `mobile/` — Bare React Native 0.76 (no Expo), native iOS/Android shipped to TestFlight. Independent UI; shares only the HTTP contract.
- `content/*.md` — authoring content (method cards, analysis report) served via `/api/content/:name`. Edit prose here, not in code.

The README.md at the repo root is user-facing product documentation; keep details about LLM keys, deploy layout, and user flows there, not in CLAUDE.md.

## Common commands

**Backend**
```bash
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python3 seed.py          # first run only — creates data/edu.db + demo account
python3 app.py           # Flask dev server, 127.0.0.1:5060
pytest                   # runs backend/tests/ (fresh tmp DB per test via conftest)
pytest tests/test_auth_and_isolation.py::test_something -xvs   # single test
```
`pytest` and `pytest-mock` / `pytest` itself are not pinned in `requirements.txt`; install on the side when running tests (`pip install pytest`).

**Frontend (web)**
```bash
cd frontend
npm install
npm run dev              # Vite :5173, proxies /api → :5060
npm run build            # tsc + vite build → dist/
npm test                 # vitest run
npm run ios:sync         # build + cap sync (for the Capacitor web-shell iOS wrapper)
```

**Mobile (bare RN)**
```bash
cd mobile
npm install --legacy-peer-deps
(cd ios && pod install)    # first run, ~5 min
npm start                  # Metro
npm run ios                # simulator
```

**One-shot local dev**
```bash
./start.sh                 # seeds + starts backend + frontend together
```

**Deploy**
```bash
./deploy/push.sh           # rsync → pip install → npm build → systemctl restart edu-backend
./deploy/testflight.sh     # bare RN archive + upload to App Store Connect (details in deploy/TESTFLIGHT.md)
```

## Backend architecture

`app.py` is a thin factory. **All business endpoints live in `backend/routes/<domain>.py` blueprints**, registered in `app.py`'s `create_app()`. Adding an endpoint means: create/extend a blueprint file, add it to the registration tuple in `app.py`, and write a test in `backend/tests/`.

`init_db()` runs at **module top-level** (not in `__main__`) so it executes under any entrypoint — Flask dev, gunicorn preload, `server.py`. `CREATE TABLE IF NOT EXISTS` + `_run_migrations()` makes it idempotent. Add lightweight column additions to `_run_migrations` using the `_column_exists` pattern — do not write destructive migrations.

**Multi-tenant isolation is load-bearing.** Every business table has `owner_user_id`. `@login_required` populates `g.current_user` / `g.owner_id`, and **every query must filter by `owner_user_id`**, every write must verify `row.owner_user_id == g.owner_id`. The student/parent dual-mode works because `get_owner_student_id()` returns the student id whether the session user is the student or a bound parent; parent views are read-only downstream of this helper.

**Two authentication modes share one backend:**
- Web: Flask session cookie (HttpOnly, SameSite=Lax, Secure in prod).
- Mobile (bare RN): `Authorization: Bearer <token>` via `POST /api/auth/token-login`, token stored in iOS Keychain.
- `login_required` accepts both. Do not branch on client; treat them as equivalent.

**Agent Native architecture (P2+).** Six LLM-driven subsystems live in `backend/agent_*.py` (`tutor`, `reflector`, `curator`, `coach`, `guardian`, `feynman`) with matching route blueprints. They read from `profile_builder.py`-produced student profiles. Strict constraints:
- **Decisions are rule-based; LLM only polishes wording.** Keep the two separated so failures are debuggable.
- **No reflection / journal / essay raw content enters LLM prompts.** Only metadata (counts, keywords). This is a privacy contract — check prompts you write against this rule.
- Profile is written only by the daily `profile_builder` build job; agents read, never mutate.
- Suggestions require `rationale` + `evidence_refs` so they're auditable.

**LLM calls are synchronous but offloaded.** `llm.py` wraps OpenAI-compatible chat completions with `chat()`, `vision_chat()`, `json_chat()` (latter has a tolerant `_parse_json_loose` that strips markdown code fences). Long calls (image extraction, practice generation) are pushed to `background.py`'s `ThreadPoolExecutor`; status is written back to SQLite and the frontend polls. **Do not introduce Celery/Redis** — the in-process executor is deliberate. Background threads must not touch Flask `g` / `session` / `request` — snapshot needed values before `submit()`.

**LLM config:** `EDU_LLM_BASE_URL` / `EDU_LLM_API_KEY` / `EDU_LLM_MODEL` come from `backend/data/.env` (chmod 600, not in git, not touched by `push.sh`). Locally, missing keys degrade to "LLM not configured" errors; tests should mock `llm.get_llm()`.

**Data at rest on the server never gets touched by deploys.** `push.sh` excludes `backend/data/*.db`, `.secret_key`, `.env`, `uploads/`. Never change this list without a corresponding backup plan.

## Frontend architecture

- `src/api.ts` is the **only** HTTP layer — all fetches + types go here. Keep it in sync with `mobile/src/lib/api.ts` when changing contracts; there's no codegen.
- `src/auth.tsx` provides `AuthProvider` + `useAuth`; `App.tsx` uses it for route guards.
- Page components in `src/pages/` map 1:1 to nav entries. New pages → add route in `App.tsx` + sidebar entry.
- Markdown-driven content (`/methods`, `/analysis`) goes through `MdViewer.tsx` against `/api/content/:name`. Don't hardcode method content in JSX.
- Bundle split in `vite.config.ts` keeps `recharts` and `react-markdown` in their own chunks — preserve unless you have a reason.

## Mobile architecture (bare RN)

- No Expo. Uses React Native CLI, so ios/android native projects are checked in and must be kept in sync.
- `src/lib/auth.tsx` uses `react-native-keychain`; token persists across launches.
- `src/lib/api.ts` points at `API_BASE_URL` (`src/lib/config.ts`). Local dev needs a LAN IP reachable from the device — `localhost` won't work from a phone.
- UI is independent of web; sharing types between web and mobile is manual.

## Testing conventions

- `backend/tests/conftest.py` creates a fresh tmp `edu.db` per test and monkeypatches both `db.DB_PATH` and `UPLOAD_DIR`. It also stubs out `cleanup.start_cleanup_daemon` so threads don't leak.
- Always use the `client` / `helpers` fixtures instead of importing `app.create_app()` directly — ordering (env → DB patch → app import) matters.
- Tests should exercise isolation: create two users, verify data doesn't leak across `owner_user_id`.

## Things to avoid

- Do not answer with "just write a migration" for non-additive schema changes — the prod DB is the user's data and `push.sh` never touches it. Coordinate explicitly with the user first.
- Do not route LLM prompts through content that is protected (reflections, journal text, essay text). Stats/keywords only.
- Do not add a new long-running task via naked `Thread(...)`; use `background.py`'s executor so it inherits logging + status plumbing.
- Do not put secrets or gateway URLs in code. `backend/data/.env` is the only home.
- Do not commit `backend/data/` (ignored); don't commit `mobile/ios/Pods/`, `build/`, `DerivedData/` either.
