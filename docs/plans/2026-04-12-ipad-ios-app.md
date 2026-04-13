# iPad PWA And iOS Shell Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the existing web app comfortable on iPad and package it as an installable iOS app without rewriting the product.

**Architecture:** Keep the current Flask backend and React SPA unchanged at the business-logic level. Improve the frontend shell for iPad navigation and touch ergonomics, add PWA metadata plus a lightweight service worker for installability, then wrap the built frontend with Capacitor for iOS distribution.

**Tech Stack:** React 18, TypeScript, Vite, Tailwind CSS, Vitest, React Testing Library, Capacitor iOS

---

### Task 1: Add frontend test infrastructure for shell behavior

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/vitest.config.ts`
- Create: `frontend/src/test/setup.ts`
- Test: `frontend/src/App.test.tsx`

**Step 1: Write the failing test**

Add a test that renders the app shell in a small viewport and expects the compact bottom navigation trigger to appear while the desktop sidebar actions stay hidden.

**Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand`
Expected: FAIL because Vitest/test setup is not present yet.

**Step 3: Write minimal implementation**

Add Vitest and Testing Library dependencies plus the config and setup needed to render React components under jsdom.

**Step 4: Run test to verify it passes**

Run: `npm test -- --runInBand`
Expected: PASS for the new shell test.

**Step 5: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vitest.config.ts frontend/src/test/setup.ts frontend/src/App.test.tsx
git commit -m "test: add frontend shell test harness"
```

### Task 2: Implement iPad-friendly application shell

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/index.css`
- Create: `frontend/src/hooks/useInstallPrompt.ts`
- Test: `frontend/src/App.test.tsx`

**Step 1: Write the failing test**

Extend the shell test to assert that compact navigation, safe-area padding, and install prompt affordances appear in the intended viewport modes.

**Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- --runInBand`
Expected: FAIL because the shell still uses the old sidebar-only layout.

**Step 3: Write minimal implementation**

Refactor the shell to support:
- a sticky top bar on touch devices
- a bottom tab bar for primary destinations
- a “more” panel for secondary routes and logout
- safe-area spacing and larger touch targets

**Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- --runInBand`
Expected: PASS for shell behavior.

**Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/index.css frontend/src/hooks/useInstallPrompt.ts frontend/src/App.test.tsx
git commit -m "feat: adapt app shell for ipad use"
```

### Task 3: Add PWA install metadata and offline shell caching

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/public/manifest.json`
- Create: `frontend/public/sw.js`
- Create: `frontend/public/offline.html`
- Test: `frontend/src/pwa.test.ts`

**Step 1: Write the failing test**

Add a test that validates the manifest fields required for iPad installability and that the service worker registration helper is invoked in production mode.

**Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- --runInBand`
Expected: FAIL because the metadata and registration do not exist yet.

**Step 3: Write minimal implementation**

Add:
- iOS web app meta tags
- richer manifest metadata
- a basic service worker that caches the shell and offline page
- service worker registration in the frontend bootstrap

**Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- --runInBand`
Expected: PASS for manifest and registration tests.

**Step 5: Commit**

```bash
git add frontend/index.html frontend/src/main.tsx frontend/public/manifest.json frontend/public/sw.js frontend/public/offline.html frontend/src/pwa.test.ts
git commit -m "feat: add pwa install and offline shell support"
```

### Task 4: Integrate Capacitor iOS wrapper

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/capacitor.config.ts`
- Create: `frontend/ios/...`
- Modify: `README.md`

**Step 1: Write the failing test**

Use a config-level assertion that the Capacitor config points at the built web assets and production domain.

**Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- --runInBand`
Expected: FAIL because there is no Capacitor config.

**Step 3: Write minimal implementation**

Install Capacitor packages, initialize the app, add iOS platform files, and configure the wrapper to load the built SPA and allow the production origin needed for cookies and uploads.

**Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- --runInBand`
Expected: PASS for the config assertion and successful `npm run build`.

**Step 5: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/capacitor.config.ts frontend/ios README.md
git commit -m "feat: add capacitor ios wrapper"
```

### Task 5: Verify full build flow

**Files:**
- Modify: `README.md`

**Step 1: Run frontend tests**

Run: `cd frontend && npm test -- --runInBand`
Expected: PASS

**Step 2: Run production build**

Run: `cd frontend && npm run build`
Expected: PASS and generate `frontend/dist`

**Step 3: Sync Capacitor assets**

Run: `cd frontend && npx cap sync ios`
Expected: PASS and copy the built web assets into the iOS project.

**Step 4: Document the usage**

Document the iPad PWA install flow and the Xcode/TestFlight build steps in `README.md`.

**Step 5: Commit**

```bash
git add README.md frontend/dist
git commit -m "docs: document ipad and ios app workflow"
```
