# Interactive long-lived agent session (`webnav use session`)

**Date:** 2026-07-09
**Status:** approved, ready to build

## Why

Agent-driven recording currently spawns one CLI process **per action**
(`use navigate`, `use click`, …). The browser daemon survives between them, but:
- **Video can't record** — playwright-cli video is bound to one process; start in
  process A, stop in process D → "No videos were recorded" (proven).
- Every leak/hygiene bug this session (orphan Chromes, profile-lock collisions,
  session-ceiling pileup, reap gaps) traces to spawn-per-action-then-leak.
- Each action pays ~300-500ms process spawn + daemon reattach.

A **single long-lived process** that owns the browser start-to-finish fixes all
of it — video works for free, nothing leaks (one process, closes on exit), and
it's how every real automation tool (Playwright/Puppeteer/Selenium) works.

## What

A new verb **`webnav use session`** — a long-lived process that:
1. opens the browser (headless/headed, optional `--profile <name>`), starts a
   record session + **video**, runs the live-record poll loop;
2. reads **JSON-lines commands on stdin**, executes each against the SAME open
   browser, writes **one JSON result line on stdout** per command;
3. on `{"cmd":"quit"}` or EOF: stops video (saves the take), stops recording,
   closes the browser cleanly, exits.

The agent spawns it ONCE and pipes commands. The existing one-shot `use` verbs
stay untouched for stateless uses (`read`, one-off `snapshot`, MCP tools).

### Command protocol (JSON lines)

Request (one per line): `{"cmd": "<verb>", ...args}`. Response (one per line):
`{"ok": true, ...result}` or `{"ok": false, "error": "..."}`.

Supported cmds (map to existing adapter methods):
- `{"cmd":"navigate","url":"..."}` → `{ok,url}`
- `{"cmd":"snapshot"}` → `{ok,snapshot}` (the a11y tree the agent reasons on)
- `{"cmd":"click","ref":"e5"}` → `{ok}`
- `{"cmd":"type","ref":"e3","text":"..."}` → `{ok}`
- `{"cmd":"eval","js":"..."}` → `{ok,result}`
- `{"cmd":"quit"}` → `{ok,video,steps}` then exit

Each mutating cmd records an ActionEffect (same pipeline as human/one-shot), so
the session yields a normal dashboard-visible recording (steps + video + profile
+ walkable draft).

### Realtime dashboard (the user's explicit requirement)

The interactive session is a separate process from the dashboard, so it can't
call the dashboard's in-memory `emit`/`logBuf`. Bridge = ONE new endpoint:

- **`POST /api/notify`** on the dashboard: body `{kind?: 'step'|'sessions'|'log',
  line?: string}`. Appends `line` to the dashboard's `logBuf` (if given) and calls
  `emit(kind ?? 'sessions')`. Localhost-only, same posture as the existing toggle
  route (add to the recordings-route guard prefix).

The interactive session, after each recorded step/log, best-effort POSTs to
`http://127.0.0.1:<port>/api/notify` (port from `WEBNAV_DASHBOARD_PORT` env,
default 7777; failure = silent, dashboard just refreshes on its own later). The
dashboard then pushes `step`/`log`/`sessions` over SSE exactly as it does for the
human recorder → the agent session appears live in Sessions, steps + logs stream
in real time.

## Components

- `src/recorder/agent-session.ts` (new) — the stdin/stdout loop: a pure-ish
  `runAgentSession({adapter, store, notify, readLine, write, ...})` so it's
  unit-testable with a scripted stdin + fake adapter. Owns: video start, per-cmd
  dispatch → adapter + record, notify after each, teardown on quit/EOF.
- `src/cli.ts` — `use session` parse + handler: build adapter (profile resolve +
  prepProfile, video), wire `notify` to POST the dashboard, run the loop, close
  on exit (reuses `record-live`'s open/close discipline).
- `src/dashboard/server.ts` — `POST /api/notify` route + `notify(kind,line)` dep.
- `src/cli.ts` dashboard deps — `notify` appends to logBuf + emits.
- `src/cli-spec.ts` — register `session` verb (help/discoverability).

## Testing

- Unit: `runAgentSession` with scripted JSON-line stdin + fake adapter/store —
  asserts each cmd dispatches, records the right ActionEffect, notify fires, quit
  tears down (video stop called before close). Pure, no browser.
- Unit: `/api/notify` route appends log + emits (server.test fake).
- E2E (saucedemo, headless, in the opt-in suite): spawn `use session`, pipe
  navigate+snapshot+click+quit, assert steps in the API, a **video take exists**
  (the whole point), and record-stop/quit closed the browser (no leak). Plus:
  with a dashboard running, assert `/api/logs` and the session list update while
  the agent drives (realtime path).
- Live manual: run an agent (Haiku, per the cost rule) driving a real `use
  session` on saucedemo while watching the dashboard; confirm steps/logs stream.

## Guardrails / safety

- Headless for all automated tests; ONE window at a time; the process closes its
  own browser on exit → nothing to leak/reap.
- NEVER touches the user's real Chrome: only ever launches/kills processes whose
  command carries a webnav/playwright profile path (existing prepProfile /
  closeByName discipline, verified by process-path match).

## Out of scope

- Replacing the one-shot `use` verbs (they stay for stateless uses).
- Multi-window / concurrent sessions (still one at a time).
- The agent's own reasoning harness — this spec provides the CHANNEL; a driving
  agent (Haiku) is wired in the e2e/live test, not baked into the verb.
