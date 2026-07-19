# Extension hardening — fix the design review (2026-07-19)

> Executes the CONFIRMED findings in `docs/superpowers/specs/2026-07-19-extension-design-review.md`
> via subagent-driven-development. Branch: `feat/extension-phase2-agent-sidebar` (continues it).
> The UI redesign is a SEPARATE track (a design workflow → its own re-skin task); this plan is the
> backend/correctness fixes. Both land on the same branch.

## Context

The whole-branch design review CONFIRMED 16 findings. This plan fixes the criticals + the
important/minor engineering ones. The UI/UX findings (empty-state, activity status, orphaned popup)
are folded into the separate UI re-skin task once the design spec lands. Every fix keeps the engine
zero-LLM and `walkRoute` unmodified.

## Verified seams (from exploration — do not re-derive)
- **Server routes + CORS + channel:** `src/agent/server.ts` — `createServer` sets `Access-Control-Allow-Origin:*`
  (line ~73); `makeChannel()` (~line 60) returns only `{getAX, dispatch}` (NO goto/currentUrl); routes:
  `/api/agent/{events,goal,command-result,stop,ingest-ax}`.
- **Channel contract:** `src/router/live-extension-browser.ts` — `AgentChannel {getAX; dispatch; currentUrl?; goto?}`;
  `makeLiveExtensionBrowser` already wires `browser.goto` IFF `channel.goto` exists (line ~109). So wiring
  `goto` is purely additive on the server + extension side.
- **Mode/gating:** `src/agent/loop.ts` — `defaultQuery` (line ~161) ignores `mode`, hardcodes
  `permissionMode:'default'`; `mode` used only for the `if (mode==='ask')` plan emit (~211). `abortFromSignal`
  exists (~174) but `cli.ts` onGoal passes no signal.
- **Extension driving:** `webnav-extension/background.ts` — `attachDrive` (~51), `nodeCenter` (~81, the
  stale-nodeId path ~86), `exec-command`/`get-ax` handlers (~228); `chrome.tabs` only used for `.get`/`.onRemoved`.
- **Panel run-start:** `webnav-extension/sidepanel.ts` — `resolveTab`/`targetTabUrl`/`drivableReason` (~67-84),
  `startRun` (~236), the `undrivable` refusal (~241), the plan Approve that doesn't gate (~200).

## Global constraints
- Zero LLM in the engine (#5a); map stores structure not values; commits never auto-fired.
- 2-space, single quotes; ESM `.js` imports; TDD for src/ (repo `npm test` green); extension = `tsc` clean + user-gated.
- Commit per task, author dikshant.y. Reuse existing helpers; no new deps.

---

### Task H1 — goto + "open a drivable tab" (crit #5 + the user's "must be on a webpage" complaint)
**Why:** the agent can't navigate (`channel.goto` unwired) AND launching from a chrome://-/blank tab
just refuses. Fix both: wire `goto`/`currentUrl` through the channel, and on run-start, if the current
tab isn't drivable, OPEN a new tab (or navigate a blank one) and drive that — like Claude's extension.
**Files:** `src/agent/server.ts` (channel), `webnav-extension/background.ts` (goto + tab-create handlers),
`webnav-extension/sidepanel.ts` (run-start: open-tab-if-undrivable instead of refuse),
`tests/agent/server.test.ts`.
**Steps:**
- [ ] `server.ts makeChannel()`: add `goto(url)` → `dispatchCommand({kind:'goto', url})` and
      `currentUrl()` → `dispatchCommand({kind:'current-url'})`. Extend `AgentCommand` in server.ts with
      `{kind:'goto'; url}` and `{kind:'current-url'}`. (live-extension-browser already consumes
      `channel.goto`/`currentUrl` — grep-confirm, no change needed there beyond the AgentChannel type
      already having them optional.)
- [ ] `background.ts`: handle `goto` (chrome.tabs.update the driven tab to the url, wait for load via
      `chrome.tabs.onUpdated` complete, then it's snapshot-able) and `current-url` (chrome.tabs.get → url).
- [ ] `sidepanel.ts` run-start: replace the hard `drivableReason` refusal — if the active tab is NOT
      drivable (chrome://, blank, extension page), `chrome.tabs.create({url: <start>, active:true})` a fresh
      tab and drive THAT (targetTabId = new tab). Choose the start url: the goal may imply one, but for v1
      open a neutral start (about:blank is NOT drivable either — use a real page; simplest: create the tab
      and let the agent `goto` where it needs, OR create at a sensible default). Keep drivableReason only as
      the check that decides "need a new tab", not a dead-end. So: launching from ANY tab works.
- [ ] `tests/agent/server.test.ts`: assert `channel.goto('https://x')` dispatches `{kind:'goto', url}` and
      resolves on command-result; `currentUrl()` round-trips. `npm test` + tsc green (repo) + tsc (extension).
- [ ] Commit `feat(extension): wire goto/currentUrl + open a drivable tab from anywhere (crit #5 + launch-anywhere)`.

### Task H2 — authenticate the localhost channel (crit #1 + #2 blast radius)
**Why:** `agent-serve` is CORS `*` + no auth; a webpage or local process can POST /api/agent/goal and
drive the browser over CDP. Close it.
**Files:** `src/agent/server.ts`, `src/cli.ts` (agent-serve wiring), `webnav-extension/sidepanel.ts`
(send the token), `tests/agent/server.test.ts`.
**Steps:**
- [ ] Server: generate a random token at boot (crypto.randomUUID or randomBytes hex). DROP
      `Access-Control-Allow-Origin:*` (an extension page is not a web origin needing CORS; the SSE +
      POSTs come from the extension, which isn't subject to page CORS the same way — verify: extension
      fetch to localhost works without CORS `*`; if the SSE/EventSource needs an origin allowance, allow
      ONLY the chrome-extension origin, not `*`). Require the token on every /api/agent/* route (header
      `x-webnav-token` or a `?token=` on the SSE URL since EventSource can't set headers — use a query
      param for /events, a header for POSTs). Reject missing/wrong token with 401.
- [ ] `cli.ts`: print the token in the `agent-serve` startup line so the user can paste it into the panel
      settings (OR: write it to a well-known localhost-only file the extension can't read — extension CAN'T
      read files, so PRINT it and have the user paste once, persisted in chrome.storage). Simplest secure v1:
      print token; user pastes into a Settings field; panel sends it. Document in --help + README.
- [ ] `sidepanel.ts`: a Settings token field (persisted in chrome.storage), appended as `?token=` on the
      EventSource URL and `x-webnav-token` on every POST. Clear "disconnected — check token / start server"
      messaging.
- [ ] Tests: a request without the token → 401; with the token → works. `npm test` + tsc green both dirs.
- [ ] Commit `fix(agent): authenticate the localhost agent channel + drop CORS * (crit #1)`.
> DECISION for the controller: paste-a-token is the lazy-secure v1. If it's too clunky UX, a follow-up
> can do an auto-handshake, but do NOT ship an open channel.

### Task H3 — make permission modes + plan-approval actually gate (crit #3 + #4)
**Why:** Ask/Auto/Act change nothing; the Ask plan-Approve doesn't block (run already executing).
**Files:** `src/agent/loop.ts`, `src/agent/server.ts` (approval round-trip), `webnav-extension/sidepanel.ts`
(Approve/Deny actually sends), `tests/agent/loop.test.ts`.
**Steps:**
- [ ] Gating model (keep it honest + simple): the gate lives at the CHANNEL dispatch boundary (every
      click/type/goto). Add a `mode` to the channel/loop such that:
      - `act` (Act): dispatch immediately (commits still protected by walkRoute — unchanged).
      - `auto` (Auto): dispatch immediately for reads/clicks/types; there is no separate commit here since
        commits never auto-fire anyway — so Auto == Act for now BUT self-checks. Given walkRoute already
        guards commits, the honest distinction: Act = no confirms; Auto = confirm only destructive-looking
        (defer if no signal exists) ; Ask = confirm EVERY navigate/click.
      - `ask` (Ask): before the FIRST action executes, emit the plan and WAIT for an approve. The loop must
        not dispatch until an approval arrives. Implement: server holds a `resolveApproval` promise; a new
        `POST /api/agent/approve {approved:bool}` resolves it; the loop `await`s it before the first tool
        that drives. Deny → abort the run (reject pending + stop).
      - If full per-action gating is too big for one task, MINIMUM viable: Ask genuinely blocks the whole run
        until Approve (not per-action); Auto/Act run freely. Document the reduction honestly; do NOT leave
        it cosmetic.
- [ ] `loop.ts`: thread mode into the tool dispatch; in ask mode `await approvalGate` before the first
      driving tool call. Remove the misleading comment that says mode is "for later".
- [ ] `server.ts`: `POST /api/agent/approve`; wire the approval promise into onGoal/channel.
- [ ] `sidepanel.ts`: Approve → POST approve{true}; Deny → POST approve{false} (aborts). The plan bar now
      truly gates.
- [ ] `tests/agent/loop.test.ts`: ask mode does NOT dispatch a driving tool until approval; act mode does
      immediately; deny aborts. `npm test` + tsc green.
- [ ] Commit `fix(agent): permission modes + plan approval actually gate execution (crit #3/#4)`.

### Task H4 — fix the stale-nodeId path + wire Stop→abort (crit #6 + minor)
**Files:** `webnav-extension/background.ts` (nodeCenter), `src/cli.ts` (pass a signal to runAgentGoal so
Stop cancels the SDK turn), `src/agent/server.ts` (per-goal AbortController), `tests` as applicable.
**Steps:**
- [ ] `background.ts nodeCenter`: on a stale/absent nodeId in the cached tree, do NOT re-fetch-and-refind
      the old id (it's gone). Instead return a clear `{ok:false, error:'stale-node'}` so the panel POSTs an
      error result → the server loop's tool gets the error → the AGENT re-snapshots (get_page_ax) and
      re-resolves by fingerprint (the loop already does this). Fix the false "recovers" comment.
- [ ] Wire Stop→abort: `server.ts` create an AbortController per goal, expose it to `/api/agent/stop`
      (abort it) AND pass its signal into `onGoal`→`runAgentGoal({signal})` so the SDK query is actually
      cancelled (loop.ts already bridges signal→abortController). `cli.ts onGoal` threads the signal.
- [ ] Tests where unit-testable (server stop aborts; loop passes signal). `npm test` + tsc green.
- [ ] Commit `fix: stale-node returns honest error (agent re-resolves) + Stop aborts the SDK turn`.

### Task H5 — cleanup: orphaned popup, tab-group leak, single-panel, double-narration, contract drift
**Files:** `webnav-extension/manifest.json` + `popup.*` + `README.md`; `webnav-extension/sidepanel.ts`
(ungroup on finish); `src/agent/server.ts` (single-panel guard); `src/agent/loop.ts` OR `sidepanel.ts`
(drop the duplicate narration); a shared contract note.
**Steps:**
- [ ] Popup: it's orphaned (icon opens the panel). DECISION: fold "capture this page" into the panel as a
      small action, OR delete popup.html/ts + its README lines. Prefer FOLD (capture is a real feature) —
      add a small "capture page" affordance in the panel; else delete cleanly. Fix the README Phase-1 steps.
- [ ] Tab-group: ungroup / relabel-to-done cleanly on finishRun so tabs don't accumulate in a 'webnav'
      group and the user's own grouping isn't destroyed (chrome.tabs.ungroup on finish, or only group if the
      tab wasn't already grouped).
- [ ] Single-panel: `server.ts` — when a new SSE client connects, either close the prior emitter or key
      pending/commands so two panels don't both execute every action. Minimum: last-connection-wins (close
      the previous emitter on a new /events connection).
- [ ] Double narration: the panel renders BOTH the channel `action` line and the loop `narrate` line for
      the same call. Keep ONE (prefer the human `narrate`; the `action` is for execution, not display) —
      make execAction NOT also render a bubble, OR make narrate the only rendered line.
- [ ] Contract drift: `Cmd`/`AgentEvent` are hand-copied in sidepanel.ts. Add a comment cross-linking to
      server.ts as the source of truth + a `// KEEP IN SYNC` marker, OR (better) a tiny shared `.d.ts` the
      extension tsconfig includes. Lazy-correct: the KEEP-IN-SYNC marker + a test in the repo asserting the
      two unions match if feasible.
- [ ] tsc clean both dirs; `npm test` green. Commit `chore(extension): fold/remove popup, ungroup tabs, single-panel guard, dedupe narration, contract sync`.

### Task H6 — UI re-skin (BLOCKED on the design workflow spec)
**Files:** `webnav-extension/sidepanel.html` (+ `sidepanel.ts` for any new hooks/status).
**Steps:**
- [ ] Implement the winning design spec from the UI-design workflow VERBATIM: full re-skin of
      sidepanel.html (tokens, both themes, header w/ connection + driven-tab, thread treatments, activity
      indicator, mode control, plan-approve surface, composer, first-run empty state, settings).
- [ ] Keep the element IDs the JS uses (thread/goal/mode/send/stop/pause/conn/sid/base) or update
      sidepanel.ts for any renamed/added hooks. Wire the new activity/status + empty-state.
- [ ] tsc clean; accessible focus; reduced-motion. Commit `feat(extension): impeccable sidebar redesign (design-off winner)`.
- [ ] HAND OFF for the load-unpacked visual check (both themes).

## Verification
- Per task: `npm test` + `npx tsc --noEmit` (repo) green; `cd webnav-extension && npm run build` clean.
- Final whole-branch review of the hardening diff.
- User-gated E2E (unchanged): build ext → `webnav agent-serve` (now prints a token) → load unpacked →
  open panel from ANY tab (incl. a blank/new tab — it opens a drivable one) → paste token → goal on a
  real page → watch it drive, Ask-mode plan actually gates, Stop actually stops.
