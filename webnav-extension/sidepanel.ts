// webnav-extension/sidepanel.ts
// The browser side of `webnav agent-serve`. Opens the SSE stream IN THE PANEL (the
// service worker idles and would drop a long-lived EventSource), renders Claude's reply
// deltas + action narration, and forwards each `action` command to background.ts to be
// executed over the persistent CDP debugger session — then POSTs the result back so the
// server's agent loop unblocks. See task-5-brief.md + the verified server contract.

type Cmd =
  | { kind: 'get-ax' | 'click' | 'type'; nodeId?: string; text?: string }
  | { kind: 'goto'; url?: string }
  | { kind: 'current-url' };
type AgentEvent =
  | { type: 'turn'; text: string }
  // `narrate` is display-only (what the agent did); NEVER execute it. `action` is the
  // real CDP command channel — only it goes through execAction.
  | { type: 'narrate'; label: string; detail?: string }
  | { type: 'action'; id: string; cmd: Cmd }
  | { type: 'done'; summary?: string }
  | { type: 'error'; message: string }
  | { type: 'plan'; steps: string[] };

// TODO(user-gated): visual load-unpacked pass — both light AND dark themes (contrast,
// chart-grid whisper, pin/rail alignment, done/error mask glyphs), the running
// activity strip + mark pulse + live-pin pulse (and that they stop under reduced-motion),
// the route-rail verb/target split against real server `narrate` events, and layout at
// ~320px. tsc + ID/wiring are verified; only a real render confirms the pixels.
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const thread = byId<HTMLDivElement>('thread');
const goalEl = byId<HTMLTextAreaElement>('goal');
const modeEl = byId<HTMLDivElement>('mode'); // segmented switch container (.modeswitch)
const modeHintEl = byId<HTMLDivElement>('mode-hint'); // #2: one-line selected-mode description
const modelEl = byId<HTMLSelectElement>('model'); // header model selector (native <select>)
const sendEl = byId<HTMLButtonElement>('send');
const stopEl = byId<HTMLButtonElement>('stop');
const pauseEl = byId<HTMLButtonElement>('pause');
const connEl = byId<HTMLSpanElement>('conn');
const connText = byId<HTMLSpanElement>('conn-text');
const tabEl = byId<HTMLSpanElement>('tab');
const activityStep = byId<HTMLSpanElement>('activity-step');
const jumpPill = byId<HTMLButtonElement>('jump-latest');

// The connection lamp keeps its .conn base class + lamp child; we only swap the
// ok/err state class and the text (never clobber connEl.className outright, or the
// lamp markup + pill chrome disappear).
function setConn(text: string, state: 'ok' | 'err' | '' , title?: string): void {
  connText.textContent = text;
  connEl.className = 'conn' + (state ? ' ' + state : '');
  if (title != null) connEl.title = title;
  // The empty-state prereq strip mirrors the connection: flip it green when connected.
  updateEmptyPrereq(state === 'ok');
  updateSendEnabled();
}

// Send is only meaningful with a non-empty goal AND a live connection. Disabled
// otherwise so a click that would silently no-op (empty) or 401 (no token) can't happen.
function updateSendEnabled(): void {
  if (running) return; // run-controls own the button state during a run
  sendEl.disabled = !goalEl.value.trim() || !connEl.classList.contains('ok');
}

const MODES = ['Ask', 'Act'] as const;
type Mode = (typeof MODES)[number];

// Launching from a chrome://, New-Tab, blank, or extension tab can't be driven (the CDP
// debugger refuses those, and about:blank isn't attachable either). Instead of refusing,
// we open a fresh REAL http(s) tab and drive that — the agent immediately goto()s to its
// real destination, so this is just a neutral drivable landing. The landing is webnav's
// OWN on-brand page served (unauthenticated) by agent-serve at /landing — http, so it's
// debugger-attachable (unlike about:blank / chrome:// / extension pages), and not an
// arbitrary google.com. Derived from `base` so it tracks a custom port.
function startUrl(): string {
  return base.replace(/\/+$/, '') + '/landing';
}

let mode: Mode = 'Ask';
// The SDK model the agent drives on. Default = Sonnet 5 (matches the <select>'s
// selected option); persisted under `agentModel` (DISTINCT from the `mode` key).
let agentModel = 'claude-sonnet-5';
let base = 'http://127.0.0.1:7779';
let token = ''; // per-run secret from `webnav agent-serve`; required on every request
let sid = 'agent-1'; // session id; edited in the options tab, read fresh at startRun
let lastGoal = ''; // the goal of the most recent run, for Retry on error
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
// Config lives in the options tab now (options.html). The panel only READS the
// stored values; keys are unchanged (sid/base/mode/token) so whatever options.ts
// writes, the panel picks up here — and reacts live via storage.onChanged.
// ---------------------------------------------------------------------------
chrome.storage.local.get(['sid', 'base', 'mode', 'token', 'agentModel']).then((s) => {
  if (s.sid) sid = s.sid as string;
  if (s.base) base = s.base as string;
  if (s.token) token = (s.token as string).trim();
  if (s.mode && (MODES as readonly string[]).includes(s.mode as string)) mode = s.mode as Mode;
  if (s.agentModel && isKnownModel(s.agentModel as string)) agentModel = s.agentModel as string;
  applyMode();
  applyModel();
  openStream(); // re-open once the persisted token is loaded
  // First-run: no token means the panel can't connect. Open the options tab so the
  // user can paste it, instead of leaving them staring at "no token".
  if (!token) chrome.runtime.openOptionsPage();
});

// Editing base/token/sid in the options tab must update the live panel without a
// reload. base/token changes re-open the SSE stream; sid is read fresh at startRun.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  let reopen = false;
  if (changes.base) { base = (changes.base.newValue as string) ?? base; reopen = true; }
  if (changes.token) { token = ((changes.token.newValue as string) ?? '').trim(); reopen = true; }
  if (changes.sid) sid = (changes.sid.newValue as string) ?? sid;
  if (changes.mode) {
    const m = changes.mode.newValue as string;
    if ((MODES as readonly string[]).includes(m)) { mode = m as Mode; applyMode(); }
  }
  if (changes.agentModel) {
    const m = changes.agentModel.newValue as string;
    if (isKnownModel(m)) { agentModel = m; applyModel(); }
  }
  if (reopen) openStream();
});

// One-line, honest description of what each mode gates (crit #3/#4). Shown as the
// button's tooltip so the three modes read as genuinely different, not cosmetic.
const MODE_HINT: Record<Mode, string> = {
  Ask: 'Ask: shows a plan and WAITS for your Approve before driving anything.',
  Act: 'Act: drives freely without confirmations (irreversible actions are still never auto-fired).',
};
// #2 — one-line description of the SELECTED mode, shown under the switch (updated in
// applyMode). Distinct from MODE_HINT (the hover tooltip) — this is the always-visible copy.
const MODE_DESC: Record<Mode, string> = {
  Ask: 'Shows a plan and waits for your approval before it does anything.',
  Act: 'Runs on its own. Irreversible steps (pay, place order, delete) still pause for you.',
};
const modeButtons = Array.from(modeEl.querySelectorAll<HTMLButtonElement>('button[data-mode]'));
function applyMode(): void {
  // Reflect the active mode on the segmented switch (aria-pressed drives the styling).
  for (const b of modeButtons) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  modeEl.title = MODE_HINT[mode];
  modeHintEl.textContent = MODE_DESC[mode]; // #2: keep the visible line in sync with the mode
}
// Each segment sets its mode directly (a clearer instrument than a blind cycle);
// the persisted-state + hint plumbing is unchanged.
for (const b of modeButtons) {
  b.onclick = () => {
    const m = b.dataset.mode as Mode;
    if (!(MODES as readonly string[]).includes(m)) return;
    mode = m;
    applyMode();
    chrome.storage.local.set({ mode });
  };
}

// Model selector (native <select>). Values ARE the SDK model ids; the option set is
// the source of truth for what's valid, so a stored/changed value is only honored if
// it still matches an <option> (stale ids fall back to the current selection).
function isKnownModel(v: string): boolean {
  return Array.from(modelEl.options).some((o) => o.value === v);
}
function applyModel(): void {
  modelEl.value = agentModel; // reflect restored state onto the control
}
modelEl.onchange = () => {
  if (!isKnownModel(modelEl.value)) return;
  agentModel = modelEl.value;
  chrome.storage.local.set({ agentModel });
};

// ---------------------------------------------------------------------------
// Target tab — the panel outlives tab switches, so re-query on activation.
// ---------------------------------------------------------------------------
let targetTabUrl = '';
// The header chip shows WHICH tab the agent is driving. Strips scheme for compactness;
// hidden (via :empty) when there's nothing drivable yet.
function renderTabChip(): void {
  let label = '';
  try {
    if (/^https?:\/\//i.test(targetTabUrl)) {
      const u = new URL(targetTabUrl);
      label = u.host + (u.pathname === '/' ? '' : u.pathname);
    }
  } catch { /* leave blank on unparseable url */ }
  tabEl.textContent = label;
  tabEl.title = targetTabUrl ? 'Driving: ' + targetTabUrl : 'Driving tab';
}
async function resolveTab(): Promise<void> {
  // The side panel is window-scoped, but we want the tab the USER is looking at. Prefer
  // the last-focused NORMAL browser window's active tab; fall back to the plain query.
  // (currentWindow from the panel can resolve oddly, and tab.url may be withheld — we no
  // longer treat a missing url as undrivable, so a partial answer is fine.)
  let tab: chrome.tabs.Tab | undefined;
  try {
    const win = await chrome.windows.getLastFocused({ populate: true, windowTypes: ['normal'] });
    tab = win.tabs?.find((t) => t.active);
  } catch { /* fall through */ }
  if (!tab) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  targetTabId = tab?.id ?? null;
  targetTabUrl = tab?.url ?? '';
  renderTabChip();
}
resolveTab();

// chrome.debugger cannot attach to chrome://, chrome-extension://, the Web Store, view-source:,
// about: or file:// pages — attach throws "Cannot access a chrome:// URL". Only http(s) tabs are
// drivable. Guard BEFORE attach so the user gets a clear reason, not a raw CDP error.
// Return a reason string ONLY when the current tab is KNOWN-undrivable (a scheme the
// CDP debugger genuinely refuses). Crucially: an EMPTY/unknown url is NOT treated as
// undrivable — Chrome withholds tab.url in many cases, and assuming "no url = undrivable"
// made the panel pop a new google tab even when you were on a real page. When we can't
// tell, DRIVE THE CURRENT TAB and let the attach be the authority (its failure is handled
// with a clear message). Only chrome://, extension, Web Store, about:, view-source:,
// file:// are known-undrivable — open a fresh tab only for those.
const UNDRIVABLE_SCHEME = /^(chrome|chrome-extension|about|view-source|file|edge|devtools):/i;
function drivableReason(url: string): string | null {
  if (url && UNDRIVABLE_SCHEME.test(url)) {
    return 'the agent can\'t drive this page (chrome:// / extension / file). Opened a normal tab instead.';
  }
  if (url && /^https?:\/\//i.test(url) && /^https:\/\/chromewebstore\.google\.com/i.test(url)) {
    return 'the agent can\'t drive the Chrome Web Store. Opened a normal tab instead.';
  }
  return null; // http(s), OR unknown/empty url → try driving the current tab
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
// First-run orientation. Lives inside #thread and is removed on the first message.
// Example chips fill the composer; the prereq strip mirrors the live connection state.
function renderEmpty(): void {
  if (thread.querySelector('.empty') || thread.querySelector('.msg')) return;
  const wrap = document.createElement('div');
  wrap.className = 'empty';
  wrap.innerHTML =
    '<span class="bigmark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c4.5-5 7-8.4 7-12A7 7 0 0 0 5 10c0 3.6 2.5 7 7 12z"/><circle cx="12" cy="10" r="2.6"/></svg></span>' +
    '<h2>Name a destination</h2>' +
    '<p>Describe where you want to go on this page, in plain words. The agent reads the page and drives it there — you watch every step.</p>' +
    '<div class="examples"></div>' +
    '<div class="prereq"><span>Needs the local server:</span> <code>webnav agent-serve --port 7779</code>' +
    '<span class="tok">then paste its token in <button type="button" class="lnk" id="open-opts">settings</button></span></div>';
  const examples = wrap.querySelector('.examples') as HTMLDivElement;
  for (const ex of ['Log in to this site', 'Search for something and open the first result', 'Fill out and submit the form on this page']) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ex'; b.textContent = ex;
    b.onclick = () => { goalEl.value = ex; goalEl.focus(); autosize(); updateSendEnabled(); };
    examples.appendChild(b);
  }
  const openOpts = wrap.querySelector('#open-opts') as HTMLButtonElement | null;
  if (openOpts) openOpts.onclick = () => chrome.runtime.openOptionsPage();
  thread.appendChild(wrap);
  updateEmptyPrereq(connEl.classList.contains('ok'));
}
// Flip the empty-state prereq strip green once the server is connected — the one
// real dependency, shown resolved. No-op when the empty state isn't rendered.
function updateEmptyPrereq(connected: boolean): void {
  const p = thread.querySelector('.empty .prereq');
  if (!p) return;
  p.classList.toggle('ok', connected);
  const lead = p.querySelector('span');
  if (lead) lead.textContent = connected ? 'Server connected:' : 'Needs the local server:';
}
function clearEmpty(): void {
  thread.querySelector('.empty')?.remove();
}

// Consecutive agent actions share one route rail. currentRoute is the open rail;
// any non-action message closes it.
let currentRoute: HTMLDivElement | null = null;

// Only yank to the bottom if the user is already there (within 40px); otherwise leave
// their scroll position and show the jump-to-latest pill so they can return in one click.
function scrollThreadIfNearBottom(): void {
  const nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 40;
  if (nearBottom) thread.scrollTop = thread.scrollHeight;
  else jumpPill.classList.add('show');
}

// ---------------------------------------------------------------------------
// #5 — light markdown renderer (XSS-safe, streaming-safe).
// Model text is UNTRUSTED. The one hard rule: escape HTML FIRST, then apply the
// markdown regex passes to the ESCAPED text — so a `<script>` in the reply can never
// become live markup, only visible text. Code spans are lifted to placeholders before
// bold/italic so `*` inside code isn't styled. Streaming-safe because callers keep the
// RAW accumulated text and re-render the whole buffer on each delta (see renderMarkdown).
// ---------------------------------------------------------------------------
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function mdToHtml(raw: string): string {
  let s = escapeHtml(raw);
  // Lift code spans out FIRST (on escaped text) so their contents dodge bold/italic/list
  // passes; restore at the end. Fenced ``` blocks before inline ` so the fence wins.
  // Placeholder wraps the index in a control-char sentinel (never in model prose) so it
  // can't collide with a bare digit and isn't mistaken for a list line or a newline.
  const codes: string[] = [];
  const stash = (html: string): string => '\x01' + (codes.push(html) - 1) + '\x01';
  s = s.replace(/```([\s\S]*?)```/g, (_m, c) => stash('<pre><code>' + c.replace(/^\n/, '') + '</code></pre>'));
  s = s.replace(/`([^`\n]+)`/g, (_m, c) => stash('<code>' + c + '</code>'));
  // Inline emphasis (bold before italic so `**x**` isn't eaten by the single-* rule).
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  // Lists: group consecutive `- ` / `1.` lines into one <ul>/<ol>. Build line by line.
  const lines = s.split('\n');
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  const closeList = (): void => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const line of lines) {
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ul) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push('<li>' + ul[1] + '</li>');
    } else if (ol) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push('<li>' + ol[1] + '</li>');
    } else {
      closeList();
      out.push(line);
    }
  }
  closeList();
  // Line breaks: join non-list lines with <br>; list tags already carry their own layout.
  s = out.join('\n').replace(/\n(?![<])/g, '<br>').replace(/\n/g, '');
  // Restore code spans.
  s = s.replace(/\x01(\d+)\x01/g, (_m, i) => codes[Number(i)]);
  return s;
}

// Render markdown into a bubble, keeping the RAW text in a data-attr so streaming deltas
// re-render the full buffer (never innerHTML raw model text) and copy grabs the raw text.
function renderMarkdown(el: HTMLElement, raw: string): void {
  el.dataset.raw = raw;
  el.innerHTML = mdToHtml(raw);
}

// Self-check (crit #5) — asserts bold renders AND that HTML in model text is escaped
// (XSS). Runs once at module load; throws loudly in dev if the renderer regresses.
function mdSelfCheck(): void {
  const bold = mdToHtml('**x**');
  if (!bold.includes('<strong>x</strong>')) throw new Error('md: **x** should render <strong>');
  const xss = mdToHtml('<script>alert(1)</script>');
  if (xss.includes('<script>')) throw new Error('md: raw <script> must be escaped');
  if (!xss.includes('&lt;script&gt;')) throw new Error('md: script tag should be escaped to entities');
  const code = mdToHtml('`a*b*c`');
  if (!code.includes('<code>a*b*c</code>')) throw new Error('md: * inside code must not italicize');
}
mdSelfCheck();

const COPY_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';

// Hover copy button — writes the bubble's text (not the button glyph) to the clipboard.
function addCopyButton(el: HTMLElement): void {
  const btn = document.createElement('button');
  btn.className = 'copy-btn'; btn.type = 'button';
  btn.title = 'Copy'; btn.setAttribute('aria-label', 'Copy message');
  btn.innerHTML = COPY_SVG;
  btn.onclick = () => {
    // Markdown-rendered bubbles keep the RAW source in data-raw — copy THAT (with the
    // `**`/backticks), not the rendered HTML's text. Otherwise copy the message text only,
    // skipping the control buttons (this copy button + any Retry) so labels don't leak.
    const text = el.dataset.raw != null
      ? el.dataset.raw
      : Array.from(el.childNodes)
          .filter((n) => !(n instanceof HTMLElement && n.tagName === 'BUTTON'))
          .map((n) => n.textContent ?? '').join('');
    navigator.clipboard.writeText(text.trim()).then(() => {
      btn.classList.add('copied'); setTimeout(() => btn.classList.remove('copied'), 900);
    }).catch(() => {});
  };
  el.appendChild(btn);
}

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

function bubble(kind: string, text = ''): HTMLDivElement {
  clearEmpty();
  if (kind === 'action') return actionRow(text);
  currentRoute = null; // any other message ends the current route rail
  const el = document.createElement('div');
  el.className = 'msg ' + kind;
  el.textContent = text;
  // done/error carry final text, so the copy button is safe to attach now. Assistant
  // bubbles stream via `textContent +=` (which would clobber a child button), so their
  // copy button is attached in endTurn() once the text is final.
  if (kind === 'done' || kind === 'error') addCopyButton(el);
  thread.appendChild(el);
  scrollThreadIfNearBottom();
  return el;
}

// An action row on the route rail, with the verb/target typographic split (the
// verb in accent mono, the object distinct). The most recent action gets `.live`
// (filled, pulsing pin); the prior live row is demoted. Text is the narrate line,
// usually "verb: target" — split on the first ": ", else the first word.
function actionRow(text: string): HTMLDivElement {
  if (!currentRoute) {
    currentRoute = document.createElement('div');
    currentRoute.className = 'route';
    currentRoute.setAttribute('role', 'log');
    currentRoute.setAttribute('aria-label', 'Agent route');
    thread.appendChild(currentRoute);
  }
  currentRoute.querySelector('.msg.action.live')?.classList.remove('live');
  const el = document.createElement('div');
  el.className = 'msg action live';
  const sep = text.indexOf(': ');
  const [verb, target] = sep >= 0
    ? [text.slice(0, sep), text.slice(sep + 2)]
    : (() => { const s = text.indexOf(' '); return s >= 0 ? [text.slice(0, s), text.slice(s + 1)] : [text, '']; })();
  const v = document.createElement('span'); v.className = 'verb'; v.textContent = verb;
  el.appendChild(v);
  if (target) { const t = document.createElement('span'); t.className = 'target'; t.textContent = ' ' + target; el.appendChild(t); }
  currentRoute.appendChild(el);
  scrollThreadIfNearBottom();
  return el;
}

// Kept for a friendly label even though the `action` handler no longer renders its own
// bubble (ITEM 1 — `narrate` is the one displayed line per action); this stays the single
// place that maps a raw Cmd to human text, for any future caller that needs one.
function narrateAction(cmd: Cmd): string {
  if (cmd.kind === 'get-ax') return 'reading page…';
  if (cmd.kind === 'click') return 'clicking…';
  if (cmd.kind === 'type') return `typing "${cmd.text ?? ''}"…`;
  if (cmd.kind === 'goto') return cmd.url ? `navigating to ${cmd.url}…` : 'navigating…';
  if (cmd.kind === 'current-url') return 'reading address…';
  return (cmd as { kind: string }).kind;
}

// #3b — the SDK exposes webnav's tools as an in-process MCP server, so tool_use names
// can arrive as `mcp__webnav__<tool>`. That raw string must NEVER reach the user. loop.ts
// already humanizes at the source; this is the defensive strip so any label reaching the
// panel is friendly regardless of path. Humanize the internal-sounding verbs; click/type/
// goto already read fine.
const FRIENDLY_LABEL: Record<string, string> = {
  check_route: 'checking the map',
  get_page_ax: 'reading the page',
};
function friendlyLabel(raw: string): string {
  const name = raw.replace(/^mcp__webnav__/, '');
  return FRIENDLY_LABEL[name] ?? name;
}

// Close the current streaming assistant bubble (drop the caret) and null it so the
// next `turn` starts a fresh one. Replaces the old `assistantBubble = null` lines.
function endTurn(): void {
  assistantBubble?.classList.remove('streaming');
  // Attach the copy button now that streaming is done — adding it earlier would have been
  // wiped by the delta re-renders. Skip empty bubbles.
  if (assistantBubble && (assistantBubble.textContent ?? '').trim()) addCopyButton(assistantBubble);
  assistantBubble = null;
}

// The blue pulsing `.live` pin means "a tool is running RIGHT NOW". Only the in-flight
// action should pulse; once the agent moves on (starts talking, runs the next tool, or
// finishes) the completed row must settle to a plain dot like the others. Called from
// every event that means "the previous action is no longer the live one".
function settleLiveAction(): void {
  document.querySelectorAll('.msg.action.live').forEach((el) => el.classList.remove('live'));
}

// #6 — subtle completion. The SDK's final result text is usually IDENTICAL to the last
// streamed assistant turn (loop.ts sets finalText = last result). So:
//   - no summary, or a summary that duplicates the last streamed text → don't render a
//     second bubble; just tag the last assistant message with a quiet ✓.
//   - a genuinely-new summary → render it as a normal assistant-style markdown message
//     with a small ✓, NOT a loud green box.
// `lastEl` is the still-open streaming assistant bubble (captured BEFORE endTurn nulls it).
function renderDone(lastEl: HTMLDivElement | null, summary?: string): void {
  const sum = (summary ?? '').trim();
  const last = (lastEl?.dataset.raw ?? '').trim();
  // Only a NON-empty last message can be a duplicate — an empty stream means the summary
  // is genuinely new and must render.
  const duplicates = sum !== '' && last !== '' && (sum === last || last.endsWith(sum) || sum.endsWith(last));
  if (sum === '' || duplicates) {
    // Nothing new to say — mark the last assistant message complete with a subtle ✓.
    if (lastEl) lastEl.classList.add('done-tick');
    return;
  }
  // A new closing summary: render it as assistant-style prose (markdown, subtle ✓ rule).
  clearEmpty();
  currentRoute = null;
  const el = document.createElement('div');
  el.className = 'msg done';
  renderMarkdown(el, sum);
  addCopyButton(el);
  thread.appendChild(el);
  scrollThreadIfNearBottom();
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
    setConn('no token', 'err',
      'The agent server prints a token at startup. Open settings and paste it into the Token field.');
    return;
  }
  // EventSource can't set headers, so the per-run token rides as a query param (the server
  // accepts ?token= on the SSE GET and 401s a missing/wrong one).
  es = new EventSource(base + '/api/agent/events?token=' + encodeURIComponent(token));
  es.onopen = () => setConn('connected', 'ok', 'Connected to the local webnav server');
  // EventSource auto-reconnects natively, so this flips back to 'connected' once the
  // server is up — the message tells a first-time user WHY it's down. A 401 (wrong/stale
  // token) also lands here; EventSource doesn't expose the status, so we name both likely
  // causes: server not running, or a token mismatch. ponytail: no manual retry loop needed.
  es.onerror = () => setConn('disconnected', 'err',
    'The extension needs the local webnav agent server AND its token. Start it in a terminal:\n  webnav agent-serve --port 7779\nThen paste the printed token into settings. It reconnects automatically once both match.');
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
      // `.streaming` draws the caret; endTurn() removes it when the bubble is closed.
      // #5: accumulate the RAW text and re-render the whole buffer as markdown each delta
      // (never innerHTML raw model text — mdToHtml escapes first).
      // The agent is talking now, not acting — settle any still-pulsing action row.
      if (!assistantBubble) settleLiveAction();
      if (!assistantBubble) { assistantBubble = bubble('assistant'); assistantBubble.classList.add('streaming'); }
      renderMarkdown(assistantBubble, (assistantBubble.dataset.raw ?? '') + e.text);
      scrollThreadIfNearBottom();
      break;
    case 'narrate': {
      // DISPLAY ONLY — the agent telling us what it did. Never CDP-execute this.
      endTurn();
      // #3b — strip any `mcp__webnav__` prefix + humanize before it ever renders.
      const label = friendlyLabel(e.label);
      // Show the driven step in the activity strip too (the live "what it's doing" readout).
      activityStep.textContent = e.detail ? label + ': ' + e.detail : label;
      bubble('action', label + (e.detail ? ': ' + e.detail : ''));
      break;
    }
    case 'action':
      // The REAL CDP command from the server's channel — this is the ONLY path that
      // runs execAction (and POSTs a command-result the server's loop awaits). The
      // human-readable line for this same tool call was already rendered by `narrate`
      // (which always precedes the matching `action`) — don't render a second bubble here.
      endTurn(); // a new turn after the action starts a fresh bubble
      execAction(e.id, e.cmd);
      break;
    case 'plan':
      endTurn();
      renderPlan(e.steps);
      break;
    case 'done':
      // #6 — subtle completion. Pass the still-open assistant bubble BEFORE endTurn nulls
      // it, so we can dedupe (the SDK's final result IS usually the last streamed turn —
      // don't render it twice) or tick that bubble in place.
      renderDone(assistantBubble, e.summary);
      endTurn();
      finishRun();
      break;
    case 'error': {
      endTurn();
      const el = bubble('error', e.message);
      if (lastGoal) addRetryButton(el, lastGoal);
      finishRun();
      break;
    }
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
// The currently-open plan bar (Ask up-front, or an Auto cross-site gate). Tracked so a
// stale bar can be resolved on deny AND on run-end — H3: an Auto denial (or the run
// otherwise ending) must never leave a live Approve/Deny bar dangling. Cleared to a
// resolved note, never left interactive once its gate is gone.
let pendingPlanBar: HTMLDivElement | null = null;

const PIN_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c4.5-5 7-8.4 7-12A7 7 0 0 0 5 10c0 3.6 2.5 7 7 12z"/><circle cx="12" cy="10" r="2.6"/></svg>';

function resolvePlanBar(note: string): void {
  if (!pendingPlanBar) return;
  const resolved = document.createElement('div');
  resolved.className = 'resolved';
  resolved.textContent = note;
  pendingPlanBar.replaceWith(resolved);
  pendingPlanBar = null;
}

function renderPlan(steps: string[]): void {
  clearEmpty();
  currentRoute = null;
  // A prior unresolved gate is superseded by this one — resolve it first (no dangling bars).
  resolvePlanBar('◦ superseded');
  const el = document.createElement('div');
  el.className = 'plan';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Proposed plan');

  const head = document.createElement('div');
  head.className = 'head';
  const pin = document.createElement('span');
  pin.className = 'pin'; pin.innerHTML = PIN_SVG;
  head.appendChild(pin);
  head.appendChild(document.createTextNode('Proposed route'));
  el.appendChild(head);

  const ol = document.createElement('ol');
  for (const s of steps) { const li = document.createElement('li'); li.textContent = s; ol.appendChild(li); }
  el.appendChild(ol);

  const note = document.createElement('div');
  note.className = 'note';
  note.textContent = 'Waiting — Approve to let it drive, or Deny to stop.';
  el.appendChild(note);

  const bar = document.createElement('div');
  bar.className = 'bar';
  const approve = document.createElement('button');
  approve.className = 'approve'; approve.textContent = 'Approve & run';
  const deny = document.createElement('button');
  deny.className = 'deny'; deny.textContent = 'Deny';
  approve.onclick = () => { postApprove(true); resolvePlanBar('✓ approved'); };
  // Deny releases the gate (approved:false); the server's loop returns without driving.
  deny.onclick = () => { postApprove(false); resolvePlanBar('✗ denied'); };
  bar.appendChild(approve); bar.appendChild(deny);
  el.appendChild(bar);
  pendingPlanBar = bar;

  thread.appendChild(el);
  thread.scrollTop = thread.scrollHeight;
}

// ---------------------------------------------------------------------------
// Run lifecycle: attach CDP + tab-group scope, POST the goal.
// ---------------------------------------------------------------------------
async function startRun(): Promise<void> {
  const goal = goalEl.value.trim();
  if (!goal || running) return;
  lastGoal = goal; // B4: remember it so an error can offer Retry
  await resolveTab();
  // If the active tab isn't drivable (chrome://, New Tab, blank, extension page), don't
  // refuse — open a fresh real tab and drive that. The agent goto()s to its real target.
  if (targetTabId == null || drivableReason(targetTabUrl)) {
    try {
      const landing = startUrl();
      const t = await chrome.tabs.create({ active: true, url: landing });
      if (t.id == null) throw new Error('new tab has no id');
      targetTabId = t.id;
      targetTabUrl = landing;
      await waitTabComplete(t.id);
      bubble('action', 'opened a tab to drive from');
    } catch (e) {
      bubble('error', '✗ could not open a drivable tab: ' + String(e));
      return;
    }
  }

  // Resume-from-paused is just a fresh goal: clear the paused flag and re-scope the group.
  paused = false;
  running = true;
  sendEl.disabled = true;
  // body.running swaps Send → Take-over/Stop, shows the activity strip, pulses the mark.
  document.body.classList.add('running');
  activityStep.textContent = 'working…';
  renderTabChip();
  bubble('user', goal);
  goalEl.value = '';
  autosize();

  // Persistent debugger attach for this run. No-op if already attached to this tab
  // (e.g. resuming from Pause, which deliberately left the attach live).
  const att = await chrome.runtime.sendMessage({ type: 'attach-drive', tabId: targetTabId });
  if (!att?.ok) { bubble('error', '✗ could not attach debugger: ' + (att?.error ?? '')); finishRun(); return; }

  const res = await fetch(base + '/api/agent/goal', {
    method: 'POST', headers: postHeaders(),
    body: JSON.stringify({ goal, sessionId: sid, mode: mode.toLowerCase(), model: agentModel }),
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
// (Tab-group scoping was removed: grouping/ungrouping the single driven tab around a run
// — combined with the debugger detach at teardown — was closing the user's tab, and it
// added little. The driven tab is just left as-is; run state shows in the panel, not via
// a tab group. See the header conn lamp + activity strip for "is it working".)

function finishRun(): void {
  running = false;
  sendEl.disabled = false;
  document.body.classList.remove('running');
  currentRoute?.querySelector('.msg.action.live')?.classList.remove('live');
  currentRoute = null;
  // H3: never leave an Approve/Deny bar live once the run has ended (e.g. an Auto
  // cross-site goto that was denied, or any stop/done/error while a gate was open).
  resolvePlanBar('◦ run ended');
  // A finished run with an empty composer / lost connection must re-disable Send;
  // the `sendEl.disabled = false` above is unconditional, so re-derive the real state.
  updateSendEnabled();
}

async function stopRun(): Promise<void> {
  await fetch(base + '/api/agent/stop', { method: 'POST', headers: postHeaders() }).catch(() => {});
  bubble('done', 'loop halted');
  if (targetTabId != null) await chrome.runtime.sendMessage({ type: 'detach-drive' });
  paused = false;
  finishRun();
}

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
  jumpPill.classList.remove('show');

  renderEmpty();             // first-run orientation again
  updateEmptyPrereq(connEl.classList.contains('ok'));
  goalEl.value = '';
  autosize();
  await resolveTab();        // re-point at the user's CURRENT tab (not stale state) so the
                             // next goal drives what they're looking at, not a new google tab
  updateSendEnabled();       // B5: reflect empty composer
  goalEl.focus();
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
  document.body.classList.remove('running');
  currentRoute?.querySelector('.msg.action.live')?.classList.remove('live');
  currentRoute = null;
  resolvePlanBar('◦ paused'); // H3: a gate open at pause is no longer actionable
  bubble('done', 'paused — you have control. Interact with the page by hand, then send a new goal to resume (manual actions are not recorded yet). Resume starts a fresh turn from the current page.');
}

// Composer auto-grows with content up to its CSS max-height (design has rows="1").
function autosize(): void {
  goalEl.style.height = 'auto';
  goalEl.style.height = Math.min(goalEl.scrollHeight, 140) + 'px';
}
goalEl.addEventListener('input', () => { autosize(); updateSendEnabled(); });

// The header gear opens the full options page in a browser tab (Claude-style).
byId<HTMLButtonElement>('settings-toggle').onclick = () => chrome.runtime.openOptionsPage();
byId<HTMLButtonElement>('new-chat').onclick = resetChat;

// Jump-to-latest pill: snap to the bottom and hide it; also hide once the user scrolls
// back to the bottom on their own.
jumpPill.onclick = () => { thread.scrollTop = thread.scrollHeight; jumpPill.classList.remove('show'); };
thread.addEventListener('scroll', () => {
  if (thread.scrollHeight - thread.scrollTop - thread.clientHeight < 40) jumpPill.classList.remove('show');
});

sendEl.onclick = startRun;
stopEl.onclick = stopRun;
pauseEl.onclick = pauseRun;
// Enter sends; Shift+Enter inserts a newline (Claude/ChatGPT/Slack convention).
// !isComposing guards IME: Enter mid-composition commits the candidate, doesn't send.
goalEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); startRun(); }
});

renderEmpty(); // first-run orientation until the first message
openStream();
updateSendEnabled();

// Watchdog: native EventSource auto-reconnect can settle into CLOSED and stay there
// (e.g. the server wasn't running at panel load). Re-open every 3s whenever the stream
// isn't OPEN/CONNECTING, so starting `webnav agent-serve` AFTER opening the panel flips
// it to 'connected' on its own — no more manual close-and-reopen. ponytail: a 3s poll is
// plenty for a localhost dev server; no exponential backoff needed.
setInterval(() => {
  if (!es || es.readyState === EventSource.CLOSED) openStream();
}, 3000);
