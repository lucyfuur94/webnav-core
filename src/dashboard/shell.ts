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
</style>
</head>
<body>
<header>
  <h1>webnav dashboard</h1>
  <span class="sub" id="env"></span>
</header>
<nav>
  <button data-tab="sites" class="active">Sites</button>
  <button data-tab="creds">Credentials</button>
</nav>
<main id="main"></main>

<script>
const main = document.getElementById('main');
let tab = 'sites';

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
  main.innerHTML = '<div class="empty">loading…</div>';
  main.style.gridTemplateColumns = tab === 'sites' ? '280px 1fr' : '1fr';
  if (tab === 'sites') return renderSites();
  if (tab === 'creds') return renderCreds();
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

render();
</script>
</body>
</html>`;
