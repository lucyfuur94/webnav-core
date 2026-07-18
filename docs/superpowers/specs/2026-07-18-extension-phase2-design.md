# Extension Phase 2 — interactive agent sidebar (2026-07-18)

> Design settled by a judge-panel workflow (3 proposals × distinct priorities, 2 judges,
> synthesis). Winner P3 ("cleanest fit + reuse"), grafts from P2 (parity mechanics) and P1
> (commit-gate placement, timeouts). Direction: `2026-07-18-in-browser-extension-direction.md`.
> Phase 1 (the camera) is done + merged. This is the Claude-extension-like product on top.
> NOT a build spec yet — the load-bearing assumption (SDK auth) must be spiked first.

## The product

The `webnav` extension becomes an interactive agent sidebar: a docked Chrome sidePanel chat where
the user types a goal, sees Claude's streamed replies + a live narration of what the agent is doing,
watches it drive the live page, and can take over / hand back — with webnav's MEMORY making the
second run fast. Record is ONE mode; the agent loop is the product.

## The winning architecture (P3 + grafts) — the key insight

`WalkBrowser` (`src/router/walk.ts:84`) is ALREADY a swappable 5-method interface (`snapshot`,
`act(ref, inputSlot)`, `goto`, `currentUrl`, `close`) — today it swaps live-playwright vs test
fakes. A new `LiveExtensionBrowser implements WalkBrowser` is a literal drop-in, so **`walkRoute`
runs UNMODIFIED against the live tab** — no new branch inside the engine, the producer swap is
entirely in calling code. That is the strongest possible reading of the zero-LLM-engine constraint.

### Resolved forks
| Fork | Decision |
|---|---|
| **Channel** | Reuse the two EXISTING localhost surfaces — no new WebSocket, no native-messaging host. Extension→process record: `POST /ingest-ax` (Phase 1, unchanged). Process→extension push: new SSE event types (`agent-turn`, `agent-action`) on the existing `subscribe()` hub in `dashboard/server.ts`. Command dispatch: SSE `agent-action{commandId}` → extension POSTs back to a new `/api/agent/command` route that resolves a commandId-keyed promise. |
| **Agent loop** | Claude **Agent SDK**, in-process in the local Node CLI (NOT `claude -p` shelling — this loop is live/bidirectional through a real browser, not review.ts's one-shot audit; typed `tool()` defs beat reparsing stdout). **GATE: spike SDK auth-via-subscription from a plain Node process BEFORE increment 1 is "done" — the one unverified assumption. If it fails, fall back to `claude -p` + MCP-stdio (webnav already has `webnav mcp`), which changes tool wiring but not the rest.** |
| **Tool→tab path** | 3 tools = the WalkBrowser methods: `get_page_ax`=snapshot(), `click(ref)`/`type(ref,text)`=act(), `goto(url)`=goto. The agent only ever talks to `LiveExtensionBrowser`, whose methods emit `agent-action` SSE + await the commandId POST-back. |
| **Driving** | `chrome.debugger` Input domain (`Input.dispatchMouseEvent`/`dispatchKeyEvent`), the SAME attach Phase 1 holds for getFullAXTree — ONE attach, two jobs (eyes+hands), do not double-attach. Trusted events required (content-script synthetic events silently no-op on isTrusted-checking sites — exactly the checkout pages we care about). |
| **Memory recall-first** | Mechanical, not LLM-discretionary. Agent gets a `check_route(goalStateId)` tool = a plain store lookup (zero LLM in webnav). Found → `walkRoute({..., browser: liveExtensionBrowser})` unmodified, narrated over the same SSE the dashboard replay view already emits; `needs-navigation`/`needs-classification` surface as normal tool results (#5a). Miss/drift → free-form tool loop, which is AUTOMATICALLY also a recording (every `act()` POSTs to `/ingest-ax`) feeding the same `graph-analyse --draft` pipeline — no separate record mode. |

### Grafts (both judges flagged)
- **P2:** on-page transient highlight/pulse painted from the SAME `DOM.getBoxModel` call used to dispatch input (zero extra round-trip) — the sharpest parity mechanic.
- **P2:** name the MV3 service-worker ~30s idle-suspension risk explicitly (can kill background mid-turn, dropping the channel) — test in increment 1, don't assume away.
- **P2:** `chrome.tabGroups` — group+label on session start, auto-add agent-opened tabs via `onCreated` (deferred increment).
- **P1:** commit-point gate — check `affordance.kind === 'commit'` BEFORE emitting the tool-call over the channel, return a `needs-classification`-shaped result to the agent, never reach the extension for a confirmation-free commit click.
- **P1:** bounded 30s timeout on the commandId promise → honest `needs-navigation`-shaped failure, never a hang.

## Ordered increments
0. **SPIKE (gate, do first):** Agent-SDK auth from a plain Node process using the user's Claude Code subscription. Pass → SDK loop. Fail → `claude -p` + MCP-stdio fallback. USER-GATED (needs their session).
1. **Dogfoodable core loop** (browser+extension-gated): sidePanel chat (plain HTML/TS) ↔ new server routes ↔ Agent SDK loop with 3 tools via `LiveExtensionBrowser` (SSE-push + commandId-POST-back) ↔ background.ts Input.dispatch handlers (same debugger attach). Every `act()` → `/ingest-ax` (recording is a free side effect). Bar: goal on saucedemo → streamed narration + live clicking → `dev graph-analyse --draft` gives a sane draft.
2. **Live narration + on-page highlight** (`agent-turn` deltas, `agent-action` narration, box-model highlight — P2 graft). Pure UI.
3. **Take-over / hand-back** (pause stops the loop, user drives free-hand still captured, resume with fresh AX).
4. **Recall-first memory** (`check_route` tool + swap LiveExtensionBrowser into walkRoute for the found case). Last on purpose — needs 1–3 to have populated a map. Bar: same goal twice → run 2 is fast deterministic replay.
5. **Polish (deferred):** `goto` addressable-URL tool, tabGroups parity chrome, multi-tab, commit-confirm UX.

## Open questions for the human to decide (carried from synthesis)
- **SDK-auth-from-Node is the one load-bearing unknown** — spike literally first (increment 0).
- **Box-model staleness:** get_page_ax then click aren't atomic (React re-render → stale box). Decide: always re-fetch box model before dispatch (safe, +1 CDP call) vs stale-detect heuristic.
- **MV3 worker death mid-turn:** decide the recovery contract now (reconnect-and-resume vs surface-as-failed-turn).
- **`check_route` match criterion:** must be more than domain/URL match (else false-positives walkRoute into the wrong state on a genuinely new page of an old site) — use URL-template/addressableUrl per the affordance model.
- **chrome.debugger single-attach:** fails if DevTools open / another debugger extension active; now held for the whole session — decide the user-facing error.

## Out of scope
Multi-agent, cloud/hosted, non-Claude-Code users (the API-broker path), headless autopilot.
