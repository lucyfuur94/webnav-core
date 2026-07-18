<!-- webnav-extension/README.md -->
# webnav recorder (Chrome MV3)

Sensor: `chrome.debugger` → CDP `Accessibility.getFullAXTree` (real native accessibility
tree, same source real assistive tech and Chrome DevTools use). The extension stays
DUMB — it POSTs the raw AX node array; the webnav server (`/ingest-ax`) adapts it into
the same `SnapNode[]` shape playwright produces and reconstructs fingerprints/diffs with
tested code. Loading the extension shows Chrome's "webnav recorder is debugging this
browser" banner — that's the `debugger` permission at work, expected and accepted (the
only way a content script's page can hand over `getFullAXTree`).

Increment B builds a single **"Capture this page"** action only (not the full
click→settle record loop — that's a later increment).

## Build

```
cd webnav-extension && npm i && npm run build
```

## Load and test

1. `webnav dev ingest --port 7778` (in the webnav repo — starts the local receiver).
2. `chrome://extensions` → Developer mode → Load unpacked → select this folder.
3. Open any page you want to map. Click the extension icon.
4. Set the session name (default `human-1`) and confirm the ingest URL
   (`http://127.0.0.1:7778/ingest-ax`).
5. Click **Capture this page**. Chrome shows the debugging banner while it captures,
   then it detaches automatically. The popup reports how many steps were ingested.
6. Back in the webnav repo: `webnav dev graph-analyse <session> --draft --skip-review-gate`
   — this should show the captured page's controls (buttons/links/inputs), matching what
   a playwright snapshot of the same page would show.

Secret rule: password / credit-card field *values* are never read — only role/name/url
structure is captured.

## Phase 2 — agent side panel (drive a tab with a goal)

A docked side panel chat that streams Claude's replies + live narration and drives the
active tab over CDP, talking to `webnav agent-serve` (local, port 7779).

The panel opens the SSE stream itself (the service worker idles and would drop it),
renders `turn` deltas into an assistant bubble + `action` narration lines, and forwards
each `action` command to `background.js` to execute over ONE persistent `chrome.debugger`
attach — get-ax (`getFullAXTree`), click (AX nodeId → `backendDOMNodeId` →
`DOM.getBoxModel` content-quad centre → `Input.dispatchMouseEvent`), type (click to focus
→ `Input.insertText`). The command result is POSTed back to `/api/agent/command-result`.

**Permission modes** (bottom-left toggle, cycles Ask / Auto / Act, persisted): sent as
`mode` on `POST /api/agent/goal`; the server maps it to the gate level (commits always
gate). In **Ask** mode a `plan` event shows an Approve/Deny bar — Deny POSTs `/stop`.
**Stop** aborts the run (`POST /api/agent/stop`). The driven tab is scoped into a
labelled `webnav` tab group. (Group label flips to `webnav ✓` on done — animated
loading dots on the group are deferred; the label is the minimal honest visual state.)

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

1. In the webnav repo: `webnav agent-serve --port 7779`.
2. `chrome://extensions` → Developer mode → Load unpacked → select this folder.
3. Open the side panel — the toolbar action icon, or the `toggle-panel` command
   (**Cmd+E** / **Ctrl+E**).
4. (Optional) open **settings** to set the session name (`agent-1`) / server base
   (`http://127.0.0.1:7779`).
5. Navigate the active tab to e.g. `https://www.saucedemo.com`, pick a mode, type a goal
   (e.g. *log in as standard_user and open the cart*), and Send (or Cmd/Ctrl+Enter).
6. Watch the streamed reply + narration; the tab clicks/types itself. The yellow
   "webnav is debugging this browser" banner is expected — it persists for the whole run
   by design (one attach, no per-command detach) and clears on Stop / tab close.
