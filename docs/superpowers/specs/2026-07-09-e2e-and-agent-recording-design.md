# E2E smoke suite + agent-driven recording (dashboard-visible, profile-aware, video)

**Date:** 2026-07-09
**Status:** approved, ready to build

Two related deliverables that make the control center trustworthy and unify the
two recording paths.

## Part A — Browser e2e smoke suite

**Why.** The unit suite (532 tests) mocks the browser, so the recent live bugs
lived where it can't see: rendered UI (blank steps, disabled-Record-looked-
clickable, "opening…" stuck) and real browser lifecycle (profile lock). Add a
suite that boots a REAL dashboard and drives a REAL headless browser.

**Target.** saucedemo only — hermetic, no auth, deterministic (green every run).
The real product (the analytics SPA, behind Cloudflare+2FA) is validated separately as a
one-time manual run under a logged-in profile, NOT in the automated suite.

**Shape.** `tests/e2e/` as a separate vitest project, opt-in via
`npm run test:e2e` (keeps the fast unit suite pure). Each test:
- boots `startDashboard` on an ephemeral port with real deps;
- drives the DASHBOARD PAGE itself in a headless browser (via PlaywrightAdapter
  → `open(http://127.0.0.1:<port>/)`, `evalJs` to read/click DOM) — asserting on
  rendered UI, not just JSON;
- reaps browser sessions in `afterEach`.

**Assertions (the classes of bug that slipped through):**
1. Dashboard UI: Sessions tab renders; Open button `disabled` when a window is
   live; Record button `disabled` + visibly greyed when no window; a recorded
   action makes a step row appear in the list without reload.
2. Record flow: open (headless) → window registers → scripted click → step in
   `/api/recordings/:id/steps` → stop → session inactive + a `take-*.webm` exists.
3. Profile reuse: open under profile `e2e`, set a cookie, close; reopen a
   DIFFERENT session under `e2e` → cookie present.
4. Profile-lock recovery: orphan holds the profile → reopen succeeds (prepProfile).

**Guardrails.** Headless only (the sanctioned exception to the no-headed rule);
serial where possible (driving the dashboard page = a 2nd headless browser
briefly); reap after every test. Runtime target < ~90s; run before merges / on
demand, not on every unit change.

## Part B — Agent-driven recording: dashboard-visible, profile-aware, video

**Why.** The `use` primitives (`navigate`/`click`/`type`) already record
ActionEffects into the SAME store + pipeline (`draftFromEffects` → `walk`) as the
human recorder. Three small gaps stop an agent session from being a first-class,
dashboard-visible, profile-backed session with video.

**Changes to `use navigate` (src/cli.ts):**
1. **Named profiles:** resolve a bare `--profile <name>` → `~/.webnav/profiles/<name>`
   (reuse `resolveProfile`) and `prepProfile` it before launch — so an agent runs
   under the shared login (`webnav use navigate <url> --session S --profile default`).
2. **Session metadata:** `recordStore.setProfile` + `setStartUrl` on first
   navigate, so the session shows its site + 🔐 profile badge in the dashboard,
   identical to a human session.
3. **Auto-record + video:** if the session isn't active, `record-start` it; and
   start/stop VIDEO per the record span via a lifted `videoSync` helper (extracted
   from the dashboard closure into a reusable module) — so agent sessions produce
   the same `take-<ts>.webm` artifact (video is a required downstream artifact).

**Model (settled rule).** The subagent that DRIVES webnav in the agent-recording
test/flow runs on the cheap model (Sonnet/Haiku) — the cost thesis dogfood.

**Result.** `record-start → use navigate/click/type (--profile default) →
record-stop` yields a Sessions-list row indistinguishable from a human recording:
steps, video, profile badge, review, walkable draft.

**Unchanged.** The pipeline, the store schema, the human recorder. Agent + human
sessions become the same kind of row.

## Components touched

- `src/playwright/video.ts` (new) — `videoSync(adapter, session, recording, dirs, log)`
  lifted from the dashboard closure; used by BOTH the human loop and `use navigate`.
- `src/cli.ts` — `use navigate`: profile-name resolve + prepProfile, setProfile/
  setStartUrl, auto record-start, video start/stop via the lifted helper. Dashboard
  `videoSync` closure re-pointed at the shared helper.
- `tests/e2e/*` (new) — the smoke suite; `package.json` `test:e2e` script +
  a separate vitest config so it's opt-in.

## Testing

- Part A IS tests. Part B's non-UI logic (profile resolve on `use navigate`,
  metadata recording, video-span) gets unit coverage; the full agent→dashboard
  path is one e2e test in Part A's suite.

## Out of scope

- the analytics SPA (or any auth-walled site) in the automated suite — needs a live login.
- Review frame-audit for agent sessions beyond what already works (it's video +
  steps; both now present, so review works unchanged).
- Concurrent windows (still one at a time).
