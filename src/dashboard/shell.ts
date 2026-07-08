// The dashboard shell: a single self-contained page (vanilla JS + fetch) for the
// SITES and CREDENTIALS operator views. No build step — matches webnav's ethos
// for its OWN UI; the heavy xyflow graph viewer is the separate web/dist bundle,
// linked from here as the "Graph" tab (opens /graph). Kept deliberately plain.
export const SHELL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>webnav dashboard</title>
<style>
  :root { color-scheme: dark; --bg:#0f1115; --panel:#171a21; --border:#262b36; --fg:#e6e9ef; --muted:#8b93a3; --accent:#5b9dff; --danger:#ff6b6b; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:var(--bg); color:var(--fg); }
  header { display:flex; align-items:center; gap:16px; padding:14px 20px; border-bottom:1px solid var(--border); }
  header h1 { font-size:16px; margin:0; font-weight:600; }
  header .sub { color:var(--muted); font-size:12px; }
  nav { display:flex; gap:4px; padding:0 20px; border-bottom:1px solid var(--border); }
  nav button, nav a { background:none; border:none; color:var(--muted); padding:10px 14px; cursor:pointer; font:inherit; text-decoration:none; border-bottom:2px solid transparent; }
  nav button.active { color:var(--fg); border-bottom-color:var(--accent); }
  nav a:hover, nav button:hover { color:var(--fg); }
  main { padding:20px; display:grid; grid-template-columns:280px 1fr; gap:20px; }
  .list { border:1px solid var(--border); border-radius:8px; overflow:hidden; align-self:start; }
  .list .row { padding:10px 12px; cursor:pointer; border-bottom:1px solid var(--border); }
  .list .row:last-child { border-bottom:none; }
  .list .row:hover { background:var(--panel); }
  .list .row.active { background:var(--panel); border-left:2px solid var(--accent); }
  .list .row .name { font-weight:500; }
  .list .row .meta { color:var(--muted); font-size:12px; }
  .detail { border:1px solid var(--border); border-radius:8px; padding:16px; min-height:200px; }
  pre { background:#0b0d11; border:1px solid var(--border); border-radius:6px; padding:12px; overflow:auto; font-size:12px; max-height:70vh; }
  table { width:100%; border-collapse:collapse; }
  td, th { text-align:left; padding:8px 10px; border-bottom:1px solid var(--border); }
  th { color:var(--muted); font-weight:500; font-size:12px; }
  code.val { font-family:ui-monospace,monospace; }
  button.btn { background:var(--panel); border:1px solid var(--border); color:var(--fg); border-radius:6px; padding:5px 10px; cursor:pointer; font:inherit; }
  button.btn:hover { border-color:var(--accent); }
  button.btn.danger:hover { border-color:var(--danger); color:var(--danger); }
  .addrow input, .addrow select { background:#0b0d11; border:1px solid var(--border); color:var(--fg); border-radius:6px; padding:6px 8px; font:inherit; margin-right:6px; }
  select { background:#0b0d11; border:1px solid var(--border); color:var(--fg); border-radius:6px; padding:4px 6px; font:inherit; }
  input.inline { background:#0b0d11; border:1px solid var(--accent); color:var(--fg); border-radius:6px; padding:5px 8px; font:ui-monospace,monospace; width:90%; }
  .cat-head { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.04em; margin:10px 0 2px; }
  .muted { color:var(--muted); }
  .empty { color:var(--muted); padding:40px 0; text-align:center; }
  .pulse { animation: webnavpulse 1.2s ease-in-out infinite; }
  @keyframes webnavpulse { 50% { opacity:.35; } }
</style>
</head>
<body>
<header>
  <h1>webnav dashboard</h1>
  <span class="sub" id="env"></span>
</header>
<nav>
  <button data-tab="recordings" class="active">Recordings</button>
  <button data-tab="sites">Sites</button>
  <button data-tab="creds">Credentials</button>
</nav>
<main id="main"></main>

<script>
const main = document.getElementById('main');
let tab = 'recordings';

document.querySelectorAll('nav button[data-tab]').forEach(b => {
  b.onclick = () => {
    tab = b.dataset.tab;
    document.querySelectorAll('nav button').forEach(x => x.classList.toggle('active', x === b));
    render();
  };
});

async function getJSON(u, opts) { const r = await fetch(u, opts); if (!r.ok) throw new Error(u + ' -> ' + r.status); return r.json(); }
function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

async function render() {
  if (replayPoll) { clearInterval(replayPoll); replayPoll = null; }   // no stray status polls across tab switches (review finding)
  main.innerHTML = '<div class="empty">loading…</div>';
  main.style.gridTemplateColumns = tab === 'sites' ? '280px 1fr' : '1fr';
  if (tab === 'sites') return renderSites();
  if (tab === 'creds') return renderCreds();
  if (tab === 'recordings') return renderRecordings();
}

// ---------- SITES ----------
async function renderSites() {
  const sites = await getJSON('/api/sites');
  main.innerHTML = '';
  const list = el('<div class="list"></div>');
  const detail = el('<div class="detail"><div class="empty">select a site to see its JSON map</div></div>');
  if (!sites.length) list.append(el('<div class="empty">no sites mapped yet</div>'));
  sites.forEach(s => {
    const row = el('<div class="row"><div class="name">'+esc(s.id)+'</div><div class="meta">'+s.stateCount+' states · '+esc((s.capabilities||[]).join(', ')||'—')+'</div></div>');
    row.onclick = async () => {
      list.querySelectorAll('.row').forEach(r => r.classList.remove('active'));
      row.classList.add('active');
      detail.innerHTML = '<div class="empty">loading…</div>';
      const full = await getJSON('/api/sites/' + encodeURIComponent(s.id));
      detail.innerHTML = '';
      detail.append(el('<div style="margin-bottom:10px"><strong>'+esc(s.id)+'</strong> <span class="muted">'+esc(s.homeUrl)+'</span></div>'));
      detail.append(el('<pre>'+esc(JSON.stringify(full, null, 2))+'</pre>'));
    };
    list.append(row);
  });
  main.append(list, detail);
}

// ---------- CREDENTIALS ----------
const CATEGORIES = [
  { key: 'login', label: 'Login credentials' },
  { key: 'personal', label: 'Personal info' },
  { key: 'other', label: 'Other' },
];
function catLabel(c) { const f = CATEGORIES.find(x => x.key === c); return f ? f.label : c; }

async function renderCreds() {
  const sites = await getJSON('/api/creds');   // [{site, keys:[{name,category}]}]
  main.innerHTML = '';
  main.style.gridTemplateColumns = '1fr';
  const wrap = el('<div></div>');
  if (!sites.length) wrap.append(el('<div class="empty">no credentials stored. Add one below for any site.</div>'));
  sites.forEach(s => wrap.append(credCard(s.site, s.keys)));
  wrap.append(addSiteCard());
  main.append(wrap);
}

function credCard(site, keys) {
  const card = el('<div class="detail" style="margin-bottom:16px"></div>');
  card.append(el('<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><strong>'+esc(site)+'</strong></div>'));

  // group keys by category, in CATEGORIES order; skip empty groups
  CATEGORIES.forEach(cat => {
    const inCat = keys.filter(k => k.category === cat.key);
    if (!inCat.length) return;
    card.append(el('<div class="cat-head">'+esc(cat.label)+'</div>'));
    const table = el('<table><tbody></tbody></table>');
    const tbody = table.querySelector('tbody');
    inCat.forEach(k => tbody.append(credRow(site, k.name, k.category)));
    card.append(table);
  });

  // add-key row (category inferred server-side from the key name)
  const add = el('<div class="addrow" style="margin-top:12px"><input placeholder="key (e.g. username)" /><input placeholder="value" type="password" />'+catSelect()+'<button class="btn">Add</button></div>');
  const [keyIn, valIn] = add.querySelectorAll('input');
  const catSel = add.querySelector('select');
  add.querySelector('button').onclick = async () => {
    if (!keyIn.value) return;
    await getJSON('/api/creds/' + encodeURIComponent(site), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ key: keyIn.value, value: valIn.value, category: catSel.value || undefined }) });
    renderCreds();
  };
  card.append(add);
  return card;
}

function catSelect(selected) {
  let o = '<option value="">auto</option>';
  CATEGORIES.forEach(c => { o += '<option value="'+c.key+'"'+(c.key===selected?' selected':'')+'>'+esc(c.label)+'</option>'; });
  return '<select>'+o+'</select>';
}

function credRow(site, key, category) {
  const tr = el('<tr><td style="width:30%"><code>'+esc(key)+'</code></td><td><code class="val">••••••</code></td><td style="width:280px;text-align:right"></td></tr>');
  const valCell = tr.children[1].querySelector('code');
  const actions = tr.children[2];

  let shown = false, editing = false, revealed = '';
  const reveal = el('<button class="btn">Reveal</button>');
  const edit = el('<button class="btn" style="margin-left:6px">Edit</button>');
  const del = el('<button class="btn danger" style="margin-left:6px">Delete</button>');

  async function fetchValue() {
    if (revealed === '') { const r = await getJSON('/api/creds/'+encodeURIComponent(site)+'/'+encodeURIComponent(key)); revealed = r.value; }
    return revealed;
  }
  reveal.onclick = async () => {
    if (editing) return;
    if (shown) { valCell.textContent = '••••••'; reveal.textContent = 'Reveal'; shown = false; return; }
    valCell.textContent = await fetchValue(); reveal.textContent = 'Hide'; shown = true;
  };
  edit.onclick = async () => {
    if (editing) return; editing = true;
    const cur = await fetchValue();
    const input = el('<input class="inline" />'); input.value = cur;
    valCell.replaceWith(input); input.focus();
    edit.textContent = 'Save';
    edit.onclick = async () => {
      await getJSON('/api/creds/'+encodeURIComponent(site), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ key, value: input.value }) });
      renderCreds();   // re-render to reset row state cleanly
    };
    // allow Enter to save
    input.addEventListener('keydown', e => { if (e.key === 'Enter') edit.onclick(); });
  };
  del.onclick = async () => {
    if (!confirm('Delete ' + key + ' for ' + site + '?')) return;
    await fetch('/api/creds/'+encodeURIComponent(site)+'/'+encodeURIComponent(key), { method:'DELETE' });
    renderCreds();
  };

  // category selector — change persists immediately
  const sel = el(catSelect(category));
  sel.querySelector('option[value=""]').remove();   // an existing key always has a concrete category
  sel.value = category;
  sel.onchange = async () => {
    await getJSON('/api/creds/'+encodeURIComponent(site)+'/'+encodeURIComponent(key)+'/category', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ category: sel.value }) });
  };

  actions.append(sel, reveal, edit, del);
  return tr;
}

function addSiteCard() {
  const card = el('<div class="detail"></div>');
  card.append(el('<div style="margin-bottom:8px"><strong>Add credential for a new site</strong></div>'));
  const row = el('<div class="addrow"><input placeholder="site (e.g. www.saucedemo.com)" style="width:220px" /><input placeholder="key" /><input placeholder="value" type="password" />'+catSelect()+'<button class="btn">Save</button></div>');
  const [siteIn, keyIn, valIn] = row.querySelectorAll('input');
  const catSel = row.querySelector('select');
  row.querySelector('button').onclick = async () => {
    if (!siteIn.value || !keyIn.value) return;
    await getJSON('/api/creds/' + encodeURIComponent(siteIn.value), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ key: keyIn.value, value: valIn.value, category: catSel.value || undefined }) });
    renderCreds();
  };
  card.append(row);
  return card;
}

// ---------- RECORDINGS ----------
let replayPoll = null;
let currentOpenId = null;
let winSession = null;   // which recording owns the driven window right now
let rowEls = {};         // sessionId → its list row (for in-place refresh, no flicker)
let detailCtx = null;    // { r, headBox, stepsBox, logsBox, subTab } for the open detail
let lastLogT = 0;

async function renderRecordings(openId) {
  clearInterval(replayPoll); replayPoll = null;
  main.style.gridTemplateColumns = '280px 1fr';
  const recs = await getJSON('/api/recordings');
  try { winSession = (await getJSON('/api/recordings/window')).session; } catch { winSession = null; }
  main.innerHTML = '';
  rowEls = {}; detailCtx = null;
  const list = el('<div class="list"></div>');
  const detail = el('<div class="detail"><div class="empty">open a window above, or select a recording</div></div>');
  list.append(newRecordingCard());
  let reopen = null;
  recs.forEach(r => {
    const row = el('<div class="row" style="display:flex;align-items:center;gap:8px"><div style="flex:1"><div class="name"></div><div class="meta"></div></div><button class="btn danger" title="delete" style="padding:2px 8px">✕</button></div>');
    rowEls[r.sessionId] = row;
    fillRow(row, r);
    row.onclick = () => showRecording(r, detail, list, row);
    row.querySelector('button').onclick = async (e) => {
      e.stopPropagation();
      if (!confirm('Delete recording '+r.sessionId+'?')) return;
      await fetch('/api/recordings/'+encodeURIComponent(r.sessionId), { method:'DELETE' });
      renderRecordings();
    };
    list.append(row);
    if (openId && r.sessionId === openId) reopen = () => showRecording(r, detail, list, row);
  });
  if (!recs.length) list.append(el('<div class="empty">no recordings yet</div>'));
  main.append(list, detail);
  if (reopen) reopen();
  startEvents();
}
function fillRow(row, r) {
  row.querySelector('.name').innerHTML = esc(r.sessionId)+(r.active?' <span style="color:#e5484d" class="pulse">●</span>':'');
  row.querySelector('.meta').textContent = (r.site||'?')+' · '+r.steps+' steps · '+new Date(r.startedAt).toLocaleString();
}

// SOFT refresh (no flicker): update rows + the open detail's header IN PLACE.
// Only a changed recordings SET (add/remove) does a full re-render.
async function softRefresh(kind) {
  if (tab !== 'recordings' || replayPoll) return;
  let recs;
  try {
    recs = await getJSON('/api/recordings');
    winSession = (await getJSON('/api/recordings/window')).session;
  } catch { return; }
  const ids = recs.map(r => r.sessionId).sort().join('|');
  if (ids !== Object.keys(rowEls).sort().join('|')) return renderRecordings(currentOpenId);
  recs.forEach(r => { const row = rowEls[r.sessionId]; if (row) fillRow(row, r); });
  if (detailCtx) {
    const fresh = recs.find(r => r.sessionId === detailCtx.r.sessionId);
    if (fresh) {
      const stateChanged = fresh.active !== detailCtx.r.active || (winSession === fresh.sessionId) !== detailCtx.hasWindow;
      detailCtx.r = fresh;
      if (stateChanged) buildHead(detailCtx);
      if (kind === 'step') loadSteps(detailCtx);   // realtime: steps stream like logs, whichever sub-tab is visible
    }
  }
}

// Realtime: the server pushes 'sessions' / 'step' / 'replay' / 'log' over SSE.
let es = null;
function startEvents() {
  if (es) return;
  es = new EventSource('/api/events');
  es.onmessage = (m) => {
    if (tab !== 'recordings') return;
    if (m.data === 'log') { appendLogLive(); return; }
    if (m.data === 'replay') return;                       // replay view drives itself
    softRefresh(m.data);
  };
}

function newRecordingCard() {
  const card = el('<div style="padding:12px;border-bottom:1px solid var(--border)"><div class="cat-head">New recording</div><div class="addrow" style="display:flex;flex-direction:column;gap:6px"><input placeholder="session name" /><input placeholder="start url (optional — blank window, navigate yourself)" /><label class="muted" style="font-size:12px"><input type="checkbox" style="width:auto;margin-right:6px" />keep me logged in (persistent profile)</label><button class="btn">Open window &amp; record</button></div><div class="muted" id="openmsg" style="font-size:12px;margin-top:6px"></div></div>');
  const [sessIn, urlIn] = card.querySelectorAll('input:not([type=checkbox])');
  const persistIn = card.querySelector('input[type=checkbox]');
  card.querySelector('button').onclick = async () => {
    const msg = card.querySelector('#openmsg');
    if (!sessIn.value) { msg.textContent = 'session name required'; return; }
    const r = await fetch('/api/recordings/open', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ url: urlIn.value || 'about:blank', session: sessIn.value, persistent: persistIn.checked }) });
    msg.textContent = r.ok ? 'window opened — RECORDING (red border). Stop here or via the pill in the window.' : (await r.json()).error;
    if (r.ok) setTimeout(() => renderRecordings(sessIn.value), 400);
  };
  return card;
}

// The detail header: state + action buttons. Rebuilt IN PLACE on state changes.
function buildHead(ctx) {
  const r = ctx.r;
  const hasWindow = winSession === r.sessionId;
  ctx.hasWindow = hasWindow;
  const recState = r.active ? '<span class="pulse" style="color:#e5484d;font-weight:600">● recording…</span>'
    : hasWindow ? '<span class="muted">🪟 window open (armed)</span>'
    : winSession ? '<span class="muted">window busy: '+esc(winSession)+'</span>' : '';
  ctx.headBox.innerHTML = '';
  const head = el('<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><strong>'+esc(r.sessionId)+'</strong><span class="muted">'+esc(r.site||'')+'</span><span class="hstate">'+recState+'</span><span style="flex:1"></span></div>');
  const btn = (t, danger) => el('<button class="btn'+(danger?' danger':'')+'">'+t+'</button>');
  const repB = btn('Replay'), anB = btn('Analyse → draft'), delB = btn('Delete', true);
  // Open window and Record are SEPARATE intents here (live feedback): the window
  // opens ARMED; Record activates once the window exists.
  const openB = btn('Open window');
  openB.disabled = !!winSession;
  if (winSession && !hasWindow) openB.title = 'window is busy with '+winSession;
  openB.onclick = async () => {
    openB.disabled = true; openB.textContent = 'opening…';
    const res = await fetch('/api/recordings/open', { method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ url: r.site ? 'https://'+r.site : 'about:blank', session: r.sessionId, persistent: false, armedOnly: true }) });
    if (!res.ok) { alert((await res.json()).error); }
    softRefresh('sessions');
  };
  const recB = btn(r.active ? '■ Stop' : '⏺ Record');
  recB.disabled = !hasWindow && !r.active;
  if (!hasWindow && !r.active) recB.title = 'open a window first';
  if (r.active) recB.style.borderColor = '#e5484d';
  recB.onclick = async () => {
    // OPTIMISTIC: flip the header immediately; the server confirms via SSE.
    const starting = !r.active;
    head.querySelector('.hstate').innerHTML = starting
      ? '<span class="pulse" style="color:#e5484d;font-weight:600">● recording…</span>'
      : '<span class="muted">🪟 window open (armed)</span>';
    recB.disabled = true;
    await fetch('/api/recordings/'+encodeURIComponent(r.sessionId)+'/'+(r.active?'stop':'record'), { method:'POST' });
    softRefresh('sessions');
  };
  delB.onclick = async () => { if (confirm('Delete recording '+r.sessionId+'?')) { await fetch('/api/recordings/'+encodeURIComponent(r.sessionId), { method:'DELETE' }); renderRecordings(); } };
  anB.onclick = async () => {
    const d = await getJSON('/api/recordings/'+encodeURIComponent(r.sessionId)+'/draft');
    ctx.stepsBox.innerHTML = ''; setSubTab(ctx, 'steps');
    ctx.stepsBox.append(el('<pre>'+esc(JSON.stringify(d, null, 2))+'</pre>'));
  };
  repB.onclick = async () => {
    const res = await fetch('/api/recordings/'+encodeURIComponent(r.sessionId)+'/replay', { method:'POST' });
    if (!res.ok) { alert((await res.json()).error); return; }
    setSubTab(ctx, 'steps');
    pollReplay(ctx.stepsBox, r.sessionId);
  };
  head.append(openB, recB, repB, anB, delB);
  ctx.headBox.append(head);
}

function setSubTab(ctx, name) {
  ctx.subTab = name;
  ctx.tabsBar.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.sub === name));
  ctx.stepsBox.style.display = name === 'steps' ? '' : 'none';
  ctx.logsBox.style.display = name === 'logs' ? '' : 'none';
  ctx.videosBox.style.display = name === 'videos' ? '' : 'none';
  if (name === 'steps') loadSteps(ctx);   // refetch — steps landed while you were on Logs (live bug: stale view)
  if (name === 'logs') loadLogs(ctx);
  if (name === 'videos') loadVideos(ctx);
}
async function loadSteps(ctx) {
  const steps = await getJSON('/api/recordings/'+encodeURIComponent(ctx.r.sessionId)+'/steps');
  ctx.stepsBox.innerHTML = '';
  ctx.stepsBox.append(stepTable(steps.map(x => ({ ...x, status: '' }))));
}

async function showRecording(r, detail, list, row) {
  currentOpenId = r.sessionId;
  clearInterval(replayPoll); replayPoll = null;
  list.querySelectorAll('.row').forEach(x => x.classList.remove('active')); row.classList.add('active');
  const steps = await getJSON('/api/recordings/'+encodeURIComponent(r.sessionId)+'/steps');
  detail.innerHTML = '';
  const headBox = el('<div style="margin-bottom:10px"></div>');
  const tabsBar = el('<nav style="padding:0;border-bottom:1px solid var(--border);margin-bottom:10px"><button data-sub="steps" class="active">Steps</button><button data-sub="logs">Logs</button><button data-sub="videos">Session videos</button></nav>');
  const stepsBox = el('<div></div>');
  const logsBox = el('<div style="display:none"></div>');
  const videosBox = el('<div style="display:none"></div>');
  const ctx = { r, headBox, tabsBar, stepsBox, logsBox, videosBox, subTab: 'steps', hasWindow: winSession === r.sessionId };
  detailCtx = ctx;
  tabsBar.querySelectorAll('button').forEach(b => { b.onclick = () => setSubTab(ctx, b.dataset.sub); });
  buildHead(ctx);
  stepsBox.append(stepTable(steps.map(x => ({ ...x, status: '' }))));
  detail.append(headBox, tabsBar, stepsBox, logsBox, videosBox);
}

// --- Logs sub-tab: continuous stream + freshness ping ---
async function loadLogs(ctx) {
  const data = await getJSON('/api/logs');
  ctx.logsBox.innerHTML = '<div class="muted" id="logping" style="font-size:11px;margin-bottom:6px"></div><pre id="logstream" style="max-height:55vh"></pre>';
  const pre = ctx.logsBox.querySelector('#logstream');
  pre.textContent = data.lines.map(l => new Date(l.t).toLocaleTimeString()+'  '+l.line).join('\\n');
  pre.scrollTop = pre.scrollHeight;
  lastLogT = data.lines.length ? data.lines[data.lines.length-1].t : data.now;
  tickLogPing(ctx);
  clearInterval(ctx.logTicker); ctx.logTicker = setInterval(() => tickLogPing(ctx), 1000);
}
function tickLogPing(ctx) {
  const elp = ctx.logsBox.querySelector('#logping');
  if (!elp) { clearInterval(ctx.logTicker); return; }
  elp.textContent = lastLogT ? ('last update ' + Math.max(0, Math.round((Date.now()-lastLogT)/1000)) + 's ago · live') : 'no logs yet · live';
}
async function appendLogLive() {
  if (!detailCtx || detailCtx.subTab !== 'logs') { lastLogT = Date.now(); return; }
  const data = await getJSON('/api/logs');
  const pre = detailCtx.logsBox.querySelector('#logstream');
  if (pre) { pre.textContent = data.lines.map(l => new Date(l.t).toLocaleTimeString()+'  '+l.line).join('\\n'); pre.scrollTop = pre.scrollHeight; }
  lastLogT = data.lines.length ? data.lines[data.lines.length-1].t : Date.now();
}

// --- Session videos sub-tab: takes over time ---
async function loadVideos(ctx) {
  const r = ctx.r;
  ctx.videosBox.innerHTML = '';
  let vids = [];
  try { vids = await getJSON('/api/recordings/'+encodeURIComponent(r.sessionId)+'/videos'); } catch {}
  if (!vids.length) { ctx.videosBox.append(el('<div class="empty">no video takes yet — each Record→Stop span saves one</div>')); return; }
  vids.forEach(v => {
    const m = v.match(/take-(\\d+)\\.webm/);
    const when = m ? new Date(Number(m[1])).toLocaleString() : v;
    const wrap = el('<div style="margin-bottom:12px"><div class="cat-head">'+esc(when)+'</div></div>');
    wrap.append(el('<video controls preload="metadata" style="max-width:100%;border:1px solid var(--border);border-radius:6px" src="/recordings-media/'+encodeURIComponent(r.sessionId)+'/'+encodeURIComponent(v)+'"></video>'));
    ctx.videosBox.append(wrap);
  });
}


function stepTable(steps, session) {
  const t = el('<table><tbody></tbody></table>'); const tb = t.querySelector('tbody');
  const ICON = { ok: '✓', fail: '✗', running: '▶', jumped: '↪', skipped: '⊘', pending: '·', '': '' };
  const KIND = { input: ['input', '#5b9dff'], click: ['click', '#8b93a3'], navigate: ['nav', '#3fb950'], jump: ['jump', '#3fb950'], observe: ['page', '#8b93a3'] };
  const pathOf = (u) => { try { const x = new URL(u); return x.host + x.pathname; } catch { return u || ''; } };
  steps.forEach(s => {
    const color = s.status==='ok'?'#3fb950':s.status==='fail'?'#ff6b6b':'var(--muted)';
    const [kLabel, kColor] = KIND[s.kind] || [s.kind || '', '#8b93a3'];
    const kindChip = kLabel ? '<span style="border:1px solid '+kColor+';color:'+kColor+';border-radius:4px;padding:0 5px;font-size:10px;text-transform:uppercase">'+esc(kLabel)+'</span>' : '';
    const val = (s.kind === 'input' && s.value !== undefined && s.value !== null)
      ? ' <code class="val" style="color:#e2b93d">= "'+esc(String(s.value))+'"</code>' : '';
    const dest = s.kind === 'navigate' || s.kind === 'jump'
      ? '<div class="muted" style="font-size:11px">'+esc(pathOf(s.fromUrl))+' → '+esc(pathOf(s.toUrl))+'</div>'
      : '<div class="muted" style="font-size:11px">'+esc(pathOf(s.fromUrl || s.toUrl))+'</div>';
    const when = s.capturedAt ? new Date(s.capturedAt).toLocaleTimeString() : '';
    const shot = s.shot && session ? '<img src="/replays/'+encodeURIComponent(session)+'/'+encodeURIComponent(s.shot)+'" style="height:44px;border-radius:4px;border:1px solid var(--border)" />' : '';
    const note = s.note ? ' <span class="muted">('+esc(s.note)+')</span>' : '';
    tb.append(el('<tr><td style="width:22px;color:'+color+'">'+(ICON[s.status]||'')+'</td><td style="width:52px">'+kindChip+'</td><td><div>'+esc(s.label||('step '+s.seq))+val+note+'</div>'+dest+'</td><td class="muted" style="width:90px;font-size:11px">'+esc(when)+'</td><td style="text-align:right">'+shot+'</td></tr>'));
  });
  return t;
}
function pollReplay(box, session) {
  clearInterval(replayPoll);
  const controls = el('<div style="display:flex;gap:8px;margin:10px 0"><button class="btn">Pause</button><button class="btn">Next</button><button class="btn">Resume</button><button class="btn danger">Abort</button></div>');
  const [pauseB, nextB, resumeB, abortB] = controls.querySelectorAll('button');
  const ctl = a => body => fetch('/api/replay/control', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(Object.assign({ action: a }, body||{})) });
  pauseB.onclick = () => ctl('pause')(); nextB.onclick = () => ctl('next')(); resumeB.onclick = () => ctl('resume')(); abortB.onclick = () => ctl('abort')();
  const prompt = el('<div></div>');
  replayPoll = setInterval(async () => {
    const st = await getJSON('/api/replay/status');
    if (!st || st.running === false) { clearInterval(replayPoll); }
    box.innerHTML = ''; box.append(controls, prompt, stepTable(st.steps || [], session));
    prompt.innerHTML = '';
    if (st.waiting === 'value') {
      const p = el('<div class="addrow" style="margin:8px 0"><span class="muted">value for \\u201C'+esc(st.waitingLabel||'')+'\\u201D: </span><input type="password" /><button class="btn">Use once</button><button class="btn">Use &amp; save</button></div>');
      const inp = p.querySelector('input'); const [once, save] = p.querySelectorAll('button');
      once.onclick = () => ctl('supply')({ value: inp.value, save: false });
      save.onclick = () => ctl('supply')({ value: inp.value, save: true });
      prompt.append(p);
    } else if (st.waiting === 'confirm') {
      const p = el('<div class="addrow" style="margin:8px 0"><span style="color:#ff6b6b">\\u26A0 \\u201C'+esc(st.waitingLabel||'')+'\\u201D looks like a commit (order/pay/delete). Fire it?</span> <button class="btn danger">Fire</button><button class="btn">Skip</button></div>');
      const [fire, skip] = p.querySelectorAll('button');
      fire.onclick = () => ctl('confirm')({ fire: true }); skip.onclick = () => ctl('confirm')({ fire: false });
      prompt.append(p);
    }
    if (st.done) clearInterval(replayPoll);
  }, 700);
}

render();
</script>
</body>
</html>`;
