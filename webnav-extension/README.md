<!-- webnav-extension/README.md -->
# webnav agent extension (Chrome MV3)

Sensor: `chrome.debugger` → CDP `Accessibility.getFullAXTree` (real native accessibility
tree, same source real assistive tech and Chrome DevTools use). The extension stays
DUMB — it ships raw AX node arrays and dispatches raw CDP input; the webnav server
adapts/reasons over all of it (adaptAXTree, fingerprints, ranking, the agent loop
itself). Loading the extension shows Chrome's "webnav is debugging this browser"
banner — that's the `debugger` permission at work, expected and accepted (the only way
this extension can drive the page / read its accessibility tree).

## Build

```
cd webnav-extension && npm i && npm run build
```

## Current flow — agent side panel (drive a tab with a goal)

A docked side panel chat that streams Claude's replies + live narration and drives the
active tab over CDP, talking to `webnav dev agent-serve` (local, port 7779).

**UI — "navigation console" (design-off winner):** a cartographic instrument panel.
Claude's prose is humanist sans; the agent's actions read as a mono **route ledger**
traced down a rail of map-pin waypoints (verb in accent mono, object distinct; the live
step's pin pulses). A first-run empty state orients you (prereq strip flips green once the
server connects), the header shows a driven-tab chip + a connection lamp + a pulsing
map-pin while running, and a "tracing" activity strip surfaces above the composer during a
run. Permission mode is a segmented **Ask / Auto / Act** switch. Both light and dark
themes are designed with equal care (`prefers-color-scheme`), motion respects
`prefers-reduced-motion`, and the layout holds to ~320px.

The panel opens the SSE stream itself (the service worker idles and would drop it),
renders `turn` deltas into an assistant bubble + one human-readable `narrate` line per
tool call, and forwards each matching `action` command to `background.js` to execute
over ONE persistent `chrome.debugger` attach — get-ax (`getFullAXTree`), click (AX
nodeId → `backendDOMNodeId` → `DOM.getBoxModel` content-quad centre →
`Input.dispatchMouseEvent`), type (click to focus → `Input.insertText`), goto, and
current-url. The command result is POSTed back to `/api/agent/command-result`. Only the
most recently opened panel is ever driven — a second `/api/agent/events` connection
evicts the first (last-connection-wins), so two open panels can't both fire CDP actions.

**Permission modes** (bottom-left toggle, cycles Ask / Auto / Act, persisted): sent as
`mode` on `POST /api/agent/goal`; the server maps it to the gate level (commits always
gate). In **Ask** mode a `plan` event shows an Approve/Deny bar — Deny POSTs `/stop`.
**Stop** aborts the run (`POST /api/agent/stop`). The driven tab is scoped into a
labelled `webnav` tab group for the run (label flips to `webnav ✓` on done) and
un-grouped again once the run finishes — unless the tab was already in a group you made
yourself, which is left alone.

**On-page highlight pulse:** every click (and the click-to-focus step of a type) paints a
short-lived pulse at the exact point CDP clicked, reusing the same `DOM.getBoxModel` centre
already computed for the click — no extra round-trip. It's a single self-removing
`<div>` injected via `Runtime.evaluate` (pointer-events:none, painted *after* the real
input is dispatched, so it can never block or intercept it). This is a differentiator vs.
Claude-for-Chrome, which shows no on-page indicator of where it's acting.

**Pause / take-over / hand-back:** **Pause** (next to Stop) halts the agent loop
(`POST /api/agent/stop`, same endpoint Stop uses) but deliberately does **not** detach the
CDP debugger — the tab stays attached so you can keep interacting with it by hand. The tab
group relabels to `webnav ⏸ paused`. Honest scope: the SDK's `query` behind the agent loop
is a single-shot async generator, so there is no cheap way to freeze and later replay its
exact mid-turn reasoning. **Resume is not a true continuation** — it's sending a new goal
(the same one, or a different one), which starts a **fresh turn from the current page**
(the agent re-snapshots via get-ax, so it naturally picks up wherever you left the page).
The UI says this explicitly. Also honest: **while paused, your manual clicks/types on the
page are not captured in this increment** — the full click→settle capture-while-driving
loop is a later increment, not built here. Stop still works as before (full halt +
detach).

### Load and try a goal

```
cd webnav-extension && npm i && npm run build   # tsc, emits *.js beside *.ts
```

1. In the webnav repo: `webnav dev agent-serve --port 7779`. It prints a token — paste that
   into the panel. (Optional: `webnav dev agent-serve --port 7779 --token <hex>` to pin a
   stable token so you don't have to re-paste it on every restart.)
2. `chrome://extensions` → Developer mode → Load unpacked → select this folder.
3. Open the side panel from any tab — the toolbar action icon, or the `toggle-panel`
   command (**Cmd+E** / **Ctrl+E**).
4. Open **settings** and paste the printed token; (optionally) set the session name
   (`agent-1`) / server base (`http://127.0.0.1:7779`).
5. Navigate the active tab to e.g. `https://www.saucedemo.com`, pick a mode, type a goal
   (e.g. *log in as standard_user and open the cart*), and Send (or Cmd/Ctrl+Enter).
6. Watch the streamed reply + narration; the tab clicks/types itself. The yellow
   "webnav is debugging this browser" banner is expected — it persists for the whole run
   by design (one attach, no per-command detach) and clears on Stop / tab close. Closing
   the side panel itself (without clicking Stop) also detaches — the panel holds a
   long-lived port open for its own lifetime, and background.ts tears down the debugger
   attach on that port's disconnect, so the banner never lingers as a zombie.

## Teach mode

A third segment beside Ask/Act: **flip to Teach, demonstrate the task by hand in your own
tab, and webnav records it as a named, walkable route** — no goal prompt, no agent driving.
Live step chips (the same route-ledger rail the agent runs use) appear as you click and
type, so you can see each action land. Click **Done**, confirm the inferred **name** (or
type your own), and **Save** — that's the whole flow.

**What's captured:** page structure and element identity — the same `RawAXStep[]` shape an
agent-driven run produces (role/name/fingerprint of what you clicked, the AX diff between
pages). **Typed VALUES never leave the browser.** The content script that watches your
clicks/keystrokes reports only where and what kind of action happened; the accessibility
tree captured around a text field has its `value` scrubbed before anything is sent to the
local server. A password you type while teaching a login step is never transmitted or
stored — only the fact that a field was filled.

**What happens on Save:** the session is tagged `origin:'teach'` and auto-reviewed
(`human-confirmed teach demonstration` — you watching the live chips land is the
attestation, so it skips the usual capture-gap audit), then folds into the map through the
same `graph-analyse`/`graph-edit` pipeline every other recording uses. The destination
state gets your confirmed name (`taughtAs`), and it's recallable exactly like any other
route: `list_routes` surfaces it, `check_route` finds it from a natural-language goal, and
`walk` replays it deterministically — by any agent, not just the one that taught it.

**Honest limits:** phase 1 captures **clicks and field-touches only** — no typed-value
capture, no parameter/commit toggles yet (those are a later increment; see
`docs/superpowers/specs/2026-07-20-teach-mode-ideation.md`). Drift on replay is handled
exactly like any other walk: the route self-heals via fingerprint where it can, and
otherwise stops and escalates to the agent rather than guessing — one demonstration is not
a promise the site won't change. And there's no stealth: the "webnav is debugging this
browser" banner stays visible the whole time you're teaching, same as driving — Teach is a
sensor, not a covert recorder.
