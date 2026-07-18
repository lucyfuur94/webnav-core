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
const connEl = byId<HTMLSpanElement>('conn');
const sidEl = byId<HTMLInputElement>('sid');
const baseEl = byId<HTMLInputElement>('base');

const MODES = ['Ask', 'Auto', 'Act'] as const;
type Mode = (typeof MODES)[number];

let mode: Mode = 'Ask';
let base = 'http://127.0.0.1:7779';
let targetTabId: number | null = null;
let running = false;
let assistantBubble: HTMLDivElement | null = null; // current streaming assistant reply

// ---------------------------------------------------------------------------
// Config persistence (chrome.storage) — mirrors the popup pattern.
// ---------------------------------------------------------------------------
chrome.storage.local.get(['sid', 'base', 'mode']).then((s) => {
  if (s.sid) sidEl.value = s.sid as string;
  if (s.base) { baseEl.value = s.base as string; base = s.base as string; }
  if (s.mode && (MODES as readonly string[]).includes(s.mode as string)) mode = s.mode as Mode;
  modeEl.textContent = mode;
});
baseEl.onchange = () => { base = baseEl.value; chrome.storage.local.set({ base }); };
sidEl.onchange = () => chrome.storage.local.set({ sid: sidEl.value });

modeEl.onclick = () => {
  mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
  modeEl.textContent = mode;
  chrome.storage.local.set({ mode });
};

// ---------------------------------------------------------------------------
// Target tab — the panel outlives tab switches, so re-query on activation.
// ---------------------------------------------------------------------------
async function resolveTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  targetTabId = tab?.id ?? null;
}
resolveTab();
chrome.tabs.onActivated.addListener(() => { if (!running) resolveTab(); });

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
  es = new EventSource(base + '/api/agent/events');
  es.onopen = () => { connEl.textContent = 'connected'; connEl.className = 'ok'; };
  es.onerror = () => { connEl.textContent = 'disconnected'; connEl.className = ''; };
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

async function postResult(id: string, result: unknown): Promise<void> {
  await fetch(base + '/api/agent/command-result', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, result }),
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Ask-mode plan gate.
// ---------------------------------------------------------------------------
// The server ALREADY started the run (POST /goal responded ok and streams). Simpler
// correct wiring per the brief: show the plan; Approve just dismisses the bar and the
// server proceeds on its own; Deny POSTs /stop to abort the run. (We do not re-POST the
// goal on approve — that would start a second run.)
function renderPlan(steps: string[]): void {
  const el = document.createElement('div');
  el.className = 'plan';
  const ol = document.createElement('ol');
  for (const s of steps) { const li = document.createElement('li'); li.textContent = s; ol.appendChild(li); }
  el.appendChild(ol);
  const barText = document.createElement('div');
  barText.style.cssText = 'font-size:11px;color:#888;margin-bottom:6px';
  barText.textContent = 'Approve to let the agent proceed, or Deny to stop.';
  el.appendChild(barText);
  const bar = document.createElement('div');
  bar.className = 'bar';
  const approve = document.createElement('button');
  approve.className = 'approve'; approve.textContent = 'Approve';
  const deny = document.createElement('button');
  deny.className = 'deny'; deny.textContent = 'Deny';
  approve.onclick = () => { bar.replaceWith(mkNote('✓ approved')); };
  deny.onclick = () => { stopRun(); bar.replaceWith(mkNote('✗ denied — stopped')); };
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
  if (targetTabId == null) { bubble('error', '✗ no active tab to drive'); return; }

  running = true;
  sendEl.disabled = true;
  stopEl.classList.add('active');
  bubble('user', goal);
  goalEl.value = '';

  // Persistent debugger attach for this run.
  const att = await chrome.runtime.sendMessage({ type: 'attach-drive', tabId: targetTabId });
  if (!att?.ok) { bubble('error', '✗ could not attach debugger: ' + (att?.error ?? '')); finishRun(); return; }

  // Scope the driven tab into a labelled 'webnav' group (differentiator / visual state).
  await scopeTabGroup(targetTabId);

  const res = await fetch(base + '/api/agent/goal', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ goal, sessionId: sidEl.value, mode: mode.toLowerCase() }),
  }).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));
  if (!res?.ok) { bubble('error', '✗ goal rejected: ' + (res?.error ?? '')); finishRun(); }
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
  if (targetTabId != null) relabelTabGroup(targetTabId, 'webnav ✓');
}

async function stopRun(): Promise<void> {
  await fetch(base + '/api/agent/stop', { method: 'POST' }).catch(() => {});
  bubble('done', 'loop halted');
  if (targetTabId != null) await chrome.runtime.sendMessage({ type: 'detach-drive' });
  finishRun();
}

sendEl.onclick = startRun;
stopEl.onclick = stopRun;
goalEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); startRun(); }
});

openStream();
