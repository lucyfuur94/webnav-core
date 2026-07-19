All facts verified against the code. Two corrections needed to the requested-fixes spec (line refs are slightly off), noted in the merged spec below. Now writing the merged build-ready spec.

Facts confirmed:
- Storage keys `sid`/`base`/`mode`/`token` — confirmed (sidepanel.ts:80).
- `sidEl`/`baseEl`/`tokenEl` refs at :38-40; onchange at :88-90; `startRun` reads `sidEl.value` at :500.
- `settings-toggle` handler at :595-598 toggles `<details id="config">`.
- Enter-to-send is ⌘/Ctrl+Enter only (:603-605) — audit item 4 confirmed.
- `narrateAction` is dead (:258-265) — confirmed.
- Header markup :659-679; `<details class="config">` :681-694; `.mark`/`.brand`/`.conn`/`details.config` CSS as cited.
- manifest has no `options_ui` — confirmed.

---

# webnav agent side panel — polish increment (build-ready spec)

Single source of truth for a subagent to implement verbatim. Files live in `/Users/dikshantyadav/Documents/Projects/webnav-core/webnav-extension/`.

## Priority ladder — what to build this pass vs. later

**MUST-DO (this pass) — the 3 requested + the audit's must-have basics:**

| # | Item | Source |
|---|------|--------|
| R1 | Remove duplicated identity (slim header) | requested + audit #2 |
| R2 | Settings as a real options page in a new tab | requested |
| R3 | New-chat / clear-chat | requested + audit #1 |
| B1 | Enter-to-send (Shift+Enter = newline) | audit #4 |
| B2 | Copy-message button on assistant/done bubbles | audit #5 |
| B3 | Surface the token requirement inline (empty-state prereq + auto-open options when token empty) | audit #6 + #15 |
| B4 | Retry on error (keep last goal) | audit #7 |
| B5 | Disable Send when composer empty or disconnected | audit #8 |
| B6 | Auto-scroll only when near bottom + "jump to latest" pill | audit #10 + #11 |
| B7 | Generic placeholder + generic example chips (drop saucedemo-shaped copy) | audit #13 |

**NICE-TO-HAVE (noted for later, NOT this pass):** audit #3 timestamps/run-separators, #9 awaiting-approval as a named state, #12 elapsed timer/richer activity, #14 keyboard-shortcut help, #16 options save on `input`+validation (we do save-tick on `change`, enough), #17 delete `narrateAction` (leave it; harmless), #18 rename "Take over"→"Pause", #20 disable mode switch mid-run, #21 disable approve/deny after click, #22 unsent-draft persistence, #23 hide session behind Advanced.

---

## What MUST NOT break (regression fence)

Do not touch the behavior of any of these — they are verified working and out of scope:

- **`execAction` / CDP command channel** (sidepanel.ts:350-367) and the `action` vs `narrate` split (only `action` executes).
- **SSE stream** (`openStream`/`handleEvent`/EventSource + the 3s watchdog, :279-345, :615-617). New chat must NOT close or re-open the stream. Options edits re-open it *only* on base/token change (per R2).
- **Mode** state + persistence (`applyMode`, modeButtons, `chrome.storage.local.set({mode})`, :99-115) — stays in the panel, NOT moved to options.
- **Approve/Deny gate** (`postApprove`/`renderPlan`/`resolvePlanBar`/`pendingPlanBar`, :387-453).
- **Stop / Pause** (`stopRun`/`pauseRun`/`finishRun`, :540-585) and the `running`/`paused` state machine.
- **Token auth** — every POST carries `x-webnav-token`; SSE carries `?token=` (:290, :370-372). Keys stay `sid`/`base`/`mode`/`token` in `chrome.storage.local`.
- **`goto` / drivable-tab guard / tab-group scoping** (`drivableReason`, `START_URL`, `scopeTabGroup`, :142-172, :458-538).
- **Element IDs that survive:** `thread`, `goal`, `mode`, `send`, `stop`, `pause`, `conn`, `conn-text`, `tab`, `activity-step`, `settings-toggle`. New IDs added: `new-chat`, `jump-latest`. IDs removed (moved to options.html): `sid`, `base`, `token`, `config`.
- **Design language:** navigation-console tokens, both themes (`:root` + `prefers-color-scheme: dark`), mono/sans roles. Reuse existing vars; add no new colors.

---

## R1 — Remove duplicated identity (slim status/toolbar header)

Chrome's side-panel bar already shows "webnav" (`manifest.name`). Drop the in-panel `.mark` pin + `.brand` name. Header becomes one row: **connection lamp · driven-tab chip · spacer · [new-chat] [settings]**. The running "living" cue moves from `.mark` to the connection lamp.

### R1a — replace `<header>` markup (sidepanel.html:659-679)

```html
<header>
  <span class="conn" id="conn" title="Connection to the local webnav server">
    <span class="lamp"></span><span id="conn-text">connecting…</span>
  </span>
  <span class="tab" id="tab" title="Driving tab"></span>
  <span class="spacer"></span>
  <button class="icon-btn" id="new-chat" title="New chat" aria-label="New chat">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
  </button>
  <button class="icon-btn" id="settings-toggle" title="Settings" aria-label="Settings">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  </button>
</header>
```

### R1b — CSS edits (sidepanel.html)

**Delete** these now-dead rules:
- `.mark` / `.mark svg` / `body.running .mark` (:109-116).
- The whole `.brand` block (`.brand`, `.brand .name`, `.brand .name b`, `.brand .tab`, `.brand .tab:empty`, :121-137).
- The old `.spacer { flex: 1; }` at :573 (moved into the header block below — keep ONE only).
- `.conn { max-width: 46%; ... }` overflow/ellipsis lines (:151-153) — the chip flexes now.
- `.conn { max-width: 40%; }` inside `@media (max-width:340px)` (:655).

**Keep** `@keyframes markpulse` (:117-120) — reused by the lamp.

**Replace** the header block (:101-108) with:

```css
  /* ───────────────────────── Header — slim status/toolbar ───────────────────────── */
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--rule);
    background: var(--panel);
  }
  .spacer { flex: 1; }   /* single definition — the old footer .spacer at line 573 is deleted */

  /* Driven-tab chip — now a header element (was .brand .tab). */
  .tab {
    flex: 0 1 auto;
    min-width: 0;
    font-family: var(--mono);
    font-size: 10.5px;
    color: var(--ink-faint);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .tab:empty { display: none; }
```

**Replace** the `.conn` base rule (:140-153, keep the `.conn.ok`/`.conn.err`/`.lamp` state rules at :154-163) with:

```css
  /* Connection lamp — coordinate readout. */
  .conn {
    display: inline-flex; align-items: center; gap: 6px;
    flex: 0 0 auto;
    font-family: var(--mono);
    font-size: 10.5px;
    color: var(--ink-faint);
    padding: 4px 8px;
    border: 1px solid var(--rule);
    border-radius: 999px;
    background: var(--bg);
    white-space: nowrap;
    cursor: default;
  }
```

**Append** after the `.conn.err .lamp` rule (:163) — move the running cue onto the lamp:

```css
  /* The lamp pulses while the agent drives (was body.running .mark). */
  body.running .conn.ok .lamp { animation: markpulse 1.6s ease-in-out infinite; }
```

**Reduced-motion block** (:643-648): change both `body.running .mark` occurrences → `body.running .conn.ok .lamp`:

```css
  @media (prefers-reduced-motion: reduce) {
    .msg.action.live::before, .activity .beam::after,
    .msg.assistant.streaming::after, body.running .conn.ok .lamp { animation: none; }
    .activity .beam::after { width: 100%; opacity: .6; transform: none; }
    .msg.assistant.streaming::after { opacity: 1; }
    body.running .conn.ok .lamp { opacity: 1; transform: none; }
  }
```

### R1c — sidepanel.ts

`renderTabChip` writes to `tabEl` (id `tab`) — unchanged, id survives. No JS change for R1 beyond the wiring in R3/R2.

---

## R2 — Real options page in a new tab

Move `sid`/`base`/`token` out of the inline `<details>` into `options.html` + `options.ts`. Gear calls `chrome.runtime.openOptionsPage()`. Keys stay identical; the panel gains a `chrome.storage.onChanged` listener so options-tab edits update the live panel with no reload.

### R2a — manifest.json diff

```diff
   "side_panel": { "default_path": "sidepanel.html" },
+  "options_ui": { "page": "options.html", "open_in_tab": true },
   "commands": {
```

`open_in_tab: true` opens a full browser tab (Claude-style), not the embedded dialog.

### R2b — delete from sidepanel.html

- Remove the entire `<details class="config" id="config">` block (:681-694).
- Remove the `details.config*` + `.config-body*` CSS (:179-214).

### R2c — sidepanel.ts changes

**Remove** the three input refs (:38-40):

```diff
-const sidEl = byId<HTMLInputElement>('sid');
-const baseEl = byId<HTMLInputElement>('base');
-const tokenEl = byId<HTMLInputElement>('token');
```

**Add** `sid` as a module var, near the other run vars (after :65, alongside `base`/`token`):

```ts
let sid = 'agent-1'; // session id; edited in the options tab, read fresh at startRun
```

**Replace** the storage-load block + the three onchange handlers (:80-90) with a var-only load plus a live `onChanged` listener:

```ts
// Config lives in the options tab now (options.html). The panel only READS the
// stored values; keys are unchanged (sid/base/mode/token) so whatever options.ts
// writes, the panel picks up here — and reacts live via storage.onChanged.
chrome.storage.local.get(['sid', 'base', 'mode', 'token']).then((s) => {
  if (s.sid) sid = s.sid as string;
  if (s.base) base = s.base as string;
  if (s.token) token = (s.token as string).trim();
  if (s.mode && (MODES as readonly string[]).includes(s.mode as string)) mode = s.mode as Mode;
  applyMode();
  openStream(); // re-open once the persisted token is loaded
});

// Editing base/token/sid in the options tab must update the live panel without a
// reload. base/token changes re-open the SSE stream; sid is read fresh at startRun.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  let reopen = false;
  if (changes.base) { base = changes.base.newValue ?? base; reopen = true; }
  if (changes.token) { token = (changes.token.newValue ?? '').trim(); reopen = true; }
  if (changes.sid) sid = changes.sid.newValue ?? sid;
  if (changes.mode && (MODES as readonly string[]).includes(changes.mode.newValue)) { mode = changes.mode.newValue; applyMode(); }
  if (reopen) openStream();
});
```

> NOTE (correction to the requested-fixes draft): `MODES`, `applyMode`, and `mode` are declared at :53-104, *below* the storage block at :80-90. The load block above references `MODES`/`applyMode` before their declaration. This is fine — `openStream`, `applyMode`, `MODES` are function/`const` hoisting-safe *only for the function*, but `MODES`/`mode` are `const`/`let` in the temporal dead zone at module-eval time. **However the code runs inside `.then()` (a later microtask), so by the time the callback fires all module-level declarations have initialized.** The existing code already does exactly this (`applyMode()` at :85), so it is safe. The `onChanged` listener body also only runs later. No reordering needed.

**In `startRun`** (:500), replace `sidEl.value` → `sid`:

```diff
-    body: JSON.stringify({ goal, sessionId: sidEl.value, mode: mode.toLowerCase() }),
+    body: JSON.stringify({ goal, sessionId: sid, mode: mode.toLowerCase() }),
```

**Rewrite the gear handler** (:595-598) from toggling `<details>` to opening the options tab:

```ts
// The header gear opens the full options page in a browser tab (Claude-style).
byId<HTMLButtonElement>('settings-toggle').onclick = () => chrome.runtime.openOptionsPage();
```

> `mode` still persists from the composer's mode switch (:113). The `onChanged` listener just keeps two open panels in sync; harmless.

### R2d — shared theme tokens (`theme.css`, new file)

The `:root{…}` token block + the dark `@media` block + `*{box-sizing}` + `html,body{height}` + `::selection` are identical across both pages. Factor them into `theme.css`, link from both — one source of truth.

**Create `theme.css`** = sidepanel.html lines **11-83 minus the `body{…}` rule** (:73-82, which is page-specific — it sets `display:flex;flex-direction:column`). Concretely `theme.css` contains: the `:root{…}` block (:11-41), the `@media (prefers-color-scheme: dark)` block (:42-69), `* { box-sizing: border-box; }` (:71), `html, body { height: 100%; }` (:72), and `::selection {…}` (:83).

> ponytail: linking one shared stylesheet beats maintaining two copies of ~60 lines of tokens. This is the recommended path.

**In sidepanel.html**, the `<style>` opens at line 3. Insert a `<link>` **before** `<style>` (line 3), and delete the extracted lines from inside `<style>`:

```html
<meta charset="utf-8">
<link rel="stylesheet" href="theme.css">
<style>
  /* the :root / dark @media / *,html,body height / ::selection now live in theme.css */
  body {
    margin: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--ink);
    font: 13px/1.5 var(--sans);
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  /* body::before chart-grid wash and everything below stays as-is */
```

Keep `body::before` (:86-97) and `body > * { position: relative; z-index: 1; }` (:98) in the page `<style>` — panel-specific.

### R2e — options.html (new file)

```html
<!-- webnav-extension/options.html — full-page settings (Claude-style options tab) -->
<meta charset="utf-8">
<title>webnav agent — settings</title>
<link rel="stylesheet" href="theme.css">
<style>
  body {
    display: block;
    max-width: 620px;
    margin: 0 auto;
    padding: 40px 24px 64px;
    font: 13px/1.5 var(--sans);
    background: var(--bg);
    color: var(--ink);
  }
  h1 {
    font-family: var(--mono);
    font-size: 15px; font-weight: 600; letter-spacing: .01em;
    margin: 0 0 4px;
  }
  .sub { color: var(--ink-soft); font-size: 12.5px; margin: 0 0 28px; }
  section {
    background: var(--panel);
    border: 1px solid var(--rule);
    border-radius: 12px;
    padding: 18px 18px 20px;
    margin-bottom: 16px;
    box-shadow: var(--shadow);
  }
  section > h2 {
    font-family: var(--mono);
    font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase;
    color: var(--ink-faint);
    margin: 0 0 14px;
  }
  label {
    display: flex; flex-direction: column; gap: 5px;
    margin-bottom: 14px;
    font-family: var(--mono); font-size: 10px; letter-spacing: .04em;
    text-transform: uppercase; color: var(--ink-faint);
  }
  label:last-child { margin-bottom: 0; }
  input {
    font-family: var(--mono); font-size: 13px;
    padding: 9px 11px;
    border: 1px solid var(--rule);
    border-radius: 8px;
    background: var(--sunken);
    color: var(--ink);
    text-transform: none; letter-spacing: 0;
  }
  input::placeholder { color: var(--ink-faint); }
  input:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; border-color: transparent; }
  .hint {
    font-family: var(--mono); font-size: 11px;
    color: var(--ink-soft);
    text-transform: none; letter-spacing: 0;
    margin-top: 6px;
  }
  .hint code {
    color: var(--accent-ink);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    padding: 2px 6px; border-radius: 5px;
    white-space: nowrap;
  }
  .saved {
    font-family: var(--mono); font-size: 11px; color: var(--ok);
    opacity: 0; transition: opacity .15s;
  }
  .saved.show { opacity: 1; }
</style>

<h1>webnav agent</h1>
<p class="sub">Local settings. The panel picks these up live — no reload needed.</p>

<section>
  <h2>Server</h2>
  <label>Server URL
    <input id="base" value="http://127.0.0.1:7779" spellcheck="false">
  </label>
  <label>Token
    <input id="token" placeholder="paste the token from `webnav agent-serve`" spellcheck="false">
    <span class="hint">Start the local server, then paste its token:<br><code>webnav agent-serve --port 7779</code></span>
  </label>
</section>

<section>
  <h2>Session</h2>
  <label>Session name
    <input id="sid" value="agent-1" spellcheck="false">
    <span class="hint">Recordings and goals are grouped under this session id.</span>
  </label>
</section>

<span class="saved" id="saved">saved ✓</span>

<script src="options.js" type="module"></script>
```

### R2f — options.ts (new file)

```ts
// webnav-extension/options.ts — full-page settings.
// Reads/writes the SAME chrome.storage.local keys the panel reads (sid/base/token),
// so the panel's storage.onChanged listener updates the live panel with no reload.
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const baseEl = byId<HTMLInputElement>('base');
const tokenEl = byId<HTMLInputElement>('token');
const sidEl = byId<HTMLInputElement>('sid');
const savedEl = byId<HTMLSpanElement>('saved');

chrome.storage.local.get(['sid', 'base', 'token']).then((s) => {
  if (s.base) baseEl.value = s.base as string;
  if (s.token) tokenEl.value = s.token as string;
  if (s.sid) sidEl.value = s.sid as string;
});

let savedTimer: ReturnType<typeof setTimeout> | undefined;
function flashSaved(): void {
  savedEl.classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => savedEl.classList.remove('show'), 1200);
}

// Persist on change; token is trimmed to match the panel's handling.
baseEl.onchange = () => { chrome.storage.local.set({ base: baseEl.value.trim() }); flashSaved(); };
tokenEl.onchange = () => { chrome.storage.local.set({ token: tokenEl.value.trim() }); flashSaved(); };
sidEl.onchange = () => { chrome.storage.local.set({ sid: sidEl.value.trim() }); flashSaved(); };
```

### R2g — build entrypoints

The extension has no build step check I can run here. **Whatever bundles `sidepanel.ts` + `background.ts` must also emit `options.js` from `options.ts`** next to `options.html`. If it's a manual `tsc`/esbuild invocation, add `options.ts` to the entrypoint list. Verify `options.js` lands in the load-unpacked dir.

---

## R3 — New chat (Clear built in)

The `+` (`#new-chat`, R1a) runs `resetChat()`: stop any active run, wipe the thread + all render state, rotate the session id, re-show the empty state. Matches Claude — always available.

### R3a — sidepanel.ts, add after `stopRun()` (after :560)

```ts
// New chat (the header "+"): stop any active run, wipe the thread + all render
// state, rotate the session id so a fresh chat's recordings/goals don't bleed into
// the previous one, and re-show the empty state. Matches Claude: always available.
async function resetChat(): Promise<void> {
  if (running || paused) await stopRun(); // halts the loop + detaches; resets running/paused

  // Rotate session id: keep the user's base name, append a fresh suffix so the
  // server buckets this chat separately. Persisted so options.html reflects it too.
  const baseName = sid.replace(/-[0-9a-z]+$/i, '') || 'agent';
  sid = `${baseName}-${Date.now().toString(36)}`;
  chrome.storage.local.set({ sid });

  // Wipe thread + all per-conversation render state.
  endTurn();                 // drop any streaming caret + null assistantBubble
  currentRoute = null;       // close the route rail
  pendingPlanBar = null;     // any open plan gate is gone with the thread
  lastGoal = '';             // R3+B4: nothing to retry in a fresh chat
  thread.replaceChildren();  // clear #thread
  activityStep.textContent = 'working…';

  renderEmpty();             // first-run orientation again
  updateEmptyPrereq(connEl.classList.contains('ok'));
  goalEl.value = '';
  autosize();
  updateSendEnabled();       // B5: reflect empty composer
  goalEl.focus();
}
```

> Correction to the requested draft: the sid-rotation regex was `/-\d+$/` which would NOT strip a base36 suffix like `-abc1` (it only strips trailing digits), so repeated new-chats WOULD stack (`agent-1` → `agent-1-def2`). Use `/-[0-9a-z]+$/i` to strip either a numeric or base36 suffix, so it stays `agent-<b36>` each time. `updateSendEnabled` is from B5.

### R3b — wire it (near :600)

```ts
byId<HTMLButtonElement>('new-chat').onclick = resetChat;
```

Interaction with stop: `stopRun()` already POSTs `/api/agent/stop`, detaches the debugger, resets `paused`, and calls `finishRun()` (clears `running`, re-enables Send, removes `body.running`, resolves any dangling plan bar, ungroups the tab). So after `await stopRun()` the machine is idle; `resetChat` only clears DOM + rotates `sid`. `pendingPlanBar` is nulled (not `resolvePlanBar`) because the DOM is about to be wiped by `replaceChildren()`.

---

## B1 — Enter-to-send

Replace the keydown handler (:603-605):

```ts
// Enter sends; Shift+Enter inserts a newline (Claude/ChatGPT/Slack convention).
goalEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); startRun(); }
});
```

Update the Send button tooltip in sidepanel.html (:716): `title="Send (⌘/Ctrl+Enter)"` → `title="Send (Enter)"`.

> `!e.isComposing` guards IME composition (Enter mid-composition commits the candidate, doesn't send).

## B2 — Copy-message button

Add CSS (append near the `.msg.assistant`/`.msg.done` rules in sidepanel.html):

```css
  /* Hover-reveal copy affordance on assistant prose + done/error summaries. */
  .msg.assistant, .msg.done, .msg.error { position: relative; }
  .copy-btn {
    position: absolute; top: 4px; right: 4px;
    width: 22px; height: 22px;
    display: inline-flex; align-items: center; justify-content: center;
    border: 1px solid var(--rule); border-radius: 6px;
    background: var(--panel); color: var(--ink-faint);
    cursor: pointer; padding: 0;
    opacity: 0; transition: opacity .12s;
  }
  .msg.assistant:hover .copy-btn, .msg.done:hover .copy-btn, .msg.error:hover .copy-btn,
  .copy-btn:focus-visible { opacity: 1; }
  .copy-btn:hover { color: var(--ink); border-color: var(--ink-faint); }
  .copy-btn svg { width: 12px; height: 12px; }
```

In sidepanel.ts, add a helper and attach it where these bubbles are finalized. The clean seam is `bubble()` (:216) — but action rows and user bubbles should NOT get a copy button. Add a helper and call it for `assistant`/`done`/`error` kinds:

```ts
const COPY_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';

// Hover copy button — writes the bubble's text (not the button glyph) to the clipboard.
function addCopyButton(el: HTMLElement): void {
  const btn = document.createElement('button');
  btn.className = 'copy-btn'; btn.type = 'button';
  btn.title = 'Copy'; btn.setAttribute('aria-label', 'Copy message');
  btn.innerHTML = COPY_SVG;
  btn.onclick = () => {
    // el.textContent includes the button's own (empty) text; the SVG has none, so this is
    // just the message text. navigator.clipboard is available in the panel document.
    const text = Array.from(el.childNodes)
      .filter((n) => n !== btn)
      .map((n) => n.textContent ?? '').join('');
    navigator.clipboard.writeText(text.trim()).then(() => {
      btn.classList.add('copied'); setTimeout(() => btn.classList.remove('copied'), 900);
    }).catch(() => {});
  };
  el.appendChild(btn);
}
```

In `bubble()` (:216-226), after `el.textContent = text;` and before `thread.appendChild(el)`, add:

```ts
  if (kind === 'assistant' || kind === 'done' || kind === 'error') addCopyButton(el);
```

> For streaming assistant bubbles, `textContent += e.text` (:312) appends text nodes, and the copy handler filters out the button node, so the growing text copies correctly. The button is appended once when the bubble is created.

## B3 — Surface the token requirement inline

Two parts. (1) Add the token line to the empty-state prereq. (2) Auto-open options when `token` is empty on load.

**Empty-state prereq** — in `renderEmpty()` (:188), the prereq `<div>` currently shows only the serve command. Extend it so the token step is visible:

```ts
    '<div class="prereq"><span>Needs the local server:</span> <code>webnav agent-serve --port 7779</code>' +
    '<br><span class="tok">then paste its token in <button type="button" class="lnk" id="open-opts">settings</button></span></div>';
```

Add after the examples loop in `renderEmpty()` (before `thread.appendChild(wrap)`):

```ts
  const openOpts = wrap.querySelector('#open-opts') as HTMLButtonElement | null;
  if (openOpts) openOpts.onclick = () => chrome.runtime.openOptionsPage();
```

Add CSS for the inline link + token line:

```css
  .empty .prereq .tok { color: var(--ink-faint); }
  .empty .prereq .lnk {
    border: 0; background: none; padding: 0; cursor: pointer;
    font: inherit; color: var(--accent-ink); text-decoration: underline;
  }
```

**Auto-open when token empty** — in the storage-load `.then()` (R2c), after `openStream()`, add:

```ts
  // First-run: no token means the panel can't connect. Open the options tab so the
  // user can paste it, instead of leaving them staring at "no token".
  if (!token) chrome.runtime.openOptionsPage();
```

> ponytail: opens options once on load if token is missing. Not gated on "first ever run" — if you've cleared the token it re-opens, which is the right nudge. No new storage flag.

## B4 — Retry on error

Keep the last goal; render a Retry button on `.msg.error`.

Add a module var near the run vars:

```ts
let lastGoal = ''; // the goal of the most recent run, for Retry on error
```

In `startRun()` (:459), after `const goal = goalEl.value.trim();` and the guard, once committed to running (after :460), set it:

```ts
  lastGoal = goal;
```

(Place `lastGoal = goal;` right after the `if (!goal || running) return;` guard so a real run always records it.)

In `handleEvent` `case 'error'` (:339-343), after `bubble('error', e.message)`, attach a retry button. Simplest: give the error bubble a retry action:

```ts
    case 'error': {
      endTurn();
      const el = bubble('error', e.message);
      if (lastGoal) addRetryButton(el, lastGoal);
      finishRun();
      break;
    }
```

Add the helper:

```ts
// Retry re-runs the last goal from the errored run. Puts the goal back in the composer
// and fires startRun (which re-reads goalEl), so the user can also edit before retrying.
function addRetryButton(el: HTMLElement, goal: string): void {
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'retry-btn';
  btn.textContent = 'Retry';
  btn.onclick = () => {
    if (running) return;
    goalEl.value = goal; autosize(); updateSendEnabled();
    startRun();
  };
  el.appendChild(btn);
}
```

CSS:

```css
  .retry-btn {
    margin-left: auto; align-self: center; flex: 0 0 auto;
    padding: 4px 10px; border-radius: 7px; cursor: pointer;
    font: 600 11px var(--sans);
    border: 1px solid color-mix(in srgb, var(--err) 40%, var(--rule));
    background: var(--panel); color: var(--err);
  }
  .retry-btn:hover { background: var(--err); color: var(--on-accent); border-color: var(--err); }
```

> `.msg.error` is already `display:flex` with `gap:8px` (:376), so `margin-left:auto` pushes Retry to the right after the icon+text. The copy button (B2) is `position:absolute` top-right so it won't collide (retry sits inline; copy floats). If they visually overlap in the render pass, give `.msg.error .copy-btn { right: 74px; }` — flag for the load-unpacked check.

## B5 — Disable Send when empty or disconnected

Add a helper and call it from the composer `input` handler, from `setConn`, and after load:

```ts
// Send is only meaningful with a non-empty goal AND a live connection. Disabled
// otherwise so a click that would silently no-op (empty) or 401 (no token) can't happen.
function updateSendEnabled(): void {
  if (running) return; // run-controls own the button state during a run
  sendEl.disabled = !goalEl.value.trim() || !connEl.classList.contains('ok');
}
```

Wire it:
- In the `input` listener — extend the existing `goalEl.addEventListener('input', autosize)` (:592):
  ```ts
  goalEl.addEventListener('input', () => { autosize(); updateSendEnabled(); });
  ```
- In `setConn` (:45-51), after `updateEmptyPrereq(state === 'ok')`, add `updateSendEnabled();`.
- After `renderEmpty(); openStream();` at the bottom (:607-608), add `updateSendEnabled();`.

> `finishRun` (:542) sets `sendEl.disabled = false` unconditionally; follow it with `updateSendEnabled()` so a finished run with an empty composer re-disables correctly. Add `updateSendEnabled();` as the last line of `finishRun`. Same in `stopRun`/`pauseRun` — they call `finishRun`, so covered.

## B6 — Auto-scroll only near bottom + jump-to-latest pill

Three `thread.scrollTop = thread.scrollHeight` sites: `bubble()` (:224), `actionRow()` (:251), `turn` handler (:313). Replace each direct write with a guarded helper.

Add near the thread helpers:

```ts
// Only yank to the bottom if the user is already there (within 40px); otherwise leave
// their scroll position and show the jump-to-latest pill so they can return in one click.
function scrollThreadIfNearBottom(): void {
  const nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 40;
  if (nearBottom) thread.scrollTop = thread.scrollHeight;
  else jumpPill.classList.add('show');
}
```

Replace the three `thread.scrollTop = thread.scrollHeight;` lines with `scrollThreadIfNearBottom();`.

Add the pill element + wiring. Element: append to sidepanel.html footer, just before `.composer` inside `<footer>` (so it floats above the composer):

```html
  <button class="jump-latest" id="jump-latest" type="button" aria-label="Jump to latest">
    ↓ latest
  </button>
```

Refs + logic in sidepanel.ts (near the other `byId` refs):

```ts
const jumpPill = byId<HTMLButtonElement>('jump-latest');
jumpPill.onclick = () => { thread.scrollTop = thread.scrollHeight; jumpPill.classList.remove('show'); };
// Hide the pill once the user scrolls back to the bottom themselves.
thread.addEventListener('scroll', () => {
  if (thread.scrollHeight - thread.scrollTop - thread.clientHeight < 40) jumpPill.classList.remove('show');
});
```

CSS:

```css
  .jump-latest {
    position: absolute; left: 50%; transform: translateX(-50%);
    bottom: 100%; margin-bottom: 8px;
    display: none; align-items: center; gap: 5px;
    padding: 5px 12px; border-radius: 999px; cursor: pointer;
    font: 600 11px var(--mono);
    background: var(--accent); color: var(--on-accent);
    border: 0; box-shadow: var(--shadow);
    z-index: 2;
  }
  .jump-latest.show { display: inline-flex; }
```

The pill is positioned relative to `<footer>`, so add `position: relative;` to the `footer` rule (:517-521).

> ponytail: 40px threshold, no debounce on scroll — a localhost panel's thread is small; the listener is one comparison. Add debounce only if profiling shows jank.

## B7 — Generic placeholder + example chips

sidepanel.html `<textarea>` placeholder (:708):

```diff
-<textarea id="goal" rows="1" placeholder="Name a destination — e.g. log in and open the cart…"></textarea>
+<textarea id="goal" rows="1" placeholder="Describe what to do on this page…"></textarea>
```

sidepanel.ts `renderEmpty()` example chips (:190) — replace the saucedemo-shaped list with generic ones:

```diff
-  for (const ex of ['Log in and open my cart', 'Find the cheapest item and add it', 'Go to checkout and read the total']) {
+  for (const ex of ['Log in to this site', 'Search for something and open the first result', 'Fill out and submit the form on this page']) {
```

> The empty-state `<h2>Name a destination</h2>` and `<p>` copy (:185-186) are page-agnostic already — leave them.

---

## Files touched (summary)

- `manifest.json` — add `options_ui`.
- `sidepanel.html` — slim header (R1a); delete `.mark`/`.brand`/`details.config`/`.config-body` markup+CSS; link `theme.css` (R2d); new header/tab/conn CSS; copy-btn/retry-btn/jump-latest CSS; jump-latest element; generic placeholder; `footer{position:relative}`; Send tooltip.
- `sidepanel.ts` — drop input refs + onchange; `sid`/`lastGoal` module vars; `storage.onChanged` listener; gear → `openOptionsPage()`; `startRun` uses `sid` + records `lastGoal`; `resetChat()` + wire `#new-chat`; Enter-to-send; `addCopyButton`/`addRetryButton`; token-empty auto-open + prereq token line; `updateSendEnabled`; `scrollThreadIfNearBottom` + jump-pill.
- `theme.css` — **new**, shared tokens.
- `options.html` / `options.ts` — **new**, full-page settings; add `options.ts` to build entrypoints.

## Verification owed (could not run here)

No `tsc` / load-unpacked in this session (matches the standing `TODO(user-gated)` at sidepanel.ts:22). All line refs, storage keys, IDs, and the state machine were traced against the current files. A load-unpacked pass in **both themes** must confirm: slim header layout at ~320px, lamp pulse under running + stopping under reduced-motion, copy/retry buttons not overlapping in `.msg.error`, jump-latest pill show/hide, options tab opening on empty token, and `options.js` emitted to the load dir.

## Two corrections applied to the requested-fixes draft

1. **sid-rotation regex** — draft's `/-\d+$/` only strips trailing *digits*, so `agent-abc1` → base36 suffixes would stack. Changed to `/-[0-9a-z]+$/i`.
2. **Line-reference drift** — the requested draft cited a few off-by-a-little line numbers (e.g. header at "667-670", conn "296-297"). Verified-actual refs are used above (header markup 659-679, conn markup 671-673, gear handler 595-598). The `.then()`/listener timing concern is a non-issue (both run as later microtasks), noted so the implementer doesn't reorder needlessly.