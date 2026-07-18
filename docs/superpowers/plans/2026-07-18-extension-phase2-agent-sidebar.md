# Extension Phase 2 — interactive agent sidebar (implementation plan)

> Executes `docs/superpowers/specs/2026-07-18-extension-phase2-design.md` (increments 1–4)
> via superpowers:subagent-driven-development. Branch: `feat/extension-phase2-agent-sidebar`.
> Spike (increment 0) already PASSED — agent loop = in-process `@anthropic-ai/claude-agent-sdk`.

## Context

We are building a better Claude-Chrome-extension: `webnav`. A docked Chrome sidePanel chat
where the user types a goal, watches Claude stream its reply + a live narration of what it's
doing, and watches it drive the live tab (click/type). webnav's differentiators over the
Claude extension: (a) every run RECORDS into the map; (b) the SECOND run of the same goal is
fast deterministic replay (recall-don't-re-explore); (c) scoped to its own tab group;
(d) take-over/hand-back. Record is one mode; the agent loop is the product.

The engine stays zero-LLM (#5a): the Claude Agent SDK (in the local Node process) is the brain;
webnav's map/graph/walk are judgment-free. The extension is a CONSUMER of webnav.

### Feature bar — match Claude-for-Chrome, then beat it (researched 2026-07-18)

Claude for Chrome (the product we build on top of) ships, verified from its docs + reverse-engineered
internals (sources in the session): (1) a docked side-panel chat; (2) **three permission modes** —
*Ask Before Acting* (default: agent proposes a PLAN first via an `update_plan`-style step, you approve
it, then it runs within those bounds and only re-prompts on high-risk actions like purchases/data-share),
*Auto* (agent works, self-checks each action for safety, pauses only when needed), *Act Without Asking*
(no prompts); (3) **handoff = a "Stop Claude" button** that halts the loop (pending tool calls get error
results) — there is NO polished pause/resume; (4) **no literal cursor dot** — it hides its own overlay
during an action and shows agent state via **tab-group visuals: animated loading dots while working, a
checkmark when done**; (5) tab-group scoping with tab context injected as a system-reminder.

webnav MATCHES all of the above and BEATS it with: recording every run into the map; **run-2 = fast
deterministic replay** (recall, which the Claude extension cannot do); an **on-page highlight pulse**
painted from the same box-model used to click (a better where-is-the-agent affordance than hiding an
overlay); and a real **Pause → drive by hand (still recorded) → Resume** handoff (beyond their Stop).
The permission modes map onto webnav's EXISTING machinery: the `commit`/`needs-classification` gate IS
the "pause on high-risk" primitive; *Ask* mode = surface the plan + gate every navigate; *Auto* = gate
only `commit` edges; *Act Without Asking* = gate nothing but commits (commits are NEVER auto-fired, #2 —
that's a hard floor below even Claude's "skip all").

## Verified interfaces (from exploration — DO NOT re-derive)

- **`WalkBrowser`** `src/router/walk.ts:84-119`: required `snapshot():Promise<string>`,
  `act(ref, inputSlot):Promise<void>`, `callCount():number`; optional `goto(url,inputSlot)`,
  `waitMs(ms)`, `currentUrl()`, `reopenFresh(url)`, `close()`, `sessionId()`.
  (Brief in the design said `sleep`/optional `callCount` — WRONG; it's `waitMs`, and `callCount` is required.)
- **`snapshot()` returns a YAML STRING** the walk re-parses with `parseSnapshot` (`src/playwright/snapshot.ts:25`).
  `adaptAXTree` (`src/playwright/ax-adapter.ts:45`) emits `SnapNode{role,name,ref,url,raw,depth}` with
  `.raw` in playwright's exact line format → `nodes.map(n=>' '.repeat(n.depth)+n.raw).join('\n')`
  round-trips through `parseSnapshot`. Append `/url:` lines where url matters.
- **A `ref` is an opaque a11y-node id, not a coordinate.** `adaptAXTree` emits `bN` refs but THROWS
  AWAY `AXNode.nodeId`. To click via CDP: retain `bN → nodeId`, then
  `Accessibility.getFullAXTree` node → `DOM.pushNodesByBackendIdsToFrontend`/`DOM.resolveNode` +
  `DOM.getBoxModel` → center coord → `Input.dispatchMouseEvent`. Fills: focus textbox node +
  `Input.insertText`.
- **`makeLiveWalkBrowser`** `src/router/walk-live.ts:92-154` is the adapter to MIRROR (its `act`
  handles `credentials`/`shipping` input slots via `fieldRef`).
- **`findPath(store,startId,goalId):string[]|null`** `src/router/path.ts:16` — zero-LLM Dijkstra;
  IS `check_route`. Needs a start-state id; there is NO url→state resolver — resolve "where am I"
  via `matchState(nodes, states)` against the live snapshot.
- **`RecordStore`** `src/mapstore/record.ts:60` (`new RecordStore(dbPath())`); `ingestAX(body,store)`
  `src/recorder/ingest.ts:80`; `serveIngest(port,store)` `:99` (already serves `/ingest` + `/ingest-ax`).
- **SSE hub** `src/dashboard/server.ts:259` pushes bare `data: <type>\n\n` — NO payload. Streaming
  Claude's reply text needs a NEW payload-carrying channel (a new server, not the ping hub).
- **`RecallResponse`** `src/protocol.ts:26-37`: done | needs-navigation | needs-classification |
  needs-auth | checkpoint | failed.

## Architecture (the whole shape)

```
  Chrome sidePanel (sidepanel.html/.ts)          Local Node process: `webnav agent-serve`
  ─────────────────────────────────────          ───────────────────────────────────────
  chat UI, EventSource(SSE) in  <──── SSE ─────   agent-loop.ts: Claude Agent SDK query()
  POST /api/agent/* out         ────────────>       tools: get_page_ax, click, type, goto,
       │                                                   check_route(goal) [=findPath]
       │ chrome.runtime.sendMessage                 LiveExtensionBrowser implements WalkBrowser
       ▼                                            (drives via the extension over the channel)
  background.ts (service worker)                    every act() -> ingestAX (recording, free)
  ONE chrome.debugger attach, two jobs:             recall-first: check_route hit -> walkRoute
   - Accessibility.getFullAXTree (eyes)               (unmodified) with LiveExtensionBrowser
   - Input.dispatchMouseEvent   (hands)
```

Command flow: SDK tool → `LiveExtensionBrowser` method → server emits an `action{id,…}` SSE →
sidePanel forwards to background via `sendMessage` → background runs CDP → POSTs result to
`/api/agent/command-result{id,…}` → server resolves the id-keyed promise → tool returns.
Bounded 30s timeout on each command promise → honest failure, never a hang.

## Global Constraints

- Zero LLM in webnav's engine (#5a). Map stores structure, never values (`tests/guidelines.test.ts`
  green). Never a wrong-resolve.
- Commit points never auto-fired: `LiveExtensionBrowser.act` checks the edge/affordance `commit`
  flag BEFORE dispatching; a commit surfaces as `needs-classification`, never a silent click.
- Secrets never captured (role/name/url structure only; password/cc VALUES never read).
- 2-space indent, single quotes; TDD; full `npm test` green per task; commit per task (author dikshant.y).
- The extension stays DUMB where it can: CDP mechanics live in background.ts; ALL agent reasoning
  is the SDK in the Node process. Reuse `ingestAX`/`RecordStore`/`findPath`/`walkRoute`/`adaptAXTree`
  — do not fork them.
- No new headed-window behavior in tests; extension pieces are user-gated (load-unpacked).

---

### Task 1: Retain nodeId in the AX adapter (unblocks CDP clicking)
**Files:** `src/playwright/ax-adapter.ts`, `tests/playwright/ax-adapter.test.ts`.
**Why:** clicking a `bN` ref via CDP needs the backing `AXNode.nodeId`/`backendDOMNodeId`; the
adapter currently discards it.
**Steps:**
- [ ] Add an optional side output: `adaptAXTree` also returns (or accepts an out-param Map) a
      `Map<string /*bN ref*/, {nodeId:string; backendDOMNodeId?:number}>`. Keep the `SnapNode[]`
      return shape unchanged (SnapNode gains NO field — the map is separate) so no downstream consumer changes.
- [ ] TDD: from a committed raw-AX fixture, assert every kept node's `bN` ref maps to the correct
      `backendDOMNodeId` from the source AXNode; dropped nodes are absent from the map.
- [ ] `npm test` green. Commit.

### Task 2: `LiveExtensionBrowser implements WalkBrowser` (server side, no browser yet)
**Files:** `src/router/live-extension-browser.ts`, `tests/router/live-extension-browser.test.ts`.
**Interfaces:** `makeLiveExtensionBrowser(channel: AgentChannel, inputs): WalkBrowser` where
`AgentChannel` is a thin injectable `{ getAX():Promise<AXNode[]>; dispatch(cmd):Promise<Result> }`
(the real one talks to the extension; tests inject a fake).
**Steps:**
- [ ] `snapshot()`: `channel.getAX()` → `adaptAXTree` → serialize `SnapNode[]` back to the
      parseSnapshot-compatible YAML string (`raw` join + `/url:` lines). Cache `lastSnapshot` +
      the ref→nodeId map (mirror `makeLiveWalkBrowser`'s `lastSnapshot` closure).
- [ ] `act(ref, inputSlot)`: look up ref→nodeId in the cached map; emit a `click`/`type` command via
      `channel.dispatch`. Mirror `makeLiveWalkBrowser`'s input-slot handling (`credentials`/`shipping`
      → resolve field nodes by role+name, fill, then click). **Commit-gate:** the caller passes the
      edge; if `commit` is set, throw a sentinel the loop turns into needs-classification (never dispatch).
- [ ] `callCount()`, `currentUrl()`, `goto()`, `waitMs()`, `close()` mirroring the live adapter.
- [ ] TDD against a fake channel: snapshot round-trips through `parseSnapshot`; `act` dispatches the
      right command with the resolved nodeId; commit edge never dispatches.
- [ ] `npm test` green. Commit.

### Task 3: `webnav agent-serve` — the local agent server (channel + SSE + routes)
**Files:** `src/agent/server.ts`, `src/agent/channel.ts`, `tests/agent/server.test.ts`, `src/cli.ts` (new verb).
**Why:** the payload-carrying channel the extension talks to (the ping-only SSE hub can't carry it).
**Steps:**
- [ ] `http.Server` on `--port` (default 7779, distinct from ingest 7778) with routes:
      `GET /api/agent/events` (SSE, payload JSON: `{type:'turn'|'action'|'done'|'error', …}`),
      `POST /api/agent/goal {goal, sessionId, mode}` (starts a run; `mode` = the permission mode
      Ask|Auto|Act from Task 5's selector — supersedes the earlier `tabHint` placeholder),
      `POST /api/agent/command-result {id, result}` (resolves a pending command),
      `POST /ingest-ax` (reuse `ingestAX` so recording lands — mount the existing handler).
- [ ] `AgentChannel` impl: `dispatch(cmd)` assigns an id, emits an `action` SSE, returns a promise
      resolved by `/api/agent/command-result` (30s timeout → reject). `getAX()` likewise (a
      `get-ax` command the extension answers).
- [ ] TDD (no browser): drive the server with an in-process fake extension (a test client that
      answers command SSEs) → assert the id-keyed promise resolves, timeout rejects, ingestAX writes.
- [ ] Wire `webnav agent-serve` into cli-spec (so MCP + --help pick it up). `npm test` green. Commit.

### Task 4: The agent loop — Claude Agent SDK with webnav tools
**Files:** `src/agent/loop.ts`, `tests/agent/loop.test.ts`.
**Interfaces:** `runAgentGoal({goal, sessionId, browser: WalkBrowser, store, states, emit})`.
**Steps:**
- [ ] Build the SDK tools (verified wiring from the spike, `@anthropic-ai/claude-agent-sdk@0.3.x`):
      `createSdkMcpServer({name:'webnav', tools:[…]})` → `query({prompt, options:{mcpServers, allowedTools}})`.
      Tools: `get_page_ax`=`browser.snapshot()`; `click(ref)`/`type(ref,text)`=`browser.act`;
      `goto(url)`=`browser.goto`; `check_route(goalStateId)`=`findPath(store,start,goal)` (resolve
      `start` via `matchState` on the current snapshot; zero-LLM).
- [ ] Stream: forward SDK `assistant` text + tool-use as `turn`/`action` events through `emit`
      (→ SSE). On `check_route` HIT, call `walkRoute({…, browser})` UNMODIFIED and narrate its
      terminal `RecallResponse` as tool result. Every `act` already POSTs ingestAX via the channel
      (recording is a free side effect).
- [ ] TDD: inject a fake `query` (module-seam) + fake browser → assert tool calls route to browser
      methods, check_route hit path calls walkRoute, events emit in order. (The SDK itself is NOT
      exercised in unit tests — that's the user-gated E2E.)
- [ ] `npm test` green. Commit.
> DECISION (deferred, non-blocking): keeping this loop as `claude -p` fallback is unused per the
> spike; do NOT build the fallback unless the SDK path fails the E2E.

### Task 5: sidePanel UI + manifest (extension, BUILD only — user-gated verify)
**Files:** `webnav-extension/manifest.json` (+`sidePanel` perm, `side_panel` key, `commands`),
`webnav-extension/sidepanel.html`, `webnav-extension/sidepanel.ts`, `webnav-extension/background.ts`
(persistent-attach + Input.dispatch + get-ax handlers), `webnav-extension/README.md`.
**Steps:**
- [ ] manifest: add `"sidePanel"` to permissions, `"side_panel":{"default_path":"sidepanel.html"}`,
      a `"commands"` entry (Cmd+E) whose `onCommand` in background.js calls `chrome.sidePanel.open`.
- [ ] `sidepanel.html/.ts`: chat thread + goal input; `EventSource('http://127.0.0.1:7779/api/agent/events')`
      (in the PANEL, not the SW — SW idles); render `turn` deltas (Claude's reply) + `action`
      narration lines; POST goal to `/api/agent/goal`. Lift popup.html CSS. Session name + server
      base inputs (reuse popup pattern, `chrome.storage`).
- [ ] **Permission-mode selector** (the Claude-extension parity feature): a control at the bottom of
      the prompt box cycling *Ask* / *Auto* / *Act Without Asking*, persisted in `chrome.storage`,
      sent on the `/api/agent/goal` body. In *Ask* mode the first `turn` event carries a PLAN the
      panel renders with an Approve/Deny bar before any action runs (server holds until approval POST).
      Server maps the mode to the gate level (Ask=gate every navigate; Auto=gate commits only; Act=gate
      commits only — commits ALWAYS gate, #2). Wire the mode through to `runAgentGoal`.
- [ ] **Stop button** (baseline handoff, matches Claude's real mechanism): POST `/api/agent/stop` →
      server aborts the SDK `query` (AbortController) and rejects pending command promises.
- [ ] `background.ts`: restructure to a PERSISTENT debugger session (attach once on session start,
      NO per-command `finally` detach; detach on panel close / tab close / `onDetach`). Add handlers
      for `get-ax` (getFullAXTree) and `dispatch` (`Input.dispatchMouseEvent`/`insertText` via the
      ref→nodeId→boxmodel resolve). Keep the Phase-1 `capture` message working.
- [ ] `chrome.tabGroups`: group+label the agent's tab on session start (differentiator scope) +
      **tab-group visual state** (parity): animated loading dots on the group while a run is active,
      checkmark on `done` — driven by the `action`/`done` SSE events.
- [ ] `tsc` clean (flat `*.ts` glob auto-compiles). README: load-unpacked + `webnav agent-serve` + try-a-goal.
- [ ] Commit. HAND OFF to user for the load-unpacked E2E — do NOT claim end-to-end done.

### Task 6: On-page highlight + take-over/hand-back (increments 2–3, extension polish)
**Files:** `webnav-extension/background.ts`, `webnav-extension/sidepanel.ts`.
**Steps:**
- [ ] Highlight: from the SAME `DOM.getBoxModel` used to dispatch a click, paint a transient pulse
      (`Overlay.highlightRect` or an injected div) — zero extra round-trip.
- [ ] Take-over: a Pause button stops the loop (POST `/api/agent/pause`); user drives by hand
      (still captured via the capture path); Resume re-snapshots and continues.
- [ ] `tsc` clean. Commit. User-gated verify (folded into Task 5's E2E).

---

## Verification

- **Per task (headless, I run):** `npm test` green after each; `tsc` clean. Tasks 1–4 are fully
  unit-testable server-side with fakes (no browser, no SDK network call).
- **End-to-end (user-gated, hand off):** `cd webnav-extension && npm run build`;
  `webnav agent-serve --port 7779` (in the repo); load-unpacked; open the sidePanel; type a goal on
  saucedemo → watch streamed reply + live clicking → `webnav dev graph-analyse <session> --draft`
  shows a sane draft (recording worked). Run the SAME goal twice → run 2 hits `check_route` and
  replays fast (the recall payoff). This is the experiment that closes the thesis.
- **The one thing only the user can do:** the load-unpacked run (their Chrome window + Keychain
  Claude Code login). Everything up to that line is verified headlessly.
