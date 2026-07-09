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
  button.btn:hover:not(:disabled) { border-color:var(--accent); }
  button.btn.danger:hover:not(:disabled) { border-color:var(--danger); color:var(--danger); }
  button.btn:disabled { opacity:.4; cursor:not-allowed; }   /* disabled must LOOK disabled (was clickable-looking, live #3) */
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
  <button data-tab="recordings" class="active">Sessions</button>
  <button data-tab="sites">Sites</button>
  <button data-tab="creds">Credentials</button>
  <button data-tab="profiles">Profiles</button>
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
  if (tab === 'profiles') return renderProfiles();
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

// ---------- PROFILES (named, shared logged-in browser states) ----------
async function renderProfiles() {
  main.style.gridTemplateColumns = '1fr';
  const profs = await getJSON('/api/profiles');
  main.innerHTML = '';
  const wrap = el('<div></div>');
  wrap.append(el('<div class="cat-head">Named browser profiles — a logged-in state kept on disk (Cloudflare / SSO / 2FA done once by hand). Every session under a profile reuses its login; a walk reuses it via <code class="val">--profile &lt;name&gt;</code>. New sessions use <code class="val">default</code>.</div>'));
  const newBar = el('<div style="display:flex;gap:8px;margin:8px 0"><button class="btn">+ New profile</button></div>');
  newBar.querySelector('button').onclick = async () => {
    const name = prompt('New profile name (e.g. default, work-google):', 'default');
    if (!name) return;
    const res = await fetch('/api/profiles', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ name }) });
    if (!res.ok) { alert((await res.json()).error); return; }
    const o = await fetch('/api/profiles/'+encodeURIComponent(name)+'/open', { method:'POST' });   // straight into log-in
    if (!o.ok) alert((await o.json()).error);
    renderProfiles();
  };
  wrap.append(newBar);
  if (!profs.length) { wrap.append(el('<div class="empty">no profiles yet — create one and log in once, or just start a session (it uses "default")</div>')); main.append(wrap); startEvents(); return; }
  const tbl = el('<table><thead><tr><th>Profile</th><th>Site</th><th>Sessions</th><th>Size</th><th>Last used</th><th></th></tr></thead><tbody></tbody></table>');
  const tb = tbl.querySelector('tbody');
  profs.forEach(pf => {
    const tr = el('<tr><td><code>'+esc(pf.name)+'</code>'+(pf.open?' <span class="pulse" style="color:#e5484d">● open</span>':'')+'</td><td class="muted">'+esc(pf.site||'—')+'</td><td class="muted">'+pf.sessions+'</td><td class="muted">'+pf.sizeMb+' MB</td><td class="muted" style="font-size:12px">'+(pf.lastUsed?new Date(pf.lastUsed).toLocaleString():'—')+'</td><td style="text-align:right"></td></tr>');
    const act = tr.children[5];
    const openB = el('<button class="btn">Open to log in</button>');
    openB.disabled = pf.open;
    openB.onclick = async () => {
      openB.disabled = true; openB.textContent = 'opening…';
      const res = await fetch('/api/profiles/'+encodeURIComponent(pf.name)+'/open', { method:'POST' });
      if (!res.ok) alert((await res.json()).error);
      renderProfiles();
    };
    const renB = el('<button class="btn" style="margin-left:6px">Rename</button>');
    renB.onclick = async () => {
      const to = prompt('Rename profile "'+pf.name+'" to:', pf.name);
      if (!to || to === pf.name) return;
      const res = await fetch('/api/profiles/'+encodeURIComponent(pf.name)+'/rename', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ to }) });
      if (!res.ok) alert((await res.json()).error);
      renderProfiles();
    };
    const delB = el('<button class="btn danger" style="margin-left:6px">Delete</button>');
    delB.onclick = async () => {
      if (!confirm('Delete profile '+pf.name+'? This logs it out — sessions using it hit the login wall next time.')) return;
      await fetch('/api/profiles/'+encodeURIComponent(pf.name), { method:'DELETE' });
      renderProfiles();
    };
    act.append(openB, renB, delB);
    tb.append(tr);
  });
  wrap.append(tbl);
  main.append(wrap);
  startEvents();   // 'sessions' events (profile open/close/rename/delete) refresh this tab
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
  const selected = new Set();
  const bulkBar = el('<div style="display:none;padding:8px 12px;border-bottom:1px solid var(--border)"><button class="btn danger">Delete selected</button></div>');
  const syncBulk = () => {
    bulkBar.style.display = selected.size ? '' : 'none';
    bulkBar.querySelector('button').textContent = 'Delete selected ('+selected.size+')';
  };
  bulkBar.querySelector('button').onclick = async () => {
    if (!confirm('Delete '+selected.size+' session(s)?')) return;
    for (const id of selected) await fetch('/api/recordings/'+encodeURIComponent(id), { method:'DELETE' });
    renderRecordings();
  };
  list.append(bulkBar);
  if (recs.length) {
    // Clear-all: a header row above the sessions. Typed confirm — it wipes every
    // session's steps/videos/reviews (destructive, no undo).
    const clearBar = el('<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid var(--border)"><span class="muted" style="font-size:12px">'+recs.length+' session'+(recs.length===1?'':'s')+'</span><button class="btn danger" style="padding:2px 8px">Clear all</button></div>');
    clearBar.querySelector('button').onclick = async () => {
      if (prompt('Delete ALL '+recs.length+' sessions (steps, videos, reviews)? This cannot be undone. Type "delete all" to confirm:') !== 'delete all') return;
      for (const rr of recs) await fetch('/api/recordings/'+encodeURIComponent(rr.sessionId), { method:'DELETE' });
      renderRecordings();
    };
    list.append(clearBar);
  }
  recs.forEach(r => {
    const row = el('<div class="row" style="display:flex;align-items:center;gap:8px"><input type="checkbox" style="width:auto" /><div style="flex:1"><div class="name"></div><div class="meta"></div></div><button class="btn danger" title="delete" style="padding:2px 8px">✕</button></div>');
    rowEls[r.sessionId] = row;
    fillRow(row, r);
    row.onclick = () => showRecording(r, detail, list, row);
    const cb = row.querySelector('input[type=checkbox]');
    cb.onclick = (e) => {
      e.stopPropagation();
      if (cb.checked) selected.add(r.sessionId); else selected.delete(r.sessionId);
      syncBulk();
    };
    row.querySelector('button.danger').onclick = async (e) => {
      e.stopPropagation();
      if (!confirm('Delete session '+r.sessionId+'?')) return;
      await fetch('/api/recordings/'+encodeURIComponent(r.sessionId), { method:'DELETE' });
      renderRecordings();
    };
    list.append(row);
    if (openId && r.sessionId === openId) reopen = () => showRecording(r, detail, list, row);
  });
  if (!recs.length) list.append(el('<div class="empty">no sessions yet</div>'));
  main.append(list, detail);
  if (reopen) reopen();
  startEvents();
}
function originTag(origin) {
  const agent = origin === 'agent';
  const c = agent ? '#5b9dff' : '#8b93a3';
  return '<span style="border:1px solid '+c+';color:'+c+';border-radius:4px;padding:0 5px;font-size:10px;text-transform:uppercase">'+(agent?'Agent':'Manual')+'</span>';
}
function fillRow(row, r) {
  row.querySelector('.name').innerHTML = esc(r.sessionId)+' '+originTag(r.origin)+(r.active?' <span style="color:#e5484d" class="pulse">●</span>':'');
  const vid = r.videoCount ? ' · \\uD83C\\uDFA5 '+r.videoCount : '';   // 🎥 N when takes exist
  row.querySelector('.meta').textContent = (r.site||'?')+' · '+r.steps+' steps'+vid+' · '+new Date(r.startedAt).toLocaleString();
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
  const anyChecked = [...document.querySelectorAll('.list input[type=checkbox]')].some(c => c.checked);
  if (ids !== Object.keys(rowEls).sort().join('|')) { if (!anyChecked) renderRecordings(currentOpenId); return; }
  recs.forEach(r => { const row = rowEls[r.sessionId]; if (row) fillRow(row, r); });
  if (detailCtx) {
    const fresh = recs.find(r => r.sessionId === detailCtx.r.sessionId);
    if (fresh) {
      const stateChanged = fresh.active !== detailCtx.r.active || (winSession === fresh.sessionId) !== detailCtx.hasWindow;
      detailCtx.r = fresh;
      if (stateChanged) buildHead(detailCtx);   // recording→stopped, window gained/lost → repaint header NOW
      // GROUND TRUTH over inference (advisor): any sessions/step event while the Steps
      // tab is open → just refetch steps. One cheap call; retires the whole "steps
      // blank until re-click" class instead of guessing when the count moved.
      if (detailCtx.subTab === 'steps') loadSteps(detailCtx);
      if (detailCtx.subTab === 'review') loadReview(detailCtx);   // review start/finish emits 'sessions'
    }
  }
}

// Realtime: the server pushes 'sessions' / 'step' / 'replay' / 'log' over SSE.
let es = null;
function startEvents() {
  if (es) return;
  es = new EventSource('/api/events');
  es.onmessage = (m) => {
    if (tab === 'profiles') { if (m.data !== 'log') renderProfiles(); return; }
    if (tab !== 'recordings') return;
    if (m.data === 'log') { appendLogLive(); return; }
    if (m.data === 'replay') return;                       // replay view drives itself
    softRefresh(m.data);
  };
}

function newRecordingCard() {
  const card = el('<div style="padding:12px;border-bottom:1px solid var(--border)"><div class="cat-head">New session</div><div class="addrow" style="display:flex;flex-direction:column;gap:6px"><input placeholder="session name" /><input placeholder="start url (optional — blank window, navigate yourself)" /><label class="muted" style="font-size:12px">profile <input placeholder="default" style="width:140px;margin:0 0 0 4px" /> <span title="which saved login to run under; leave as default. Empty = throwaway (no saved login).">(logged-in state reused; blank = throwaway)</span></label><button class="btn">Open window &amp; record</button></div><div class="muted" id="openmsg" style="font-size:12px;margin-top:6px"></div></div>');
  const [sessIn, urlIn, profIn] = card.querySelectorAll('input');
  // default name (editable): s-MMDDHHMMSS — SHORT on purpose: the playwright-cli
  // daemon socket path embeds the session name and macOS caps socket paths at
  // ~104 chars (live failure: 'session-0708-134206' overflowed → listen EINVAL).
  const d = new Date(), p2 = (x) => String(x).padStart(2, '0');
  sessIn.value = 's-' + p2(d.getMonth()+1) + p2(d.getDate()) + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
  profIn.value = 'default';   // common case: every session shares the 'default' login
  card.querySelector('button').onclick = async () => {
    const msg = card.querySelector('#openmsg');
    if (!sessIn.value) { msg.textContent = 'session name required'; return; }
    const profile = profIn.value.trim();   // blank → throwaway (persistent:false)
    const r = await fetch('/api/recordings/open', { method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ url: urlIn.value || 'about:blank', session: sessIn.value, persistent: !!profile, profile: profile || undefined }) });
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
  const profBadge = r.hasProfile ? ' <span title="runs under this saved-login profile" style="border:1px solid #3fb950;color:#3fb950;border-radius:4px;padding:0 5px;font-size:10px">\uD83D\uDD10 '+esc(r.profile)+'</span>' : '';
  const head = el('<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><strong>'+esc(r.sessionId)+'</strong>'+originTag(r.origin)+'<span class="muted">'+esc(r.site||'')+'</span>'+profBadge+'<span class="hstate">'+recState+'</span><span style="flex:1"></span></div>');
  const btn = (t, danger) => el('<button class="btn'+(danger?' danger':'')+'">'+t+'</button>');
  const repB = btn('Replay'), anB = btn('Analyse → draft'), delB = btn('Delete', true);
  // Open window and Record are SEPARATE intents here (live feedback): the window
  // opens ARMED; Record activates once the window exists.
  const openB = btn(hasWindow ? '🪟 window open' : (r.hasProfile ? '\\uD83D\\uDD10 Open (' + r.profile + ')' : 'Open window'));
  // Open is disabled whenever ANY driven window exists — this session's (already
  // open, #2) or another's (busy). Only openable when no window is live.
  openB.disabled = !!winSession;
  if (winSession && !hasWindow) openB.title = 'window is busy with '+winSession;
  if (hasWindow) openB.title = 'this session already has a window open';
  openB.onclick = async () => {
    openB.disabled = true; openB.textContent = 'opening…';
    // REOPEN is always persistent: reuse this session's saved profile so a prior
    // Cloudflare/2FA login carries over (live bug: reopen sent persistent:false →
    // fresh throwaway profile → forced re-login). A first-ever open with no profile
    // yet still creates one under the same session, so the next reopen has a login.
    const res = await fetch('/api/recordings/open', { method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ url: r.startUrl || (r.site ? 'https://'+r.site : 'about:blank'), session: r.sessionId, persistent: true, armedOnly: true, profile: r.profile || 'default' }) });
    // ALWAYS restore the button first (a failed open changes nothing server-side, so
    // softRefresh wouldn't rebuild the header → the button stayed 'opening…' forever).
    openB.disabled = false; openB.textContent = r.hasProfile ? '🔐 Open (' + r.profile + ')' : 'Open window';
    if (!res.ok) { alert((await res.json()).error); }
    softRefresh('sessions');
  };
  const recB = btn(r.active ? '■ Stop' : '⏺ Record');
  // Record is active ONLY when this session's window is open (#3). Stop stays
  // enabled while recording (always allow stopping). Greyed when no window.
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
  delB.onclick = async () => { if (confirm('Delete session '+r.sessionId+'?')) { await fetch('/api/recordings/'+encodeURIComponent(r.sessionId), { method:'DELETE' }); renderRecordings(); } };
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

// Refetch the session's steps and re-render the table. This is the single source
// of step rendering for live updates (SSE 'step'/'sessions') AND tab switches —
// it was CALLED in both places but never DEFINED, so every live refresh threw
// 'loadSteps is not defined' and steps only appeared on a hard reload (live #1).
async function loadSteps(ctx) {
  let steps = [];
  try { steps = await getJSON('/api/recordings/'+encodeURIComponent(ctx.r.sessionId)+'/steps'); } catch { return; }
  ctx.stepsBox.innerHTML = '';
  ctx.stepsBox.append(stepTable(steps.map(x => ({ ...x, status: '' })), ctx.r.sessionId));
}

function setSubTab(ctx, name) {
  ctx.subTab = name;
  ctx.tabsBar.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.sub === name));
  ctx.stepsBox.style.display = name === 'steps' ? '' : 'none';
  ctx.logsBox.style.display = name === 'logs' ? '' : 'none';
  ctx.videosBox.style.display = name === 'videos' ? '' : 'none';
  ctx.reviewBox.style.display = name === 'review' ? '' : 'none';
  if (name === 'steps') loadSteps(ctx);   // refetch — steps landed while you were on Logs (live bug: stale view)
  if (name === 'logs') loadLogs(ctx);
  if (name === 'videos') loadVideos(ctx);
  if (name === 'review') loadReview(ctx);
}

// Minimal markdown → HTML for the review report (esc() runs FIRST, so this only
// ever wraps already-escaped text — no XSS surface). Headings, bold, italics,
// inline/fenced code, bullet & numbered lists, paragraphs. BT = backtick (kept
// out of the source literal — this whole file lives inside a template string).
const BT = String.fromCharCode(96);
function mdToHtml(md) {
  let src = esc(md).replace(/\\r/g, '');
  const codeBlocks = [];
  src = src.replace(new RegExp(BT+BT+BT+'([^]*?)'+BT+BT+BT, 'g'), (_, c) => {
    codeBlocks.push('<pre>' + c.replace(/^\\w*\\n/, '') + '</pre>');
    return '@@CB' + (codeBlocks.length - 1) + '@@';
  });
  src = src.replace(new RegExp(BT+'([^'+BT+']+)'+BT, 'g'), '<code class="val">$1</code>');
  src = src.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
  src = src.replace(/(^|\\s)\\*([^*\\n]+)\\*(?=\\s|$)/g, '$1<em>$2</em>');
  const out = [];
  let list = null;
  const closeList = () => { if (list) { out.push('</' + list + '>'); list = null; } };
  for (const line of src.split('\\n')) {
    const h = /^(#{1,4})\\s+(.*)$/.exec(line);
    const li = /^\\s*[-*]\\s+(.*)$/.exec(line);
    const ol = /^\\s*\\d+[.)]\\s+(.*)$/.exec(line);
    if (h) { closeList(); out.push('<h' + (h[1].length + 2) + ' style="margin:14px 0 4px">' + h[2] + '</h' + (h[1].length + 2) + '>'); }
    else if (li) { if (list !== 'ul') { closeList(); out.push('<ul style="margin:4px 0 8px 18px">'); list = 'ul'; } out.push('<li>' + li[1] + '</li>'); }
    else if (ol) { if (list !== 'ol') { closeList(); out.push('<ol style="margin:4px 0 8px 18px">'); list = 'ol'; } out.push('<li>' + ol[1] + '</li>'); }
    else if (!line.trim()) { closeList(); out.push('<div style="height:8px"></div>'); }
    else { closeList(); out.push('<div>' + line + '</div>'); }
  }
  closeList();
  return out.join('').replace(/@@CB(\\d+)@@/g, (_, i) => codeBlocks[Number(i)]);
}

// --- Review sub-tab: headless-Claude audit of captured steps vs the video frames ---
async function loadReview(ctx) {
  const r = ctx.r;
  ctx.reviewBox.innerHTML = '';
  const cfg = await getJSON('/api/review-config').catch(() => ({ model: 'sonnet', instructions: '' }));
  let state = null;
  try { state = await getJSON('/api/recordings/'+encodeURIComponent(r.sessionId)+'/review'); } catch { state = null; }

  // controls: model picker + editable agent instructions + run
  const bar = el('<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px"><button class="btn">Run review</button><select><option value="sonnet">sonnet</option><option value="opus">opus</option><option value="haiku">haiku</option></select><button class="btn" data-k="instr">Instructions</button><span class="muted" style="font-size:12px">compares the VIDEO frames against the captured steps to find capture gaps · runs on your claude login · 1–3 min</span></div>');
  const runB = bar.querySelector('button');
  const modelSel = bar.querySelector('select');
  modelSel.value = ['sonnet','opus','haiku'].includes(cfg.model) ? cfg.model : 'sonnet';
  const instrWrap = el('<div style="display:none;margin-bottom:10px"><div class="cat-head">Agent instructions (editable — saved as default for future runs)</div><textarea style="width:100%;min-height:180px;background:#0b0d11;border:1px solid var(--border);color:var(--fg);border-radius:6px;padding:8px;font:12px ui-monospace,monospace"></textarea></div>');
  instrWrap.querySelector('textarea').value = cfg.instructions || '';
  bar.querySelector('[data-k=instr]').onclick = () => { instrWrap.style.display = instrWrap.style.display === 'none' ? '' : 'none'; };
  runB.onclick = async () => {
    const res = await fetch('/api/recordings/'+encodeURIComponent(r.sessionId)+'/review', {
      method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ model: modelSel.value, instructions: instrWrap.querySelector('textarea').value }) });
    if (!res.ok) { alert((await res.json()).error); return; }
    loadReview(ctx);   // re-render into the running state — progress visible HERE (and in Logs)
  };
  ctx.reviewBox.append(bar, instrWrap);

  if (state && state.running) {
    runB.disabled = true;
    ctx.reviewBox.append(el('<div class="pulse" style="color:var(--accent);margin:8px 0">\u23F3 review running\u2026 (progress also streams in Logs; the report will appear here)</div>'));
  }
  if (state && state.report) {
    const when = state.at ? new Date(state.at).toLocaleString() : '';
    ctx.reviewBox.append(el('<div class="muted" style="font-size:12px;margin:6px 0">last run: '+esc(when)+'</div>'));
    ctx.reviewBox.append(el('<div style="border:1px solid var(--border);border-radius:6px;padding:12px;font-size:13px">'+mdToHtml(state.report)+'</div>'));
  } else if (!state || !state.running) {
    ctx.reviewBox.append(el('<div class="empty">no review yet — run one above</div>'));
  }
}

async function showRecording(r, detail, list, row) {
  currentOpenId = r.sessionId;
  clearInterval(replayPoll); replayPoll = null;
  list.querySelectorAll('.row').forEach(x => x.classList.remove('active')); row.classList.add('active');
  const steps = await getJSON('/api/recordings/'+encodeURIComponent(r.sessionId)+'/steps');
  detail.innerHTML = '';
  const headBox = el('<div style="margin-bottom:10px"></div>');
  const tabsBar = el('<nav style="padding:0;border-bottom:1px solid var(--border);margin-bottom:10px"><button data-sub="steps" class="active">Steps</button><button data-sub="videos">Session videos</button><button data-sub="review">Review</button><button data-sub="logs">Logs</button></nav>');
  const stepsBox = el('<div></div>');
  const logsBox = el('<div style="display:none"></div>');
  const videosBox = el('<div style="display:none"></div>');
  const reviewBox = el('<div style="display:none"></div>');
  const ctx = { r, headBox, tabsBar, stepsBox, logsBox, videosBox, reviewBox, subTab: 'steps', hasWindow: winSession === r.sessionId };
  detailCtx = ctx;
  tabsBar.querySelectorAll('button').forEach(b => { b.onclick = () => setSubTab(ctx, b.dataset.sub); });
  buildHead(ctx);
  stepsBox.append(stepTable(steps.map(x => ({ ...x, status: '' }))));
  detail.append(headBox, tabsBar, stepsBox, logsBox, videosBox, reviewBox);
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
    const vid = el('<video controls preload="metadata" style="max-width:100%;border:1px solid var(--border);border-radius:6px" src="/recordings-media/'+encodeURIComponent(r.sessionId)+'/'+encodeURIComponent(v)+'"></video>');
    // Screencast webm is written live → no duration in the header → the browser
    // reports Infinity and the scrubber is dead. Standard fix: seek to a huge
    // time once; the browser scans the file, learns the real duration, and the
    // slider works. Rewind to 0 when it settles.
    vid.addEventListener('loadedmetadata', () => {
      if (vid.duration !== Infinity) return;
      vid.currentTime = 1e7;
      const fix = () => { vid.removeEventListener('timeupdate', fix); vid.currentTime = 0; };
      vid.addEventListener('timeupdate', fix);
    });
    wrap.append(vid);
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
