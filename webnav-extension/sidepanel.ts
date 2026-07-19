// webnav-extension/sidepanel.ts
// The browser side of `webnav agent-serve`. Opens the SSE stream IN THE PANEL (the
// service worker idles and would drop a long-lived EventSource), renders Claude's reply
// deltas + action narration, and forwards each `action` command to background.ts to be
// executed over the persistent CDP debugger session — then POSTs the result back so the
// server's agent loop unblocks. See task-5-brief.md + the verified server contract.

type Cmd = { kind: 'get-ax' | 'click' | 'type'; nodeId?: string; text?: string };
type AgentEvent =
  | { type: 'turn'; text: string }
  // `narrate` is display-only (what the agent did); NEVER execute it. `action` is the
  // real CDP command channel — only it goes through execAction.
  | { type: 'narrate'; label: string; detail?: string }
  | { type: 'action'; id: string; cmd: Cmd }
  | { type: 'done'; summary?: string }
  | { type: 'error'; message: string }
  | { type: 'plan'; steps: string[] };

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const thread = byId<HTMLDivElement>('thread');
const goalEl = byId<HTMLTextAreaElement>('goal');
const modeEl = byId<HTMLButtonElement>('mode');
const sendEl = byId<HTMLButtonElement>('send');
const stopEl = byId<HTMLButtonElement>('stop');
const pauseEl = byId<HTMLButtonElement>('pause');
const connEl = byId<HTMLSpanElement>('conn');
const sidEl = byId<HTMLInputElement>('sid');
const baseEl = byId<HTMLInputElement>('base');
const tokenEl = byId<HTMLInputElement>('token');

const MODES = ['Ask', 'Auto', 'Act'] as const;
type Mode = (typeof MODES)[number];

// Launching from a chrome://, New-Tab, blank, or extension tab can't be driven (the CDP
// debugger refuses those, and about:blank isn't attachable either). Instead of refusing,
// we open a fresh REAL http(s) tab and drive that — the agent immediately goto()s to its
// real destination, so this is just a neutral drivable landing. Google chosen: a real,
// lightweight, always-reachable page (not an evasion; just somewhere attachable to start).
const START_URL = 'https://www.google.com';

let mode: Mode = 'Ask';
let base = 'http://127.0.0.1:7779';
let token = ''; // per-run secret from `webnav agent-serve`; required on every request
let targetTabId: number | null = null;
let running = false;
let paused = false; // handed control to the user without detaching the debugger
let assistantBubble: HTMLDivElement | null = null; // current streaming assistant reply

// Long-lived port tracking the PANEL DOCUMENT's lifetime (not the run's) — connect once at
// load. background.ts listens for this port's onDisconnect (panel closed/reloaded) and
// detaches the debugger then, so closing the panel without clicking Stop can't leave the
// driven tab's "debugging this browser" banner stuck forever.
chrome.runtime.connect({ name: 'webnav-panel' });

// ---------------------------------------------------------------------------
// Config persistence (chrome.storage) — mirrors the popup pattern.
// ---------------------------------------------------------------------------
chrome.storage.local.get(['sid', 'base', 'mode', 'token']).then((s) => {
  if (s.sid) sidEl.value = s.sid as string;
  if (s.base) { baseEl.value = s.base as string; base = s.base as string; }
  if (s.token) { tokenEl.value = s.token as string; token = s.token as string; }
  if (s.mode && (MODES as readonly string[]).includes(s.mode as string)) mode = s.mode as Mode;
  applyMode();
  openStream(); // re-open once the persisted token is loaded (initial open may have been token-less)
});
baseEl.onchange = () => { base = baseEl.value; chrome.storage.local.set({ base }); openStream(); };
sidEl.onchange = () => chrome.storage.local.set({ sid: sidEl.value });
tokenEl.onchange = () => { token = tokenEl.value.trim(); chrome.storage.local.set({ token }); openStream(); };

// One-line, honest description of what each mode gates (crit #3/#4). Shown as the
// button's tooltip so the three modes read as genuinely different, not cosmetic.
const MODE_HINT: Record<Mode, string> = {
  Ask: 'Ask: shows a plan and WAITS for your Approve before driving anything.',
  Auto: 'Auto: drives on its own, but asks before navigating to a new site.',
  Act: 'Act: drives freely without confirmations (irreversible actions are still never auto-fired).',
};
function applyMode(): void {
  modeEl.textContent = mode;
  modeEl.title = MODE_HINT[mode];
}
modeEl.onclick = () => {
  mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
  applyMode();
  chrome.storage.local.set({ mode });
};

// ---------------------------------------------------------------------------
// Target tab — the panel outlives tab switches, so re-query on activation.
// ---------------------------------------------------------------------------
let targetTabUrl = '';
async function resolveTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  targetTabId = tab?.id ?? null;
  targetTabUrl = tab?.url ?? '';
}
resolveTab();

// chrome.debugger cannot attach to chrome://, chrome-extension://, the Web Store, view-source:,
// about: or file:// pages — attach throws "Cannot access a chrome:// URL". Only http(s) tabs are
// drivable. Guard BEFORE attach so the user gets a clear reason, not a raw CDP error.
function drivableReason(url: string): string | null {
  if (!url) return 'the active tab has no URL yet — reload it and try again';
  if (/^https?:\/\//i.test(url)) return null;
  return 'the agent can only drive normal web pages (http/https). Open a website in this tab first — ' +
    'it can\'t drive chrome:// pages, the New Tab page, the Web Store, or extension pages.';
}
chrome.tabs.onActivated.addListener(() => { if (!running) resolveTab(); });

// Resolve once a freshly-created tab has finished loading, so the debugger attach + first
// get-ax read a settled page. ponytail: 15s ceiling, then proceed anyway — attach/get-ax
// will surface any real problem; a slow first paint shouldn't block the run outright.
function waitTabComplete(tabId: number, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve();
    };
    const onUpdated = (id: number, info: chrome.tabs.OnUpdatedInfo): void => {
      if (id === tabId && info.status === 'complete') done();
    };
    const timer = setTimeout(done, timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

// ---------------------------------------------------------------------------
// Thread rendering.
// ---------------------------------------------------------------------------
function bubble(kind: string, text = ''): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'msg ' + kind;
  el.textContent = text;
  thread.appendChild(el);
  thread.scrollTop = thread.scrollHeight;
  return el;
}

function narrateAction(cmd: Cmd): string {
  if (cmd.kind === 'get-ax') return 'reading page…';
  if (cmd.kind === 'click') return 'clicking…';
  if (cmd.kind === 'type') return `typing "${cmd.text ?? ''}"…`;
  return cmd.kind;
}

// ---------------------------------------------------------------------------
// SSE stream — opened once, lives for the panel's lifetime.
// ---------------------------------------------------------------------------
let es: EventSource | null = null;

function openStream(): void {
  es?.close();
  if (!token) {
    // No token → the server would 401 the SSE GET; don't even open. Tell the user what to do.
    es = null;
    connEl.textContent = 'disconnected — paste the token from `webnav agent-serve` into settings';
    connEl.className = 'err';
    connEl.title = 'The agent server prints a token at startup. Open settings and paste it into the Token field.';
    return;
  }
  // EventSource can't set headers, so the per-run token rides as a query param (the server
  // accepts ?token= on the SSE GET and 401s a missing/wrong one).
  es = new EventSource(base + '/api/agent/events?token=' + encodeURIComponent(token));
  es.onopen = () => { connEl.textContent = 'connected'; connEl.className = 'ok'; };
  // EventSource auto-reconnects natively, so this flips back to 'connected' once the
  // server is up — the message tells a first-time user WHY it's down. A 401 (wrong/stale
  // token) also lands here; EventSource doesn't expose the status, so we name both likely
  // causes: server not running, or a token mismatch. ponytail: no manual retry loop needed.
  es.onerror = () => {
    connEl.textContent = 'disconnected — start `webnav agent-serve --port 7779` and paste its token into settings';
    connEl.className = 'err';
    connEl.title = 'The extension needs the local webnav agent server AND its token. Start it in a terminal:\n  webnav agent-serve --port 7779\nThen paste the printed token into settings. It reconnects automatically once both match.';
  };
  // EventSource natively skips `:`-comment keepalives; we only get real `data:` events.
  es.onmessage = (ev) => {
    let e: AgentEvent;
    try { e = JSON.parse(ev.data); } catch { return; }
    handleEvent(e);
  };
}

function handleEvent(e: AgentEvent): void {
  switch (e.type) {
    case 'turn':
      // Stream deltas into one assistant bubble until an action/done/error breaks it.
      if (!assistantBubble) assistantBubble = bubble('assistant');
      assistantBubble.textContent += e.text;
      thread.scrollTop = thread.scrollHeight;
      break;
    case 'narrate':
      // DISPLAY ONLY — the agent telling us what it did. Never CDP-execute this.
      assistantBubble = null;
      bubble('action', e.label + (e.detail ? ': ' + e.detail : ''));
      break;
    case 'action':
      // The REAL CDP command from the server's channel — this is the ONLY path that
      // runs execAction (and POSTs a command-result the server's loop awaits).
      assistantBubble = null; // a new turn after the action starts a fresh bubble
      bubble('action', narrateAction(e.cmd));
      execAction(e.id, e.cmd);
      break;
    case 'plan':
      assistantBubble = null;
      renderPlan(e.steps);
      break;
    case 'done':
      assistantBubble = null;
      bubble('done', '✓ done' + (e.summary ? ' — ' + e.summary : ''));
      finishRun();
      break;
    case 'error':
      assistantBubble = null;
      bubble('error', '✗ ' + e.message);
      finishRun();
      break;
  }
}

// ---------------------------------------------------------------------------
// Action execution — forward to background (CDP), POST the result back.
// ---------------------------------------------------------------------------
async function execAction(id: string, cmd: Cmd): Promise<void> {
  if (targetTabId == null) {
    await postResult(id, { ok: false, error: 'no target tab' });
    return;
  }
  let result: unknown;
  try {
    const r = await chrome.runtime.sendMessage({ type: 'exec-command', tabId: targetTabId, cmd });
    // background replies { ok, result?, error? }. get-ax → result is AXNode[]; the server
    // wants that raw array as command-result.result. click/type → result is {ok:true}.
    result = r?.ok
      ? r.result
      : { ok: false, error: r?.error ?? 'exec failed' };
  } catch (err) {
    result = { ok: false, error: String(err) };
  }
  await postResult(id, result);
}

// Every POST to the agent server carries the per-run token; the server 401s without it.
function postHeaders(): Record<string, string> {
  return { 'content-type': 'application/json', 'x-webnav-token': token };
}

async function postResult(id: string, result: unknown): Promise<void> {
  await fetch(base + '/api/agent/command-result', {
    method: 'POST', headers: postHeaders(),
    body: JSON.stringify({ id, result }),
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Approval gate (crit #3/#4). The plan bar now REALLY gates: the server's loop has
// emitted the plan and is BLOCKED on awaitApproval() — nothing drives until we POST
// /api/agent/approve. Approve → {approved:true} lets it run; Deny → {approved:false}
// aborts. Used in Ask (gates the whole run up front) and Auto (gates a cross-site goto).
// ---------------------------------------------------------------------------
function postApprove(approved: boolean): void {
  fetch(base + '/api/agent/approve', {
    method: 'POST', headers: postHeaders(),
    body: JSON.stringify({ approved }),
  }).catch(() => {});
}
function renderPlan(steps: string[]): void {
  const el = document.createElement('div');
  el.className = 'plan';
  const ol = document.createElement('ol');
  for (const s of steps) { const li = document.createElement('li'); li.textContent = s; ol.appendChild(li); }
  el.appendChild(ol);
  const barText = document.createElement('div');
  barText.style.cssText = 'font-size:11px;color:#888;margin-bottom:6px';
  barText.textContent = 'The agent is waiting — Approve to let it drive, or Deny to stop.';
  el.appendChild(barText);
  const bar = document.createElement('div');
  bar.className = 'bar';
  const approve = document.createElement('button');
  approve.className = 'approve'; approve.textContent = 'Approve';
  const deny = document.createElement('button');
  deny.className = 'deny'; deny.textContent = 'Deny';
  approve.onclick = () => { postApprove(true); bar.replaceWith(mkNote('✓ approved')); };
  // Deny releases the gate (approved:false); the server's loop returns without driving.
  deny.onclick = () => { postApprove(false); bar.replaceWith(mkNote('✗ denied')); };
  bar.appendChild(approve); bar.appendChild(deny);
  el.appendChild(bar);
  thread.appendChild(el);
  thread.scrollTop = thread.scrollHeight;
}
function mkNote(text: string): HTMLDivElement {
  const n = document.createElement('div');
  n.style.cssText = 'font-size:11px;color:#888';
  n.textContent = text;
  return n;
}

// ---------------------------------------------------------------------------
// Run lifecycle: attach CDP + tab-group scope, POST the goal.
// ---------------------------------------------------------------------------
async function startRun(): Promise<void> {
  const goal = goalEl.value.trim();
  if (!goal || running) return;
  await resolveTab();
  // If the active tab isn't drivable (chrome://, New Tab, blank, extension page), don't
  // refuse — open a fresh real tab and drive that. The agent goto()s to its real target.
  if (targetTabId == null || drivableReason(targetTabUrl)) {
    try {
      const t = await chrome.tabs.create({ active: true, url: START_URL });
      if (t.id == null) throw new Error('new tab has no id');
      targetTabId = t.id;
      targetTabUrl = START_URL;
      await waitTabComplete(t.id);
      bubble('action', 'opened a new tab to drive');
    } catch (e) {
      bubble('error', '✗ could not open a drivable tab: ' + String(e));
      return;
    }
  }

  // Resume-from-paused is just a fresh goal: clear the paused flag and re-scope the group.
  paused = false;
  running = true;
  sendEl.disabled = true;
  stopEl.classList.add('active');
  pauseEl.classList.add('active');
  bubble('user', goal);
  goalEl.value = '';

  // Persistent debugger attach for this run. No-op if already attached to this tab
  // (e.g. resuming from Pause, which deliberately left the attach live).
  const att = await chrome.runtime.sendMessage({ type: 'attach-drive', tabId: targetTabId });
  if (!att?.ok) { bubble('error', '✗ could not attach debugger: ' + (att?.error ?? '')); finishRun(); return; }

  // Scope the driven tab into a labelled 'webnav' group (differentiator / visual state).
  await scopeTabGroup(targetTabId);

  const res = await fetch(base + '/api/agent/goal', {
    method: 'POST', headers: postHeaders(),
    body: JSON.stringify({ goal, sessionId: sidEl.value, mode: mode.toLowerCase() }),
  }).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));
  if (!res?.ok) {
    const hint = res?.error === 'unauthorized'
      ? 'goal rejected: unauthorized — paste the token from `webnav agent-serve` into settings'
      : 'goal rejected: ' + (res?.error ?? '');
    bubble('error', '✗ ' + hint);
    finishRun();
  }
}

// Group + label the tab so the driven tab is visually scoped (Claude-extension parity).
// ponytail: title-label only for visual state — a "running/done" word on the group is the
// minimal honest indicator. Animated loading dots are deferrable (noted in README).
async function scopeTabGroup(tabId: number, title = 'webnav ● running'): Promise<void> {
  try {
    const groupId = await chrome.tabs.group({ tabIds: [tabId] });
    await chrome.tabGroups.update(groupId, { title, color: 'blue' });
  } catch { /* tabGroups can fail on some tab kinds; scoping is best-effort */ }
}
async function relabelTabGroup(tabId: number, title: string): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.groupId != null && tab.groupId >= 0) await chrome.tabGroups.update(tab.groupId, { title });
  } catch { /* best-effort */ }
}

function finishRun(): void {
  running = false;
  sendEl.disabled = false;
  stopEl.classList.remove('active');
  pauseEl.classList.remove('active');
  if (targetTabId != null) relabelTabGroup(targetTabId, 'webnav ✓');
}

async function stopRun(): Promise<void> {
  await fetch(base + '/api/agent/stop', { method: 'POST', headers: postHeaders() }).catch(() => {});
  bubble('done', 'loop halted');
  if (targetTabId != null) await chrome.runtime.sendMessage({ type: 'detach-drive' });
  paused = false;
  finishRun();
}

// Pause = honest take-over, NOT true mid-turn resume. The SDK `query` behind the server's
// agent loop is a single async generator; there is no cheap way to freeze and later replay
// its exact reasoning state. So Pause stops the loop (same /api/agent/stop the server
// already exposes — it rejects pending commands, which unwinds the current turn) but
// deliberately SKIPS detach-drive, keeping the CDP attach alive so the tab stays
// capture-able and re-drivable by hand. Resume is just sending a new goal: a fresh
// runAgentGoal call that re-snapshots the current page (get-ax), so it naturally picks up
// wherever the user left things — it does not "continue the old turn".
// ponytail: while paused, the user's manual clicks/types on the page are NOT captured in
// this increment (the full click→settle capture loop for manual driving is deferred — see
// README). Don't claim otherwise in the UI.
async function pauseRun(): Promise<void> {
  if (!running || paused) return;
  await fetch(base + '/api/agent/stop', { method: 'POST', headers: postHeaders() }).catch(() => {});
  paused = true;
  running = false;
  sendEl.disabled = false;
  stopEl.classList.remove('active');
  pauseEl.classList.remove('active');
  if (targetTabId != null) await relabelTabGroup(targetTabId, 'webnav ⏸ paused');
  bubble('done', 'paused — you have control. Interact with the page by hand, then send a new goal to resume (manual actions are not recorded yet). Resume starts a fresh turn from the current page.');
}

sendEl.onclick = startRun;
stopEl.onclick = stopRun;
pauseEl.onclick = pauseRun;
goalEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); startRun(); }
});

openStream();

// Watchdog: native EventSource auto-reconnect can settle into CLOSED and stay there
// (e.g. the server wasn't running at panel load). Re-open every 3s whenever the stream
// isn't OPEN/CONNECTING, so starting `webnav agent-serve` AFTER opening the panel flips
// it to 'connected' on its own — no more manual close-and-reopen. ponytail: a 3s poll is
// plenty for a localhost dev server; no exponential backoff needed.
setInterval(() => {
  if (!es || es.readyState === EventSource.CLOSED) openStream();
}, 3000);
