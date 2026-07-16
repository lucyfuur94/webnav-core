// The dashboard shell: a single self-contained page (vanilla JS + fetch) for the
// SITES and CREDENTIALS operator views. No build step — matches webnav's ethos
// for its OWN UI; the heavy xyflow graph viewer is the separate web/dist bundle,
// linked from here as the "Graph" tab (opens /graph). Kept deliberately plain.
export const SHELL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>webnav</title>
<!-- Favicon: the webnav waypoint mark (a map pin with a hollow center), inline data-URI so
     the tab icon is self-contained — no external asset, no build step. Accent blue on transparent. -->
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%235b9dff' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 22c4.5-5 7-8.4 7-12A7 7 0 0 0 5 10c0 3.6 2.5 7 7 12z'/%3E%3Ccircle cx='12' cy='10' r='2.6' fill='%230f1115'/%3E%3C/svg%3E" />
<!-- Theme bootstrap: set data-theme BEFORE first paint so there's no flash. Saved choice
     (localStorage) wins; otherwise follow the OS preference. Runs inline, synchronously. -->
<script>(function(){try{var s=localStorage.getItem('webnav-theme');var t=s||(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();</script>
<style>
  /* THEME TOKENS. Dark is the default (identity-preserving); light is a companion ramp tuned to
     pass WCAG on the same accent. The theme is chosen by data-theme on <html> (set by the toggle;
     first load follows prefers-color-scheme). --bg-sunken = inputs/code (darker than bg in dark,
     LIGHTER-surface in light — not an inverted literal); --on-accent = text on the accent button;
     --overlay/--shadow = modal scrim + shadow, retuned per theme. */
  :root, :root[data-theme="dark"] {
    color-scheme: dark;
    --bg:#0f1115; --panel:#171a21; --bg-sunken:#0b0d11; --border:#262b36;
    --fg:#e6e9ef; --muted:#8b93a3; --accent:#5b9dff; --on-accent:#08111f;
    --danger:#ff6b6b; --ok:#3fb950; --warn:#e2b93d; --rec:#e5484d;
    --overlay:rgba(4,6,10,.6); --shadow:0 16px 48px rgba(0,0,0,.5); --shadow-sm:0 4px 16px rgba(0,0,0,.4);
  }
  :root[data-theme="light"] {
    color-scheme: light;
    --bg:#f6f7f9; --panel:#ffffff; --bg-sunken:#eef0f3; --border:#d6dae1;
    --fg:#1a1d23; --muted:#5c6470; --accent:#2563d9; --on-accent:#ffffff;
    --danger:#d13c3c; --ok:#1a883f; --warn:#9a6b00; --rec:#d6342c;
    --overlay:rgba(20,24,31,.35); --shadow:0 16px 48px rgba(20,30,50,.18); --shadow-sm:0 4px 16px rgba(20,30,50,.12);
  }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:var(--bg); color:var(--fg); }
  header { display:flex; align-items:center; gap:16px; padding:14px 20px; border-bottom:1px solid var(--border); }
  header .brand { display:inline-flex; align-items:center; gap:8px; }
  header .brand .mark { width:20px; height:20px; color:var(--accent); flex:none; }
  header .brand .word { font-size:16px; font-weight:600; letter-spacing:-0.01em; }
  header .sub { color:var(--muted); font-size:12px; }
  .iconbtn { display:inline-flex; align-items:center; justify-content:center; width:32px; height:32px; padding:0;
    background:none; border:1px solid var(--border); border-radius:8px; color:var(--muted); cursor:pointer; transition:color .15s ease, border-color .15s ease; }
  .iconbtn:hover { color:var(--fg); border-color:var(--accent); }
  .iconbtn svg { width:17px; height:17px; }
  /* LEFT-PANE nav: a vertical sidebar below the header; content to its right. Scoped to
     .shell > nav (direct child) so it does NOT restyle the detail view's inner sub-tab nav
     (Steps/Videos/Review/Logs), which stays a horizontal tab row via its own rules below. */
  .shell { display:flex; align-items:stretch; min-height:calc(100vh - 53px); }
  .shell > nav { display:flex; flex-direction:column; gap:2px; padding:14px 10px; width:180px; flex:none;
    border-right:1px solid var(--border); }
  .shell > nav button { display:block; width:100%; text-align:left; background:none; border:none; color:var(--muted);
    padding:8px 12px; border-radius:7px; cursor:pointer; font:inherit; }
  .shell > nav button.active { color:var(--fg); background:var(--panel); box-shadow:inset 2px 0 0 var(--accent); }
  .shell > nav button:hover:not(.active) { color:var(--fg); background:var(--panel); }
  main { flex:1; min-width:0; padding:20px; display:grid; grid-template-columns:280px 1fr; gap:20px; }
  /* detail sub-tabs: horizontal row (unchanged from the original top-nav look) */
  .detail nav { display:flex; flex-direction:row; gap:4px; width:auto; padding:0; border-right:none; }
  .detail nav button { display:inline-block; width:auto; background:none; border:none; color:var(--muted); padding:8px 12px; cursor:pointer; font:inherit; border-bottom:2px solid transparent; border-radius:0; }
  .detail nav button.active { color:var(--fg); border-bottom-color:var(--accent); }
  .detail nav button:hover { color:var(--fg); }
  @media (max-width: 640px) { .shell { flex-direction:column; } .shell > nav { flex-direction:row; width:auto; flex-wrap:wrap; border-right:none; border-bottom:1px solid var(--border); } }
  .list { border:1px solid var(--border); border-radius:8px; overflow:hidden; align-self:start; }
  .list .row { padding:10px 12px; cursor:pointer; border-bottom:1px solid var(--border); }
  .list .row:last-child { border-bottom:none; }
  .list .row:hover { background:var(--panel); }
  .list .row.active { background:var(--panel); box-shadow:inset 2px 0 0 var(--accent); }
  .list .row .name { font-weight:500; }
  .list .row .meta { color:var(--muted); font-size:12px; }
  .detail { border:1px solid var(--border); border-radius:8px; padding:16px; min-height:200px; }
  /* ── Sessions: full-width list-primary layout ── */
  /* One row = a grid so name+badges+meta line up in COLUMNS and never wrap (the old
     280px column crammed everything into a block). Columns: select · name+badges ·
     site · steps · video · date · delete. Meta columns hide on narrow viewports. */
  .srow { display:grid; grid-template-columns:auto minmax(0,1fr) 160px 90px 56px 150px auto;
    align-items:center; gap:14px; padding:11px 14px; cursor:pointer; border-bottom:1px solid var(--border); }
  .srow:last-child { border-bottom:none; }
  .srow:hover { background:var(--panel); }
  .srow.active { background:var(--panel); box-shadow:inset 2px 0 0 var(--accent); }
  .srow .nm { display:flex; align-items:center; gap:8px; min-width:0; }
  .srow .nm .t { font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .srow .col { color:var(--muted); font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .srow .col.r { text-align:right; }
  .badge { border:1px solid currentColor; border-radius:4px; padding:1px 6px; font-size:10px; line-height:1.5;
    white-space:nowrap; display:inline-flex; align-items:center; gap:3px; }
  .badge.origin-agent { color:var(--accent); }
  .badge.origin-manual { color:var(--muted); }
  .badge.ok { color:var(--ok); }
  .badge.warn { color:var(--warn); }
  .badge.fail { color:var(--danger); }
  .badge.unrev { color:var(--muted); }
  /* review VERDICT banner (outcome-first) + collapsed prose report */
  .verdict { border:1px solid var(--border); border-radius:8px; padding:12px 14px; margin:8px 0 10px; }
  .verdict.ok { border-color:var(--ok); background:color-mix(in srgb, var(--ok) 8%, transparent); }
  .verdict.fail { border-color:var(--danger); background:color-mix(in srgb, var(--danger) 8%, transparent); }
  .verdict .vh { font-weight:600; font-size:14px; }
  .verdict.ok .vh { color:var(--ok); } .verdict.fail .vh { color:var(--danger); }
  .verdict .vs { font-size:12px; margin-top:3px; }
  .verdict .vm { font-size:11px; color:var(--muted); margin-top:5px; }
  .reprep { border:1px solid var(--border); border-radius:6px; }
  .reprep summary { cursor:pointer; padding:8px 12px; font-size:12px; color:var(--muted); user-select:none; }
  .reprep summary:hover { color:var(--fg); }
  .reprep[open] summary { border-bottom:1px solid var(--border); }
  .reprep .repbody { padding:12px; font-size:13px; }
  @media (max-width: 1100px) { .srow { grid-template-columns:auto minmax(0,1fr) 90px 150px auto; }
    .srow .col.site, .srow .col.vid { display:none; } }
  @media (max-width: 760px) { .srow { grid-template-columns:auto minmax(0,1fr) auto; }
    .srow .col.steps, .srow .col.date { display:none; } }
  /* breadcrumb shown when a session is selected (list hidden, detail full-width) */
  .crumbs { display:flex; align-items:center; gap:6px; font-size:13px; margin-bottom:14px; }
  .crumbs a { color:var(--muted); cursor:pointer; text-decoration:none; }
  .crumbs a:hover { color:var(--fg); }
  .crumbs .sep { color:var(--border); }
  .crumbs .cur { color:var(--fg); font-weight:600; }
  .listwrap.fade { animation: fadein .16s ease-out; }
  @keyframes fadein { from { opacity:0 } to { opacity:1 } }
  @media (prefers-reduced-motion: reduce) { .listwrap.fade { animation:none } }
  pre { background:var(--bg-sunken); border:1px solid var(--border); border-radius:6px; padding:12px; overflow:auto; font-size:12px; max-height:70vh; }
  table { width:100%; border-collapse:collapse; }
  td, th { text-align:left; padding:8px 10px; border-bottom:1px solid var(--border); }
  th { color:var(--muted); font-weight:500; font-size:12px; }
  code.val { font-family:ui-monospace,monospace; }
  button.btn { background:var(--panel); border:1px solid var(--border); color:var(--fg); border-radius:6px; padding:5px 10px; cursor:pointer; font:inherit; transition:border-color .15s ease, background .15s ease; }
  button.btn:hover:not(:disabled) { border-color:var(--accent); }
  button.btn.danger:hover:not(:disabled) { border-color:var(--danger); color:var(--danger); }
  button.btn.primary { background:var(--accent); border-color:var(--accent); color:var(--on-accent); font-weight:600; }
  button.btn.primary:hover:not(:disabled) { filter:brightness(1.08); }
  /* New-session MODAL (native <dialog>) */
  dialog.dlg { border:1px solid var(--border); border-radius:12px; background:var(--panel); color:var(--fg); padding:0; width:min(440px,92vw); box-shadow:var(--shadow); }
  dialog.dlg::backdrop { background:var(--overlay); backdrop-filter:blur(2px); }
  .dlgform { display:flex; flex-direction:column; gap:14px; padding:22px 22px 18px; }
  .dlgform h2 { margin:0; font-size:16px; font-weight:600; }
  .dlgform label { display:flex; flex-direction:column; gap:5px; font-size:12px; color:var(--muted); }
  .dlgform input { background:var(--bg-sunken); border:1px solid var(--border); color:var(--fg); border-radius:6px; padding:8px 10px; font:14px/1.4 inherit; }
  /* keep the accent-border cue on focus, but DON'T strip the a11y outline on keyboard focus
     (critique B: input:focus{outline:none} was killing :focus-visible for modal inputs). */
  .dlgform input:focus { border-color:var(--accent); }
  .dlgform input:focus:not(:focus-visible) { outline:none; }
  .dlgmsg { font-size:12px; min-height:16px; }
  .dlgbtns { display:flex; justify-content:flex-end; gap:8px; margin-top:2px; }
  button.btn:disabled { opacity:.4; cursor:not-allowed; }   /* disabled must LOOK disabled (was clickable-looking, live #3) */
  .addrow input, .addrow select { background:var(--bg-sunken); border:1px solid var(--border); color:var(--fg); border-radius:6px; padding:6px 8px; font:inherit; margin-right:6px; }
  select { background:var(--bg-sunken); border:1px solid var(--border); color:var(--fg); border-radius:6px; padding:4px 6px; font:inherit; }
  input.inline { background:var(--bg-sunken); border:1px solid var(--accent); color:var(--fg); border-radius:6px; padding:5px 8px; font:ui-monospace,monospace; width:90%; }
  .cat-head { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.04em; margin:10px 0 2px; }
  .info { color:var(--muted); font-size:13px; cursor:help; font-weight:400; }
  /* Visual/Raw segmented toggle */
  .seg { display:inline-flex; border:1px solid var(--border); border-radius:7px; overflow:hidden; }
  .segbtn { background:none; border:none; color:var(--muted); padding:4px 12px; cursor:pointer; font:inherit; font-size:12px; }
  .segbtn.active { background:var(--panel); color:var(--fg); }
  .segbtn:not(.active):hover { color:var(--fg); }
  /* Visual graph */
  .graphwrap { border:1px solid var(--border); border-radius:8px; background:var(--bg-sunken); padding:8px; }
  .graph { display:block; max-height:70vh; }
  .gnode:hover rect { fill:var(--panel); filter:brightness(1.15); }
  .glegend { display:flex; flex-wrap:wrap; gap:16px; padding:8px 6px 2px; color:var(--muted); font-size:11px; }
  .glegend span { display:inline-flex; align-items:center; gap:5px; }
  .glegend .dot { width:16px; height:2px; border-radius:2px; display:inline-block; }
  .glegend .dot.acc { background:var(--accent); height:3px; }
  .glegend .dot.mut { background:var(--border); }
  .gnote { color:var(--muted); font-size:11px; padding:6px 8px 0; font-style:italic; }
  .gnode:focus-visible rect { stroke-width:2.5; }
  /* node-detail panel (opens under the graph on click) */
  .gpanel { margin-top:12px; border:1px solid var(--border); border-radius:8px; background:var(--panel); padding:14px 16px; }
  .gpanel .phead { font-size:14px; margin-bottom:2px; }
  .gpanel .psec { margin-top:12px; }
  .gpanel .ptitle { font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); margin-bottom:5px; }
  .gpanel .chips { display:flex; flex-wrap:wrap; gap:6px; }
  .gpanel .chip { border:1px solid var(--border); border-radius:5px; padding:2px 8px; font-size:12px; background:var(--bg-sunken); white-space:nowrap; }
  button.morebtn { border-radius:5px; padding:2px 8px; font-size:12px; }   /* .chips already wraps */
  .muted { color:var(--muted); }
  .empty { color:var(--muted); padding:40px 0; text-align:center; }
  /* placeholder must meet contrast (critique: browser-default gray was 4.22:1) — --muted passes. */
  input::placeholder, textarea::placeholder { color:var(--muted); opacity:1; }
  /* keyboard/tap target floor: the row select checkbox was 13px (critique B) — bump it. */
  .srow input[type=checkbox] { width:18px; height:18px; cursor:pointer; }
  /* P0 (critique A): a long unbroken line in a review/markdown report grew a bare <div> to
     4600px and dragged the layout off-screen with no scrollbar. Wrap + clip the detail pane. */
  .detail { overflow-x:auto; }
  .detail div, .detail p, .detail li { overflow-wrap:anywhere; }
  .pulse { animation: webnavpulse 1.2s ease-in-out infinite; }
  @keyframes webnavpulse { 50% { opacity:.35; } }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .list .row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  @media (prefers-reduced-motion: reduce) { .pulse { animation: none; } * { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; } }
  #toast { position:fixed; z-index:100; bottom:16px; right:16px; display:flex; flex-direction:column; gap:8px; pointer-events:none; }
  #toast .t { background:var(--panel); border:1px solid var(--danger); color:var(--fg); border-radius:8px; padding:10px 14px; font-size:13px; max-width:360px; box-shadow:var(--shadow-sm); animation: toastin .18s ease-out; }
  @keyframes toastin { from { opacity:0; transform:translateY(8px); } }
</style>
</head>
<body>
<header>
  <span class="brand">
    <svg class="mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22c4.5-5 7-8.4 7-12A7 7 0 0 0 5 10c0 3.6 2.5 7 7 12z"/><circle cx="12" cy="10" r="2.6" fill="var(--bg)"/></svg>
    <span class="word">webnav</span>
  </span>
  <span class="sub" id="env"></span>
  <span style="flex:1"></span>
  <button id="themebtn" class="iconbtn" title="Toggle light / dark" aria-label="Toggle light / dark theme"></button>
</header>
<div class="shell">
<nav>
  <button data-tab="recordings" class="active">Sessions</button>
  <button data-tab="sites">Sites</button>
  <button data-tab="creds">Credentials</button>
  <button data-tab="profiles">Profiles</button>
</nav>
<main id="main"></main>
</div>

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

// ---------- THEME TOGGLE ----------
// data-theme is already set pre-paint by the <head> bootstrap. This button flips it, persists
// the choice, and swaps its own icon (moon when dark → click for light; sun when light).
const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
function paintThemeBtn() {
  const dark = document.documentElement.getAttribute('data-theme') !== 'light';
  const btn = document.getElementById('themebtn');
  if (btn) btn.innerHTML = dark ? MOON : SUN;   // moon = currently dark (click → light); sun = currently light
}
document.getElementById('themebtn').onclick = () => {
  const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('webnav-theme', next); } catch (e) {}
  paintThemeBtn();
};
paintThemeBtn();

async function getJSON(u, opts) { const r = await fetch(u, opts); if (!r.ok) throw new Error(u + ' -> ' + r.status); return r.json(); }
function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function toast(msg) {
  let box = document.getElementById('toast');
  if (!box) { box = document.createElement('div'); box.id = 'toast'; document.body.appendChild(box); }
  const t = document.createElement('div'); t.className = 't'; t.textContent = String(msg);
  box.appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 4000);
}
// WCAG 2.1.1: clickable row divs need keyboard access. Delegates to the row's
// own click handler (row.click()) so mouse and keyboard paths can't diverge.
function rowKeyboard(row, activate) {
  row.setAttribute('role', 'button');
  row.setAttribute('tabindex', '0');
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      if (e.target !== row) return;   // let inner checkbox/button handle their own keys
      e.preventDefault(); activate();
    }
  });
}

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
      // Header + a Visual / Raw toggle. Visual = a flow graph (states + navigate edges); Raw = the JSON map.
      const head = el('<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><strong>'+esc(s.id)+'</strong><span class="muted" style="flex:1">'+esc(s.homeUrl||'')+'</span><div class="seg"><button class="segbtn active" data-v="visual">Visual</button><button class="segbtn" data-v="raw">Raw</button></div></div>');
      const body = el('<div></div>');
      const draw = (view) => {
        head.querySelectorAll('.segbtn').forEach(b => b.classList.toggle('active', b.dataset.v === view));
        body.innerHTML = '';
        if (view === 'raw') { body.append(el('<pre>'+esc(JSON.stringify(full, null, 2))+'</pre>')); }
        else { body.append(graphView(full.states || [])); }
      };
      head.querySelectorAll('.segbtn').forEach(b => b.onclick = () => draw(b.dataset.v));
      detail.append(head, body);
      draw('visual');
    };
    rowKeyboard(row, () => row.click());
    list.append(row);
  });
  main.append(list, detail);
}

// What we KNOW about one page, filtered of noise. The map stores every affordance, but a lot is
// (a) shared sidebar chrome (Close sidebar / Dark Mode / Switch to Classic / the account switcher)
// and (b) individual DATA rows captured as mutates ("Test_demo - Jul 8…"). Neither describes the
// PAGE. This extracts the signal: key actions, search/filters, what it operates on, sub-views.
const CHROME_RE = /\\b(close sidebar|open sidebar|dark mode|light mode|switch to classic|logo|announcements|help center|dashboards|downloads|reports|analytics agent|admin)\\b/i;
// a label that looks like a DATA ROW, not a control: contains a date/time or a "- <name>" byline.
const DATAROW_RE = /\\b(\\d{1,2}:\\d{2}|\\d{4}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\\b.*(IST|UTC|GMT|AM|PM)|·|—/i;
const ROWSEL_RE = /press space to toggle|column with header selection|row selection/i;
// controls that live INSIDE a sub-dialog/widget, not top-level page actions: pagination, chart-
// axis config, date-range presets, toggles. Real but low-signal for "what can I do here".
const SUBCTRL_RE = /\\b(first|previous|next|last) page\\b|move .* to secondary axis|remove (ad impressions|revenue|win rate|ecpm|united states)|\\b(daily|monthly|yesterday|custom|last 7 days|last 30 days|last month|this month|this year|mtd|ytd)\\b|select all|clear all|dismiss toast|drilldown|open setup panel|^(layout|category|series|cc|bcc)$/i;
function pageFacts(state, chromeLabels) {
  const aff = state.affordances || [];
  const uniq = (arr) => [...new Set(arr)];
  // a VALUE, not a control: a bare number (a chosen page-size like "20" — the option clicked in a
  // dropdown, not an action), a date/number range, a currency, or very long free text.
  const isValueLike = (s) => /^\\d+$/.test(s.trim()) || /\\d{1,2}\\s?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|\\d+:\\d\\d|UTC|IST|\\d{4}-\\d|\\$|%/i.test(s) || s.length > 32;
  // CHROME is computed from the DATA (a label present on most pages = a shared sidebar/global
  // control), NOT a hardcoded list — that generically catches this account's "O Overview Merged
  // Change" workspace-switcher, pagination, "Clear input", etc. without naming them. CHROME_RE is
  // a small backstop for obvious theme controls on a single-page map.
  const clean = (label) => label && !(chromeLabels && chromeLabels.has(label)) && !CHROME_RE.test(label) && !ROWSEL_RE.test(label) && !DATAROW_RE.test(label) && !SUBCTRL_RE.test(label) && !isValueLike(label);
  // OPERATES-ON first (so we can exclude it from actions): domain vocabulary — shadow collection
  // columns + checkbox fields naming a dimension/metric/column (report's Publisher/Revenue/eCPM).
  const filtersRaw = ((state.declaredShadow||{}).filters||[]).filter(f => f.field && !ROWSEL_RE.test(f.field) && !CHROME_RE.test(f.field));
  const columns = uniq(((state.declaredShadow||{}).collections||[]).flatMap(c => c.columns||[]).filter(clean));
  const checkFields = uniq(filtersRaw.filter(f => f.control==='checkbox').map(f => f.field.replace(/ Renamed Previously .*/,'').trim()).filter(clean));
  const operatesOn = uniq([...columns, ...checkFields]);
  const domainSet = new Set(operatesOn);
  // SEARCH + non-domain, non-checkbox filters (search boxes, selects, date pickers)
  const filters = filtersRaw.filter(f => clean(f.field) && f.control!=='checkbox' && !/search/i.test(f.field));
  const hasSearch = filtersRaw.some(f => /search/i.test(f.field)) || aff.some(a => a.kind==='input' && /search/i.test(a.label||''));
  // key ACTIONS = mutate/reveal controls that are NOT chrome, NOT a domain field (those go under
  // Operates-on), NOT a value, NOT a sidebar link. This is what you can DO on the page.
  const actions = uniq(aff.filter(a => (a.kind==='mutate'||a.kind==='reveal') && clean(a.label)
    && !domainSet.has(a.label)).map(a => a.label));
  // SUB-VIEWS = self-loop nav (Table/Charts, Nested/Flat)
  const subviews = uniq(aff.filter(a => a.kind==='navigate' && a.toState===state.id).map(a => a.label));
  const counts = { navigate:0, reveal:0, mutate:0, input:0 };
  aff.forEach(a => { if (counts[a.kind]!==undefined) counts[a.kind]++; });
  return { actions, hasSearch, filters, operatesOn, subviews, counts };
}

// ---------- VISUAL GRAPH (zero-dep SVG, LAYERED TREE) ----------
// A website is a HIERARCHY, not a peer-mesh: a hub → sections (report-list / dashboard-list /
// downloads / help / announcements) → detail pages (a report, a dashboard) → deeper. The
// "every page links to every other page" edges are just the SHARED SIDEBAR present on every
// page — that's chrome, not structure, and drawing it as edges made a hairball (the radial
// version's failure). So: SUPPRESS the sidebar mesh, keep only STRUCTURAL edges (a link from
// few pages to a specific target), and lay the result out top-down by depth. The shared sidebar
// is stated once as a caption, not 30 crossing lines.
function graphView(allStates) {
  // the site-wide chrome record (nav/header/footer, present on every page) isn't a page itself —
  // it's shown once as its own card above the tree, not as a node inside it (Task 13).
  const isShell = (s) => s.role === 'shell' || (s.id||'').split(':').pop() === '_shell';
  const shellState = allStates.find(isShell);
  const states = allStates.filter(s => !isShell(s));
  const lbl = (s) => s.semanticName || (s.id||'').split(':').pop();
  const byId = {}; states.forEach(s => byId[s.id] = s);
  const idLbl = (id) => byId[id] ? lbl(byId[id]) : (id||'').split(':').pop();
  const names = states.map(lbl);
  const N = names.length;
  if (!N) return el('<div class="empty">no states to graph</div>');
  const svgEsc = (x) => String(x).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

  // HIERARCHY IS READ FROM THE MAP, not guessed. Each state carries role + parentState, set at
  // analyse time from the observed nav structure (a link on most pages = shared sidebar; a page
  // reached only via a content link = a child). The viewer just lays it out — no frequency/URL
  // heuristics here. parentState is a full id; map it to a label.
  const parentLbl = (s) => (s.parentState && byId[s.parentState]) ? lbl(byId[s.parentState]) : null;
  // structural (parent→child) edges come straight from parentState. Keep the drill-in link label
  // by matching the parent's navigate affordance that points at this child.
  const structural = [];
  states.forEach(s => { const p = parentLbl(s); if (!p) return;
    const parentSt = states.find(x => lbl(x) === p);
    const via = (parentSt?.affordances || []).find(a => a.kind === 'navigate' && idLbl(a.toState) === lbl(s));
    structural.push({ from: p, to: lbl(s), via: via ? (via.label || via.semanticStep || '') : '' });
  });
  const selfBy = {};
  states.forEach(s => (s.affordances||[]).forEach(a => { if (a.kind === 'navigate' && a.toState && idLbl(a.toState) === lbl(s)) (selfBy[lbl(s)] = selfBy[lbl(s)] || []).push(a.label || a.semanticStep || ''); }));
  // the shared sidebar = the distinct link labels that reach a SECTION (a parentless state) from
  // more than one page — surfaced as a caption, not drawn.
  const sectionSet = new Set(states.filter(s => !parentLbl(s)).map(lbl));
  const sidebarLabels = [...new Set(states.flatMap(s => (s.affordances||[])
    .filter(a => a.kind === 'navigate' && a.toState && sectionSet.has(idLbl(a.toState)) && idLbl(a.toState) !== lbl(s))
    .map(a => a.label || '')))].filter(v => v && !/\b(logo|home)\b/i.test(v));

  // LAYOUT: synthetic hub row 0; sections (no parent) row 1; a child sits one row below its
  // parent — depth = length of the parentState chain.
  const ROOT = '⌂ ' + (states[0] ? (states[0].id.split(':')[0]) : 'site');
  const depthOf = (s, guard) => { let d = 1, cur = s, g = 0; while (parentLbl(cur) && g++ < 20) { const p = states.find(x => lbl(x) === parentLbl(cur)); if (!p) break; d++; cur = p; } return d; };
  const depth = {}; names.forEach(n => { const s = states.find(x => lbl(x) === n); depth[n] = depthOf(s); });
  const maxDepth = Math.max(1, ...Object.values(depth));

  // LAYOUT: rows top→down, nodes spread across each row.
  const NW = 158, NH = 48, rowGap = 118, colGap = 22, padX = 30, padTop = 54;  // taller box: name + summary line
  const byRow = {}; for (let d=0; d<=maxDepth; d++) byRow[d] = [];
  byRow[0] = [ROOT];
  names.forEach(n => byRow[depth[n]].push(n));
  const rowW = (r) => r.length * NW + (r.length-1) * colGap;
  const maxRowW = Math.max(...Object.values(byRow).map(rowW));
  const W = Math.max(560, maxRowW + padX*2), H = padTop + (maxDepth)*rowGap + NH + 40;
  const pos = {};
  for (let d=0; d<=maxDepth; d++){ const r=byRow[d]; const startX=(W - rowW(r))/2; r.forEach((n,i)=>{ pos[n]={x:startX + i*(NW+colGap) + NW/2, y:padTop + d*rowGap}; }); }

  // edge from parent-center-bottom to child-center-top (clean vertical-ish flow, no center cross)
  const link = (from,to,cls,label) => {
    const a=pos[from], b=pos[to]; if(!a||!b) return '';
    const ay=a.y+NH/2, by=b.y-NH/2, midY=(ay+by)/2;
    const d='M '+a.x+' '+ay+' C '+a.x+' '+midY+', '+b.x+' '+midY+', '+b.x+' '+by;
    const stroke = cls==='struct' ? 'var(--accent)' : 'var(--border)';
    const sw = cls==='struct' ? 2 : 1.2;
    let out = '<path d="'+d+'" stroke="'+stroke+'" stroke-width="'+sw+'" fill="none" marker-end="url(#'+(cls==='struct'?'ga':'gm')+')"'+(cls!=='struct'?' opacity="0.6"':'')+'/>';
    if (label) out += '<text x="'+((a.x+b.x)/2)+'" y="'+(midY-3)+'" fill="var(--fg)" font-size="10" text-anchor="middle" paint-order="stroke" stroke="var(--bg-sunken)" stroke-width="3.5">'+svgEsc(label.length>24?label.slice(0,23)+'…':label)+'</text>';
    return out;
  };

  let s = '<svg class="graph" viewBox="0 0 '+W+' '+H+'" width="100%" preserveAspectRatio="xMidYMid meet">';
  s += '<defs><marker id="ga" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="var(--accent)"/></marker>'
     + '<marker id="gm" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 z" fill="var(--border)"/></marker></defs>';
  // root → sections (faint, unlabeled — it's just "these are the sections")
  byRow[1].forEach(n => { s += link(ROOT, n, 'sect', ''); });
  // structural edges (bold, labeled) — parent → child (from stored parentState)
  structural.forEach(e => { if (pos[e.from] && pos[e.to]) s += link(e.from, e.to, 'struct', e.via); });
  // per-node facts (filtered) → a compact ONE-LINE summary shown under the name.
  // CHROME LABELS = any affordance label present on ≥60% of pages (a shared sidebar/global
  // control — the account switcher, pagination, Clear input, …). Computed from the data, so it
  // catches site-specific chrome no hardcoded list would (e.g. "O Overview Merged Change").
  const labelPages = {};
  states.forEach(s => { const seen = new Set(); (s.affordances||[]).forEach(a => { if (a.label && !seen.has(a.label)) { seen.add(a.label); labelPages[a.label] = (labelPages[a.label]||0)+1; } }); });
  const chromeCut2 = Math.max(3, Math.ceil(states.length * 0.6));
  const chromeLabels = new Set(Object.entries(labelPages).filter(([,c]) => c >= chromeCut2).map(([l]) => l));
  const factsBy = {}; states.forEach(st => factsBy[lbl(st)] = pageFacts(st, chromeLabels));
  const summaryLine = (n) => { const f = factsBy[n]; if (!f) return '';
    const bits = [];
    if (f.actions.length) bits.push(f.actions.length + (f.actions.length===1?' action':' actions'));
    if (f.hasSearch) bits.push('search');
    if (f.operatesOn.length) bits.push(f.operatesOn.length + ' fields');
    if (f.subviews.length) bits.push(f.subviews.length + ' views');
    return bits.join(' · ');
  };
  // nodes (root first, then states). NH grows to fit the summary line.
  const drawNode = (n, isRoot) => { const p=pos[n]; const summ = isRoot ? '' : summaryLine(n);
    const st = isRoot ? null : states.find(x => lbl(x) === n);
    const provMark = st && st.provisional ? ' ◌' : '';   // grey "seen once" marker; full note in the click panel
    let g = '<g class="gnode" data-state="'+svgEsc(n)+'" tabindex="0" role="button" style="cursor:pointer">';
    g += '<rect x="'+(p.x-NW/2)+'" y="'+(p.y-NH/2)+'" width="'+NW+'" height="'+NH+'" rx="8" fill="var(--panel)" stroke="'+(isRoot?'var(--muted)':'var(--accent)')+'" stroke-width="1.5"'+(isRoot?' stroke-dasharray="4 3"':'')+'/>';
    g += '<text x="'+p.x+'" y="'+(p.y+(summ?-3:4))+'" fill="var(--fg)" font-size="12" font-weight="600" text-anchor="middle">'+svgEsc(n)+(provMark?'<tspan fill="var(--muted)">'+provMark+'</tspan>':'')+'</text>';
    if (summ) g += '<text x="'+p.x+'" y="'+(p.y+13)+'" fill="var(--muted)" font-size="9" text-anchor="middle">'+svgEsc(summ)+'</text>';
    return g + '</g>'; };
  s += drawNode(ROOT, true);
  names.forEach(n => { s += drawNode(n, false); });
  s += '</svg>';

  const sidebarNote = sidebarLabels.length
    ? '<div class="gnote">Every page also shares a common sidebar (' + sidebarLabels.map(svgEsc).join(' · ') + ') — omitted here to show real structure.</div>'
    : '';
  // "Site shell" card: the chrome record's affordances (nav/header/footer present on every page)
  // shown ONCE above the tree, not as a node inside it — see isShell above.
  const shellCard = (() => {
    if (!shellState) return '';
    const affs = shellState.affordances || [];
    if (!affs.length) return '';
    const chip = (a) => '<span class="chip">'+esc(a.label)+' <span class="muted">'+esc(a.kind)+'</span>'
      + (a.kind === 'navigate' && a.toState ? ' <span class="muted">&rarr; '+esc(idLbl(a.toState))+'</span>' : '')+'</span>';
    return '<div class="gpanel" style="margin-bottom:12px"><div class="phead"><strong>Site shell</strong> <span class="muted">chrome on every page</span></div>'
      + '<div class="chips" style="margin-top:8px">'+affs.map(chip).join('')+'</div></div>';
  })();
  const wrap = el('<div class="graphwrap">'+shellCard+s+sidebarNote
    + '<div class="glegend"><span><i class="dot acc"></i> navigates to a specific page</span><span><i class="dot mut"></i> section of the hub</span><span>↻ in-page sub-view</span><span class="muted">click a page for details</span></div>'
    + '<div class="gpanel" style="display:none"></div></div>');
  // click a node → render its full filtered facts into the panel
  const panel = wrap.querySelector('.gpanel');
  // affordances scoped 'row' (a folded per-row repeat, e.g. 50 identical row-buttons folded to
  // one) get a "per row" suffix chip so the count isn't misread as 50 distinct page actions.
  // scope 'widget' (a folded repeated widget/card subtree, e.g. 3 dashboard chart widgets folded
  // to one template) gets the same treatment with a "widget" suffix chip — no count is stored.
  const rowScoped = (state, label) => (state.affordances||[]).some(a => a.label === label && a.scope === 'row');
  const widgetScoped = (state, label) => (state.affordances||[]).some(a => a.label === label && a.scope === 'widget');
  const openPanel = (name) => {
    const st = states.find(x => lbl(x) === name); if (!st) { panel.style.display='none'; return; }
    const f = factsBy[name];
    const actionChip = (x) => '<span class="chip">'+esc(x)+(rowScoped(st, x)?' <span class="muted">per row</span>':'')+(widgetScoped(st, x)?' <span class="muted">widget</span>':'')+'</span>';
    const chips = (items) => items.length ? items.map(x => '<span class="chip">'+esc(x)+'</span>').join('') : '<span class="muted">—</span>';
    const sec = (title, inner) => '<div class="psec"><div class="ptitle">'+title+'</div>'+inner+'</div>';
    let html = '<div class="phead"><strong>'+esc(name)+'</strong> <span class="badge '+(st.role==='detail'?'origin-manual':'ok')+'">'+esc(st.role||'page')+'</span>'
      + (st.provisional ? ' <span class="badge unrev" title="'+esc(st.provisional)+'">◌ Seen once</span>' : '')
      + (st.parentState ? ' <span class="muted">under '+esc((st.parentState||'').split(':').pop())+'</span>' : '')
      + '<button class="btn" style="float:right;padding:1px 8px" data-close>✕</button></div>';
    // urlPattern may carry a template placeholder ({param}) — render verbatim, never linkify.
    html += '<div class="muted" style="font-size:12px;margin-bottom:8px">'+esc(st.urlPattern||'')+'</div>';
    if (st.provisional) html += '<div class="muted" style="font-size:12px;margin-bottom:8px">◌ '+esc(st.provisional)+'</div>';
    const actShown = f.actions.slice(0, 24);
    const moreCount = f.actions.length - actShown.length;
    html += sec('Key actions ('+f.actions.length+')', '<div class="chips" data-actions>'+actShown.map(actionChip).join('')
      + (moreCount > 0 ? '<button class="btn morebtn" data-more>+'+moreCount+' more</button>' : '')+'</div>');
    if (f.hasSearch || f.filters.length) html += sec('Search & filters', '<div class="chips">'+(f.hasSearch?'<span class="chip">🔍 search</span>':'')+chips(f.filters.filter(x=>!/search/i.test(x.field)).map(x=>x.field+' ('+x.control+')'))+'</div>');
    if (f.operatesOn.length) html += sec('Operates on ('+f.operatesOn.length+')', '<div class="chips">'+chips(f.operatesOn)+'</div>');
    if (f.subviews.length) html += sec('In-page sub-views', '<div class="chips">'+chips(f.subviews)+'</div>');
    html += sec('Affordances', '<span class="muted" style="font-size:12px">'+f.counts.navigate+' navigate · '+f.counts.reveal+' reveal · '+f.counts.mutate+' mutate · '+f.counts.input+' input</span>');
    panel.innerHTML = html; panel.style.display='';
    panel.querySelector('[data-close]').onclick = () => { panel.style.display='none'; };
    const moreBtn = panel.querySelector('[data-more]');
    if (moreBtn) moreBtn.onclick = () => {
      const rest = f.actions.slice(actShown.length).map(actionChip).join('');
      moreBtn.insertAdjacentHTML('beforebegin', rest);
      moreBtn.remove();
    };
  };
  wrap.querySelectorAll('.gnode').forEach(g => {
    const name = g.getAttribute('data-state');
    if (name.indexOf('⌂') === 0) return;   // root isn't a real page
    g.onclick = () => openPanel(name);
    g.addEventListener('keydown', (e) => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); openPanel(name); } });
  });
  return wrap;
}

// ---------- PROFILES (named, shared logged-in browser states) ----------
async function renderProfiles() {
  main.style.gridTemplateColumns = '1fr';
  const profs = await getJSON('/api/profiles');
  main.innerHTML = '';
  const wrap = el('<div></div>');
  // Title only + info icon (project rule: no descriptive subtitle prose; explanation behind an
  // info affordance — matches the badge+title pattern used elsewhere). Was a ~190-char paragraph
  // forced into the tiny-uppercase eyebrow style (critique A, P1).
  wrap.append(el('<h2 style="font-size:15px;font-weight:600;margin:0 0 12px;display:flex;align-items:center;gap:6px">Browser profiles <span class="info" title="A logged-in browser state kept on disk (Cloudflare / SSO / 2FA done once by hand). Every session under a profile reuses its login; a walk reuses it via --profile &lt;name&gt;. New sessions use default." aria-label="about profiles">&#9432;</span></h2>'));
  const newBar = el('<div style="display:flex;gap:8px;margin:8px 0"><button class="btn">+ New profile</button></div>');
  newBar.querySelector('button').onclick = async () => {
    const name = prompt('New profile name (e.g. default, work-google):', 'default');
    if (!name) return;
    const res = await fetch('/api/profiles', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ name }) });
    if (!res.ok) { toast((await res.json()).error); return; }
    const o = await fetch('/api/profiles/'+encodeURIComponent(name)+'/open', { method:'POST' });   // straight into log-in
    if (!o.ok) toast((await o.json()).error);
    renderProfiles();
  };
  wrap.append(newBar);
  if (!profs.length) { wrap.append(el('<div class="empty">no profiles yet — create one and log in once, or just start a session (it uses "default")</div>')); main.append(wrap); startEvents(); return; }
  const tbl = el('<table><thead><tr><th>Profile</th><th>Site</th><th>Status</th><th>Sessions</th><th>Size</th><th>Last used</th><th></th></tr></thead><tbody></tbody></table>');
  const tb = tbl.querySelector('tbody');
  profs.forEach(pf => {
    // Presence (window open) is plain — NOT styled like the Sessions-tab recording
    // pulse (no --rec color, no pulse animation): a login window is not a recording.
    const tr = el('<tr><td><code>'+esc(pf.name)+'</code>'+(pf.open?' <span class="muted">🪟 window open</span>':'')+'</td><td class="muted">'+esc(pf.site||'—')+'</td><td></td><td class="muted">'+pf.sessions+'</td><td class="muted">'+pf.sizeMb+' MB</td><td class="muted" style="font-size:12px">'+(pf.lastUsed?new Date(pf.lastUsed).toLocaleString():'—')+'</td><td style="text-align:right"></td></tr>');
    tr.children[2].append(statusChip(pf));
    const act = tr.children[6];
    const authValid = pf.status && pf.status.auth === 'valid';
    const openB = el('<button class="btn">Open to log in</button>');
    // Open to log in is valid ONLY when needs-login/unknown (or no check yet) AND no
    // window is already live — never while a check shows the profile is already ✓
    // Valid (the exact live-use complaint: a still-enabled button after "I'm already
    // logged in").
    openB.disabled = pf.open || !!authValid;
    if (pf.open) openB.title = 'a login window is already open for this profile';
    else if (authValid) openB.title = 'already ✓ Valid — no need to log in again';
    openB.onclick = async () => {
      openB.disabled = true; openB.textContent = 'opening…';
      const res = await fetch('/api/profiles/'+encodeURIComponent(pf.name)+'/open', { method:'POST' });
      if (!res.ok) toast((await res.json()).error);
      renderProfiles();
    };
    const renB = el('<button class="btn" style="margin-left:6px">Rename</button>');
    renB.onclick = async () => {
      const to = prompt('Rename profile "'+pf.name+'" to:', pf.name);
      if (!to || to === pf.name) return;
      const res = await fetch('/api/profiles/'+encodeURIComponent(pf.name)+'/rename', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ to }) });
      if (!res.ok) toast((await res.json()).error);
      renderProfiles();
    };
    const resetB = el('<button class="btn danger" style="margin-left:6px" title="logs out ALL sites in this profile — use to log in with a different account">Reset profile</button>');
    resetB.onclick = async () => {
      if (prompt('Reset profile "'+pf.name+'"? This logs out ALL sites in it — use to log in with a different account. Type "reset '+pf.name+'" to confirm:') !== 'reset '+pf.name) return;
      const res = await fetch('/api/profiles/'+encodeURIComponent(pf.name)+'/reset', { method:'POST' });
      if (!res.ok) toast((await res.json()).error);
      renderProfiles();
    };
    const delB = el('<button class="btn danger" style="margin-left:6px">Delete</button>');
    delB.onclick = async () => {
      if (!confirm('Delete profile '+pf.name+'? This logs it out — sessions using it hit the login wall next time.')) return;
      await fetch('/api/profiles/'+encodeURIComponent(pf.name), { method:'DELETE' });
      renderProfiles();
    };
    act.append(openB, renB, resetB, delB);
    tb.append(tr);
  });
  wrap.append(tbl);
  main.append(wrap);
  startEvents();   // 'sessions' events (profile open/close/rename/delete) refresh this tab
}

// Coarse relative time (minutes/hours/days) — just enough for a "checked Ns ago" label.
function timeAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.round(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.round(h / 24) + 'd ago';
}

// Status chip (✓ Valid / ⚠ Needs login / – Unknown) + last-checked + a per-row "Check"
// button that runs the SAME classifyAuthLanding engine as the dev profile-status verb (server
// caches the result; this just triggers a fresh check and re-renders on completion).
function statusChip(pf) {
  const box = el('<span style="display:inline-flex;align-items:center;gap:6px"></span>');
  if (!pf.site) {
    box.append(el('<span class="badge unrev" title="no site associated — check via a session or set on first login">– Unknown</span>'));
    return box;
  }
  const s = pf.status;
  const chip = !s ? el('<span class="badge unrev" title="not checked yet">– Unknown</span>')
    : s.auth === 'valid' ? el('<span class="badge ok" title="landed on a known logged-in state">&#10003; Valid</span>')
    : s.auth === 'needs-login' ? el('<span class="badge warn" title="'+esc(s.loginUrl||'login required')+'">&#9888; Needs login</span>')
    : el('<span class="badge unrev" title="no map yet / ambiguous landing">– Unknown</span>');
  box.append(chip);
  if (s) box.append(el('<span class="muted" style="font-size:11px">'+timeAgo(s.checkedAt)+'</span>'));
  const checkB = el('<button class="btn" style="padding:1px 8px;font-size:11px">Check</button>');
  checkB.onclick = async (e) => {
    e.stopPropagation();
    checkB.disabled = true; checkB.textContent = 'checking…';
    const res = await fetch('/api/profiles/'+encodeURIComponent(pf.name)+'/status', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ site: pf.site }) });
    if (!res.ok) toast((await res.json()).error || 'check failed');
    renderProfiles();
  };
  box.append(checkB);
  return box;
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

// Sessions tab = list-PRIMARY (full width). Selecting a session swaps in a breadcrumb +
// full-width detail; the "Sessions" crumb returns to the list. openId (a session id) opens
// straight into that session's detail (used after New session / a soft re-render on that view).
async function renderRecordings(openId) {
  clearInterval(replayPoll); replayPoll = null;
  main.style.gridTemplateColumns = '1fr';
  const recs = await getJSON('/api/recordings');
  try { winSession = (await getJSON('/api/recordings/window')).session; } catch { winSession = null; }
  main.innerHTML = '';
  rowEls = {}; detailCtx = null;
  // If asked to open a specific session (and it exists), go straight to its detail view.
  if (openId && recs.some(r => r.sessionId === openId)) { openDetail(recs.find(r => r.sessionId === openId)); startEvents(); return; }

  const wrap = el('<div class="listwrap fade"></div>');
  const selected = new Set();
  // Toolbar (FIXED height — its contents toggle, they never insert into the list, so the
  // list NEVER reflows/shifts when you select a row). Left: count / "N selected". Right:
  // Delete-selected (shown only when a selection exists) · Clear all · + New session.
  const bar = el('<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;min-height:32px">'
    + '<span class="muted bar-count" style="font-size:13px"></span><span style="flex:1"></span>'
    + '<button class="btn danger bar-delsel" style="padding:2px 10px;display:none"></button>'
    + (recs.length ? '<button class="btn danger bar-clear" style="padding:2px 10px">Clear all</button>' : '')
    + '<button class="btn bar-new" style="padding:2px 10px">+ New session</button></div>');
  wrap.append(bar);
  const setCount = () => { bar.querySelector('.bar-count').textContent = selected.size
    ? selected.size+' selected' : recs.length+' session'+(recs.length===1?'':'s'); };
  const syncBulk = () => {
    const b = bar.querySelector('.bar-delsel');
    b.style.display = selected.size ? '' : 'none';
    b.textContent = 'Delete selected ('+selected.size+')';
    setCount();
  };
  setCount();
  bar.querySelector('.bar-delsel').onclick = async () => {
    if (!confirm('Delete '+selected.size+' session(s)?')) return;
    for (const id of selected) await fetch('/api/recordings/'+encodeURIComponent(id), { method:'DELETE' });
    renderRecordings();
  };
  const clearBtn = bar.querySelector('.bar-clear');
  if (clearBtn) clearBtn.onclick = async () => {
    if (prompt('Delete ALL '+recs.length+' sessions (steps, videos, reviews)? This cannot be undone. Type "delete all" to confirm:') !== 'delete all') return;
    for (const rr of recs) await fetch('/api/recordings/'+encodeURIComponent(rr.sessionId), { method:'DELETE' });
    renderRecordings();
  };
  bar.querySelector('.bar-new').onclick = () => openNewSessionDialog();

  const list = el('<div class="list"></div>');
  recs.forEach(r => {
    const row = el('<div class="srow"><input type="checkbox" style="width:auto" aria-label="select" /><div class="nm"></div><div class="col site"></div><div class="col steps r"></div><div class="col vid r"></div><div class="col date r"></div><button class="btn danger" title="delete" style="padding:2px 8px">✕</button></div>');
    rowEls[r.sessionId] = row;
    fillRow(row, r);
    row.onclick = () => openDetail(r);
    rowKeyboard(row, () => row.click());
    const cb = row.querySelector('input[type=checkbox]');
    cb.onclick = (e) => { e.stopPropagation(); if (cb.checked) selected.add(r.sessionId); else selected.delete(r.sessionId); syncBulk(); };
    row.querySelector('button.danger').onclick = async (e) => {
      e.stopPropagation();
      if (!confirm('Delete session '+r.sessionId+'?')) return;
      await fetch('/api/recordings/'+encodeURIComponent(r.sessionId), { method:'DELETE' });
      renderRecordings();
    };
    list.append(row);
  });
  if (!recs.length) list.append(el('<div class="empty">No sessions yet. Click <strong>+ New session</strong> to record one.</div>'));
  wrap.append(list);
  main.append(wrap);
  startEvents();
}

// Drill into ONE session: breadcrumb + full-width detail (list hidden). "Sessions" returns.
function openDetail(r) {
  main.style.gridTemplateColumns = '1fr';
  main.innerHTML = '';
  const wrap = el('<div class="listwrap fade"></div>');
  const crumbs = el('<div class="crumbs"><a tabindex="0">Sessions</a><span class="sep">/</span><span class="cur"></span></div>');
  crumbs.querySelector('.cur').textContent = r.sessionId;
  const back = crumbs.querySelector('a');
  back.onclick = () => renderRecordings();
  back.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); renderRecordings(); } });
  const detail = el('<div class="detail"></div>');
  wrap.append(crumbs, detail);
  main.append(wrap);
  showRecording(r, detail);
}
function originTag(origin) {
  const agent = origin === 'agent';
  return '<span class="badge origin-'+(agent?'agent':'manual')+'">'+(agent?'Agent':'Manual')+'</span>';
}
// Capture-review badge from the stored verdict (webnav dev review). Verified (green) = zero
// gaps, graph-ready; needs-fix (amber, with gap count) = review found capture gaps; nothing =
// never reviewed. Titled with the verdict reason so hovering explains WHY.
// Three states, all shown (so failed captures are VISIBLE, not just absent-of-green):
//  approved → ✓ Verified (green) · reviewed-but-not-approved → ⚠ Failed N gaps (red) ·
//  never reviewed → Unverified (grey). Only APPROVED sessions build the graph (approval gate).
function reviewBadge(review) {
  if (!review) return '<span class="badge unrev" title="not reviewed yet — run a review before building a graph from it">Unverified</span>';
  if (review.approved) return '<span class="badge ok" title="'+esc(review.reason||'all on-screen actions captured')+'">✓ Verified</span>';
  const n = review.gaps || 0;
  return '<span class="badge fail" title="'+esc(review.reason||'capture gaps found — not used to build the graph')+'">⚠ Failed'+(n?' · '+n+' gap'+(n===1?'':'s'):'')+'</span>';
}
function fillRow(row, r) {
  // name column: recording dot (if active) + name + Agent/Manual + Verified badges, on ONE line.
  row.querySelector('.nm').innerHTML = (r.active ? '<span style="color:var(--rec)" class="pulse">●</span>' : '')
    + '<span class="t">'+esc(r.sessionId)+'</span>'+originTag(r.origin)+reviewBadge(r.review);
  const site = row.querySelector('.col.site'); if (site) site.textContent = r.site || '—';
  const steps = row.querySelector('.col.steps'); if (steps) steps.textContent = r.steps+' step'+(r.steps===1?'':'s');
  const vid = row.querySelector('.col.vid'); if (vid) vid.innerHTML = r.videoCount ? '\\uD83C\\uDFA5 '+r.videoCount : '';   // 🎥 N
  const date = row.querySelector('.col.date'); if (date) date.textContent = new Date(r.startedAt).toLocaleDateString();
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
  // DETAIL open: the list isn't rendered (rowEls empty) — just refresh the open header below,
  // don't run the list-set diff (it would spuriously full-re-render every tick).
  if (!detailCtx) {
    const ids = recs.map(r => r.sessionId).sort().join('|');
    const anyChecked = [...document.querySelectorAll('.list input[type=checkbox]')].some(c => c.checked);
    if (ids !== Object.keys(rowEls).sort().join('|')) { if (!anyChecked) renderRecordings(); return; }
    recs.forEach(r => { const row = rowEls[r.sessionId]; if (row) fillRow(row, r); });
  }
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

// New session as a native <dialog> MODAL (impeccable: use <dialog>, not an absolute div; it
// escapes the stacking context + gives a backdrop + Esc-to-close for free). Collect name/url/
// profile → open the window → close → drill STRAIGHT into that session's detail page.
function openNewSessionDialog() {
  document.getElementById('newdlg')?.remove();
  const d = new Date(), p2 = (x) => String(x).padStart(2, '0');
  // default name (editable): s-MMDDHHMMSS — SHORT on purpose (playwright-cli daemon socket
  // path embeds it; macOS caps socket paths ~104 chars — a long name → listen EINVAL).
  const defName = 's-' + p2(d.getMonth()+1) + p2(d.getDate()) + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
  const dlg = el('<dialog id="newdlg" class="dlg">'
    + '<form method="dialog" class="dlgform">'
    + '<h2>New session</h2>'
    + '<label>Session name<input name="sess" autocomplete="off" /></label>'
    + '<label>Start URL <span class="muted">(optional)</span><input name="url" placeholder="blank window — navigate yourself" autocomplete="off" /></label>'
    + '<label>Profile <span class="muted">(logged-in state reused; blank = throwaway)</span><input name="prof" autocomplete="off" /></label>'
    + '<div class="dlgmsg muted"></div>'
    + '<div class="dlgbtns"><button type="button" class="btn" value="cancel">Cancel</button><button type="button" class="btn primary" value="go">Open window &amp; record</button></div>'
    + '</form></dialog>');
  document.body.append(dlg);
  const sessIn = dlg.querySelector('[name=sess]'), urlIn = dlg.querySelector('[name=url]'), profIn = dlg.querySelector('[name=prof]');
  sessIn.value = defName; profIn.value = 'default';
  const msg = dlg.querySelector('.dlgmsg');
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.querySelector('[value=cancel]').onclick = close;
  dlg.addEventListener('cancel', close);   // Esc
  const go = async () => {
    if (!sessIn.value.trim()) { msg.textContent = 'session name required'; sessIn.focus(); return; }
    const profile = profIn.value.trim();   // blank → throwaway (persistent:false)
    msg.textContent = 'opening window…';
    const r = await fetch('/api/recordings/open', { method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ url: urlIn.value || 'about:blank', session: sessIn.value.trim(), persistent: !!profile, profile: profile || undefined }) });
    if (!r.ok) { msg.textContent = (await r.json()).error || 'failed to open'; return; }
    const id = sessIn.value.trim();
    close();
    // drill STRAIGHT into the new session's detail page (its window is opening + recording).
    setTimeout(() => renderRecordings(id), 400);
  };
  dlg.querySelector('[value=go]').onclick = go;
  sessIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  dlg.showModal();
  sessIn.focus(); sessIn.select();
}

// The detail header: state + action buttons. Rebuilt IN PLACE on state changes.
function buildHead(ctx) {
  const r = ctx.r;
  const hasWindow = winSession === r.sessionId;
  ctx.hasWindow = hasWindow;
  const recState = r.active ? '<span class="pulse" style="color:var(--rec);font-weight:600">● recording…</span>'
    : hasWindow ? '<span class="muted">🪟 window open (armed)</span>'
    : winSession ? '<span class="muted">window busy: '+esc(winSession)+'</span>' : '';
  ctx.headBox.innerHTML = '';
  const profBadge = r.hasProfile ? ' <span title="runs under this saved-login profile" style="border:1px solid var(--ok);color:var(--ok);border-radius:4px;padding:0 5px;font-size:10px">\uD83D\uDD10 '+esc(r.profile)+'</span>' : '';
  const head = el('<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><strong>'+esc(r.sessionId)+'</strong>'+originTag(r.origin)+'<span class="muted">'+esc(r.site||'')+'</span>'+profBadge+'<span class="hstate">'+recState+'</span><span style="flex:1"></span></div>');
  const btn = (t, danger) => el('<button class="btn'+(danger?' danger':'')+'">'+t+'</button>');
  const repB = btn('▶ Replay'), repXB = btn('▶ Replay exact'), anB = btn('Analyse → draft'), delB = btn('Delete', true);
  repB.title = 'Replays the cleaned-up route. Finds each element again even if the page changed. Best for repeatable automation.';
  repXB.title = 'Replays exactly what was done, event by event, nothing skipped. Best for exact reruns and for checking the recording caught everything.';
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
    if (!res.ok) { toast((await res.json()).error); }
    softRefresh('sessions');
  };
  const recB = btn(r.active ? '■ Stop' : '⏺ Record');
  // Record is active ONLY when this session's window is open (#3). Stop stays
  // enabled while recording (always allow stopping). Greyed when no window.
  recB.disabled = !hasWindow && !r.active;
  if (!hasWindow && !r.active) recB.title = 'open a window first';
  if (r.active) recB.style.borderColor = 'var(--rec)';
  recB.onclick = async () => {
    // OPTIMISTIC: flip the header immediately; the server confirms via SSE.
    const starting = !r.active;
    head.querySelector('.hstate').innerHTML = starting
      ? '<span class="pulse" style="color:var(--rec);font-weight:600">● recording…</span>'
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
  // Two replay modes: 'steps' (the cleaned-up route) and 'ledger' (event-by-event, exact).
  const startReplay = async (mode) => {
    const res = await fetch('/api/recordings/'+encodeURIComponent(r.sessionId)+'/replay',
      { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ mode: mode }) });
    if (!res.ok) { toast((await res.json()).error); return; }
    setSubTab(ctx, 'steps');
    pollReplay(ctx.stepsBox, r.sessionId);
  };
  repB.onclick = () => startReplay('steps');
  repXB.onclick = () => startReplay('ledger');
  head.append(openB, recB, repB, repXB, anB, delB);
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

// --- Ledger sub-tab: the RAW event record with each event's fate. This is the
// deterministic capture-coverage view (events → steps); drops are assembly losses.
async function loadLedger(ctx) {
  let d = null;
  try { d = await getJSON('/api/recordings/'+encodeURIComponent(ctx.r.sessionId)+'/events'); } catch { return; }
  ctx.ledgerBox.innerHTML = '';
  if (!d || !d.events || !d.events.length) {
    ctx.ledgerBox.append(el('<div class="muted" style="margin:8px 0">No ledger — this session was recorded before the ledger existed. Steps replay still works.</div>'));
    return;
  }
  const c = d.coverage;
  ctx.ledgerBox.append(el('<div style="margin:8px 0">'+c.total+' events \\u2192 '+c.captured+' steps'
    + (c.dropped.length ? ' \\u00B7 <span style="color:var(--rec);font-weight:600">'+c.dropped.length+' dropped</span>' : ' \\u00B7 all captured')+'</div>'));
  const rows = d.events.map(e => {
    const desc = e.descriptor || {};
    const label = desc.name || desc.ariaLabel || desc.leafText || desc.placeholder || (e.kind === 'navigate' ? (desc.url || '') : '');
    // fate uses the same positive-state color the Steps table's ✓ and the Review ok badge use (var(--ok));
    // a drop reason is flagged in var(--rec) like the "dropped" summary; a null disposition is muted.
    const fate = !e.disposition ? '<span class="muted">unprocessed</span>'
      : e.disposition.indexOf('step:') === 0 ? '<span style="color:var(--ok);font-weight:600">step '+esc(e.disposition.slice(5))+'</span>'
      : '<span style="color:var(--rec)">'+esc(e.disposition.replace('dropped:',''))+'</span>';
    const t = e.t ? new Date(e.t).toLocaleTimeString() : '';
    return '<tr><td class="muted">'+e.seq+'</td><td>'+esc(t)+'</td><td>'+esc(e.source)+'</td><td>'+esc(e.kind)+'</td><td>'+esc(String(label))+'</td><td>'+fate+'</td></tr>';
  }).join('');
  ctx.ledgerBox.append(el('<table><tr><th>#</th><th>time</th><th>src</th><th>kind</th><th>label</th><th>fate</th></tr>'+rows+'</table>'));
}

function setSubTab(ctx, name) {
  ctx.subTab = name;
  ctx.tabsBar.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.sub === name));
  ctx.stepsBox.style.display = name === 'steps' ? '' : 'none';
  ctx.logsBox.style.display = name === 'logs' ? '' : 'none';
  ctx.videosBox.style.display = name === 'videos' ? '' : 'none';
  ctx.reviewBox.style.display = name === 'review' ? '' : 'none';
  ctx.ledgerBox.style.display = name === 'ledger' ? '' : 'none';
  if (name === 'steps') loadSteps(ctx);   // refetch — steps landed while you were on Logs (live bug: stale view)
  if (name === 'logs') loadLogs(ctx);
  if (name === 'videos') loadVideos(ctx);
  if (name === 'review') loadReview(ctx);
  if (name === 'ledger') loadLedger(ctx);
}

// Minimal markdown → HTML for the review report (esc() runs FIRST, so this only
// ever wraps already-escaped text — no XSS surface). Headings, bold, italics,
// inline/fenced code, bullet & numbered lists, pipe tables, paragraphs. BT = backtick
// (kept out of the source literal — this whole file lives inside a template string).
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
  let table = null; // { rows: [{cells, header}] } while inside a pipe-table
  const closeList = () => { if (list) { out.push('</' + list + '>'); list = null; } };
  const closeTable = () => {
    if (!table) return;
    out.push('<table>' + table.rows.map(row => {
      const tag = row.header ? 'th' : 'td';
      return '<tr>' + row.cells.map(c => '<' + tag + '>' + c + '</' + tag + '>').join('') + '</tr>';
    }).join('') + '</table>');
    table = null;
  };
  const splitCells = row => row.replace(/^\\s*\\||\\|\\s*$/g, '').split('|').map(c => c.trim());
  for (const line of src.split('\\n')) {
    const h = /^(#{1,4})\\s+(.*)$/.exec(line);
    const li = /^\\s*[-*]\\s+(.*)$/.exec(line);
    const ol = /^\\s*\\d+[.)]\\s+(.*)$/.exec(line);
    const row = /^\\s*\\|(.+)\\|\\s*$/.exec(line);
    const isSep = row && splitCells(line).every(c => /^:?-+:?$/.test(c));
    if (row && isSep) { /* separator row — swallow, previous row was the header */ }
    else if (row) {
      closeList();
      if (!table) table = { rows: [] };
      table.rows.push({ cells: splitCells(line), header: table.rows.length === 0 });
    }
    else if (h) { closeTable(); closeList(); out.push('<h' + (h[1].length + 2) + ' style="margin:14px 0 4px">' + h[2] + '</h' + (h[1].length + 2) + '>'); }
    else if (li) { closeTable(); if (list !== 'ul') { closeList(); out.push('<ul style="margin:4px 0 8px 18px">'); list = 'ul'; } out.push('<li>' + li[1] + '</li>'); }
    else if (ol) { closeTable(); if (list !== 'ol') { closeList(); out.push('<ol style="margin:4px 0 8px 18px">'); list = 'ol'; } out.push('<li>' + ol[1] + '</li>'); }
    else if (!line.trim()) { closeTable(); closeList(); out.push('<div style="height:8px"></div>'); }
    else { closeTable(); closeList(); out.push('<div>' + line + '</div>'); }
  }
  closeTable();
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
  const instrWrap = el('<div style="display:none;margin-bottom:10px"><div class="cat-head">Agent instructions (editable — saved as default for future runs)</div><textarea style="width:100%;min-height:180px;background:var(--bg-sunken);border:1px solid var(--border);color:var(--fg);border-radius:6px;padding:8px;font:12px ui-monospace,monospace"></textarea></div>');
  instrWrap.querySelector('textarea').value = cfg.instructions || '';
  bar.querySelector('[data-k=instr]').onclick = () => { instrWrap.style.display = instrWrap.style.display === 'none' ? '' : 'none'; };
  runB.onclick = async () => {
    const res = await fetch('/api/recordings/'+encodeURIComponent(r.sessionId)+'/review', {
      method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ model: modelSel.value, instructions: instrWrap.querySelector('textarea').value }) });
    if (!res.ok) { toast((await res.json()).error); return; }
    loadReview(ctx);   // re-render into the running state — progress visible HERE (and in Logs)
  };
  ctx.reviewBox.append(bar, instrWrap);

  if (state && state.running) {
    runB.disabled = true;
    ctx.reviewBox.append(el('<div class="pulse" style="color:var(--accent);margin:8px 0">\u23F3 review running\u2026 (progress also streams in Logs; the report will appear here)</div>'));
  }
  if (state && state.report) {
    const when = state.at ? new Date(state.at).toLocaleString() : '';
    // VERDICT-FIRST: a clear outcome banner (the answer at a glance), then the gap list, then the
    // long prose report tucked behind an expander (it read as a wall of text before).
    const v = state.verdict;
    if (v) {
      const ok = v.approved, n = v.gaps || 0;
      const cls = ok ? 'ok' : 'fail';
      const head = ok ? '✓ Verified — capture is complete' : ('⚠ Failed — '+n+' capture gap'+(n===1?'':'s'));
      const sub = ok ? 'This session is APPROVED and eligible to build the graph.'
                     : 'NOT approved — this session is excluded from graph building until it passes.';
      ctx.reviewBox.append(el('<div class="verdict '+cls+'"><div class="vh">'+esc(head)+'</div>'
        + '<div class="vs">'+esc(sub)+'</div><div class="vm">reviewed '+esc(when)+(v.reason?' · '+esc(v.reason):'')+'</div></div>'));
    } else {
      ctx.reviewBox.append(el('<div class="muted" style="font-size:12px;margin:6px 0">last run: '+esc(when)+'</div>'));
    }
    // full prose report behind a <details> expander (collapsed by default)
    const rep = el('<details class="reprep"><summary>Full review report</summary><div class="repbody">'+mdToHtml(state.report)+'</div></details>');
    ctx.reviewBox.append(rep);
  } else if (!state || !state.running) {
    ctx.reviewBox.append(el('<div class="empty">no review yet — run one above</div>'));
  }
}

async function showRecording(r, detail) {
  currentOpenId = r.sessionId;
  clearInterval(replayPoll); replayPoll = null;
  const steps = await getJSON('/api/recordings/'+encodeURIComponent(r.sessionId)+'/steps');
  detail.innerHTML = '';
  const headBox = el('<div style="margin-bottom:10px"></div>');
  const tabsBar = el('<nav style="padding:0;border-bottom:1px solid var(--border);margin-bottom:10px"><button data-sub="steps" class="active">Steps</button><button data-sub="videos">Session videos</button><button data-sub="review">Review</button><button data-sub="ledger">Ledger</button><button data-sub="logs">Logs</button></nav>');
  const stepsBox = el('<div></div>');
  const logsBox = el('<div style="display:none"></div>');
  const videosBox = el('<div style="display:none"></div>');
  const reviewBox = el('<div style="display:none"></div>');
  const ledgerBox = el('<div style="display:none"></div>');
  const ctx = { r, headBox, tabsBar, stepsBox, logsBox, videosBox, reviewBox, ledgerBox, subTab: 'steps', hasWindow: winSession === r.sessionId };
  detailCtx = ctx;
  tabsBar.querySelectorAll('button').forEach(b => { b.onclick = () => setSubTab(ctx, b.dataset.sub); });
  buildHead(ctx);
  stepsBox.append(stepTable(steps.map(x => ({ ...x, status: '' }))));
  detail.append(headBox, tabsBar, stepsBox, logsBox, videosBox, reviewBox, ledgerBox);
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
  const KIND = { input: ['input', 'var(--accent)'], click: ['click', 'var(--muted)'], navigate: ['nav', 'var(--ok)'], jump: ['jump', 'var(--ok)'], observe: ['page', 'var(--muted)'] };
  const pathOf = (u) => { try { const x = new URL(u); return x.host + x.pathname; } catch { return u || ''; } };
  steps.forEach(s => {
    const color = s.status==='ok'?'var(--ok)':s.status==='fail'?'var(--danger)':'var(--muted)';
    const [kLabel, kColor] = KIND[s.kind] || [s.kind || '', 'var(--muted)'];
    const kindChip = kLabel ? '<span style="display:inline-block;white-space:nowrap;border:1px solid '+kColor+';color:'+kColor+';border-radius:4px;padding:0 5px;font-size:10px;text-transform:uppercase">'+esc(kLabel)+'</span>' : '';
    const val = (s.kind === 'input' && s.value !== undefined && s.value !== null)
      ? ' <code class="val" style="color:var(--warn)">= "'+esc(String(s.value))+'"</code>' : '';
    const dest = s.kind === 'navigate' || s.kind === 'jump'
      ? '<div class="muted" style="font-size:11px">'+esc(pathOf(s.fromUrl))+' → '+esc(pathOf(s.toUrl))+'</div>'
      : '<div class="muted" style="font-size:11px">'+esc(pathOf(s.fromUrl || s.toUrl))+'</div>';
    const when = s.capturedAt ? new Date(s.capturedAt).toLocaleTimeString() : '';
    const shot = s.shot && session ? '<img src="/replays/'+encodeURIComponent(session)+'/'+encodeURIComponent(s.shot)+'" style="height:44px;border-radius:4px;border:1px solid var(--border)" />' : '';
    const note = s.note ? ' <span class="muted">('+esc(s.note)+')</span>' : '';
    tb.append(el('<tr><td style="width:22px;color:'+color+'">'+(ICON[s.status]||'')+'</td><td style="width:62px">'+kindChip+'</td><td><div>'+esc(s.label||('step '+s.seq))+val+note+'</div>'+dest+'</td><td class="muted" style="width:90px;font-size:11px;white-space:nowrap">'+esc(when)+'</td><td style="text-align:right">'+shot+'</td></tr>'));
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
      const p = el('<div class="addrow" style="margin:8px 0"><span style="color:var(--danger)">\\u26A0 \\u201C'+esc(st.waitingLabel||'')+'\\u201D looks like a commit (order/pay/delete). Fire it?</span> <button class="btn danger">Fire</button><button class="btn">Skip</button></div>');
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
