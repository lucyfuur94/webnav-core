// Pure core of the human-driven live recorder (spec:
// docs/superpowers/specs/2026-07-07-playwright-recorder-design.md).
// The injected listener only TAGS + REPORTS one-element descriptors; ALL
// snapshotting is playwright's. No in-page tree serialization, no .value reads.

import type { SnapNode } from '../playwright/snapshot.js';
import { didNavigate, diffSnapshots } from '../explorer/diff.js';
import { parseSnapshot } from '../playwright/snapshot.js';
import { recoverFingerprint } from '../playwright/fingerprint.js';
import type { ActionEffect, ActionRef } from '../mapstore/record.js';

export interface LiveEvent {
  seq: number; kind: 'click' | 'input' | 'toggle'; url: string; tagName: string;
  t?: number;   // capture-time (page clock) — steps/logs stamp THIS, not processing time
                // (heavy pages make snapshots slow; the loop can lag minutes behind)
  role?: string | null; ariaLabel?: string | null; leafText?: string | null;
  href?: string | null; placeholder?: string | null; nameAttr?: string | null;
  inputType?: string | null;
  // the VARIABLE a human/agent supplied (typed text, chosen option, checkbox state)
  // — recorded for NON-SECRET fields only, so a flow can be re-run with different
  // values (automated testing). Password / cc-* fields: always null.
  value?: string | null;
}

// Injected once per document (idempotent — a navigation loses page JS, the loop
// re-evals this every tick). LIVE lesson #1: the idempotence flag must live on the
// DOM (documentElement.dataset), NOT on window — playwright-cli runs each eval in a
// fresh JS world, so a window flag is invisible to the next eval and every tick
// installed ANOTHER listener (duplicate-event storm; dup clicks then suppressed each
// other's landing attribution). The DOM is shared across worlds; a new document after
// navigation has a fresh documentElement, so re-injection still happens exactly once.
// Events queue in sessionStorage: a window-scoped queue dies with the document,
// losing the navigating click — the most important event (the Chrome-extension bug,
// not re-learned twice). Secret-field rule (refined): NON-SECRET field values ARE
// recorded as flow VARIABLES (typed text / chosen option / checkbox state — what makes
// a recorded flow re-runnable with different inputs); password and cc-* autocomplete
// fields are NEVER captured. A submit/button/reset input's .value is its static label
// (its accessible name — LIVE lesson #2: saucedemo's Login is <input type=submit
// value="Login">, unresolvable without it). leafText is capped and
// taken from interactive elements / childless nodes only (containers concatenate
// their whole subtree — the extension's name-blob failure).
export const INSTALLER_JS = `() => {
  // Recording indicator: red inset border + "REC" pill. Placed BEFORE the
  // idempotence guard so the every-tick eval self-heals it if an SPA re-render
  // wipes it. pointer-events:none = never intercepts the user's clicks;
  // aria-hidden = never appears in the a11y snapshots we record.
  if (!document.getElementById('__webnav_rec_badge')) {
    const d = document.createElement('div');
    d.id = '__webnav_rec_badge';
    d.setAttribute('aria-hidden', 'true');
    d.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;box-shadow:inset 0 0 0 4px #e5484d;';
    const p = document.createElement('button');
    p.style.cssText = 'position:absolute;top:10px;left:50%;transform:translateX(-50%);background:#e5484d;color:#fff;font:700 11px/1 -apple-system,sans-serif;padding:6px 12px;border-radius:999px;pointer-events:auto;cursor:pointer;border:0;';
    p.textContent = '\\u23FA record';
    d.appendChild(p);
    (document.body || document.documentElement).appendChild(d);
  }
  if (document.documentElement.dataset.webnavInstalled) return 'already';
  document.documentElement.dataset.webnavInstalled = '1';
  // Keep the journey in THIS tab: a new tab escapes the recorder (one driven page).
  // Standard recorder trick: _blank links open same-tab; window.open redirects inline.
  // ponytail: OAuth-style popups get redirected into the tab — acceptable for v1.
  document.addEventListener('click', (ev) => {
    const t = ev.target;
    if (t instanceof Element) {
      const a = t.closest('a[target]');
      if (a && a.getAttribute('target') !== '_self') a.setAttribute('target', '_self');
    }
  }, true);
  window.open = (u) => { if (u) location.href = String(u); return null; };
  const push = (e) => {
    try {
      const q = JSON.parse(sessionStorage.getItem('__webnav_evq') || '[]');
      const seq = (Number(sessionStorage.getItem('__webnav_seq')) || 0) + 1;
      sessionStorage.setItem('__webnav_seq', String(seq));
      q.push(Object.assign({ seq, t: Date.now(), url: location.href }, e));
      sessionStorage.setItem('__webnav_evq', JSON.stringify(q));
      return seq;
    } catch { return 0; }   // storage-denied page (opaque origin): drop, never explode
  };
  const badgeBtn = document.querySelector('#__webnav_rec_badge button');
  if (badgeBtn) badgeBtn.onclick = () => {
    // OPTIMISTIC flip: paint the new state NOW (the server's truth repaints next tick).
    // (4-line paint duplicated from TICK_JS's painter — worlds are isolated, DOM isn't.)
    const on = document.documentElement.dataset.webnavRec === '1';
    const desired = !on;
    document.documentElement.dataset.webnavRec = desired ? '1' : '0';
    document.documentElement.dataset.webnavPinT = String(Date.now());   // pin: stale ticks must not undo this
    const d0 = document.getElementById('__webnav_rec_badge');
    if (d0) { d0.style.boxShadow = 'inset 0 0 0 4px ' + (desired ? '#e5484d' : '#8b93a3');
      const b0 = d0.querySelector('button');
      if (b0) { b0.style.background = desired ? '#e5484d' : '#8b93a3'; b0.textContent = desired ? '\\u25CF REC \\u2014 stop' : '\\u23FA record'; } }
    // REALTIME: POST the DESIRED state straight to the dashboard server (idempotent —
    // a flip could double-toggle if visual state was stale; desired-state can't).
    // Chrome exempts 127.0.0.1 from mixed-content blocking, so this works from https
    // pages too. Fetch failure (strict CSP, no dashboard) → queue for the loop.
    const port = document.documentElement.dataset.webnavPort;
    const sess = document.documentElement.dataset.webnavSession;
    if (port && sess) {
      fetch('http://127.0.0.1:' + port + '/api/recordings/' + encodeURIComponent(sess) + '/toggle',
        { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ recording: desired }) }).catch(() => push({ kind: 'toggle' }));
    } else { push({ kind: 'toggle' }); }
  };
  // Click RIPPLE: a brief expanding ring at the click point, painted only while
  // recording — so the session VIDEO shows WHERE each click landed (the review
  // agent reads frames; a ripple pins the action location). pointer-events:none
  // (never intercepts), aria-hidden (never in the a11y snapshots we record), and
  // it deliberately CREATES a visible change at click time, which biases the
  // scene-change frame extractor toward selecting a frame at each click.
  const ripple = (x, y) => {
    const r = document.createElement('div');
    r.setAttribute('aria-hidden', 'true');
    r.style.cssText = 'position:fixed;left:' + (x - 22) + 'px;top:' + (y - 22) + 'px;width:44px;height:44px;border-radius:50%;border:3px solid #e5484d;background:rgba(229,72,77,.3);z-index:2147483646;pointer-events:none;transform:scale(.4);opacity:1;transition:transform .5s ease-out,opacity .7s ease-out;';
    (document.body || document.documentElement).appendChild(r);
    requestAnimationFrame(() => { r.style.transform = 'scale(1.7)'; r.style.opacity = '0'; });
    setTimeout(() => r.remove(), 800);
  };
  const INTERACTIVE = ['a','button','select','textarea','summary','label'];
  document.addEventListener('click', (ev) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    if (t.closest('#__webnav_rec_badge')) return;   // our own overlay is never a recorded click
    if (document.documentElement.dataset.webnavRec === '1') ripple(ev.clientX, ev.clientY);
    const el = t.closest('a,button,[role],input,select,textarea,summary,label') || t;
    const tag = el.tagName.toLowerCase();
    const isBtnInput = el instanceof HTMLInputElement && ['submit','button','reset'].indexOf(el.type) >= 0;
    const takeText = INTERACTIVE.indexOf(tag) >= 0 || el.getAttribute('role') || el.children.length === 0;
    const seq = push({
      kind: 'click', tagName: tag,
      role: el.getAttribute('role'), ariaLabel: el.getAttribute('aria-label'),
      leafText: isBtnInput ? (el.value || null)
        : (takeText ? ((el.textContent || '').trim().slice(0, 80) || null) : null),
      href: el instanceof HTMLAnchorElement ? el.href : null,
      placeholder: el.getAttribute('placeholder'), nameAttr: el.getAttribute('name'),
      inputType: el instanceof HTMLInputElement ? el.type : null,
    });
    if (el instanceof HTMLElement) el.dataset.webnavHit = String(seq);
  }, true);
  document.addEventListener('change', (ev) => {
    const el = ev.target;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return;
    // SECRET RULE (refined): record the supplied VALUE as a flow variable for
    // non-secret fields; password / cc-* autocomplete fields are NEVER captured.
    // The guard must cover: multi-token autocomplete ('billing cc-number'), the
    // password-manager tokens (current-password/new-password/one-time-code), and
    // show-password toggles (type flips to text but autocomplete stays) — final
    // pre-merge review finding.
    const ac = (el.autocomplete || '');
    const secret = el instanceof HTMLInputElement &&
      (el.type === 'password' || /(^|\s)(cc-|current-password|new-password|one-time-code)/.test(ac));
    let value = null;
    if (!secret) {
      if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) value = el.checked ? 'true' : 'false';
      else value = String(el.value ?? '').slice(0, 200);
    }
    push({ kind: 'input', tagName: el.tagName.toLowerCase(), role: el.getAttribute('role'),
      ariaLabel: el.getAttribute('aria-label'), leafText: null, href: null,
      placeholder: el.getAttribute('placeholder'), nameAttr: el.getAttribute('name'),
      inputType: el instanceof HTMLInputElement ? el.type : null, value });
  }, true);
  return 'installed';
}`;

// Recolor the overlay for the current mode. Evaled by the loop whenever the mode
// changes (and after each re-inject). Red = capturing; grey = armed (open, not recording).
export const MODE_JS = (recording: boolean) => `() => {
  const d = document.getElementById('__webnav_rec_badge');
  if (!d) return 'no-badge';
  // authoritative push: paint AND pin — an in-flight stale TICK (built before this
  // state change, landing after) must not repaint the old state and poison the
  // pill's memory (live bug: 'stop' then STARTED again — the stale tick had
  // rewritten webnavRec, so the next click toggled the wrong way).
  document.documentElement.dataset.webnavRec = '${recording ? '1' : '0'}';
  document.documentElement.dataset.webnavPinT = String(Date.now());
  d.style.boxShadow = 'inset 0 0 0 4px ${recording ? '#e5484d' : '#8b93a3'}';
  const p = d.querySelector('button');
  if (p) { p.style.background = '${recording ? '#e5484d' : '#8b93a3'}'; p.textContent = '${recording ? '\\u25CF REC \\u2014 stop' : '\\u23FA record'}'; }
  return 'ok';
}`;

// Atomic read+clear: draining and processing are one step, so no event is seen twice.
// The in-page try/catch is LOAD-BEARING: on about:blank (opaque origin) or mid-
// navigation, sessionStorage access THROWS while the window is perfectly alive —
// without it, playwright-cli returns junk, and the loop's window-closed detector
// false-positived and CLOSED the armed window ~1s after opening (live finding).
// A page that is alive-but-storage-denied must drain '[]'; only a truly dead
// page (eval cannot run at all) produces unparseable output.
export const DRAIN_JS = `() => {
  try {
    const q = sessionStorage.getItem('__webnav_evq') || '[]';
    sessionStorage.removeItem('__webnav_evq');
    return q;
  } catch { return '[]'; }
}`;

// ONE eval per tick (live finding: every playwright-cli call spawns a fresh CLI
// process ~300-500ms and serializes through the daemon — three calls per tick made
// the overlay lag seconds behind). Composes INSTALLER_JS + DRAIN_JS (no duplicated
// listener logic) and paints the badge for the CURRENT mode in the same JS turn —
// a fresh document's badge is created already-correct (no grey-then-red blip).
// Returns JSON {installed, queue}; unparseable output ⇒ the page is truly gone.
export const TICK_JS = (recording: boolean, extras?: { port?: number; session?: string }) => `() => {
  const installed = (${INSTALLER_JS})() === 'installed';
  const rec = ${recording ? 'true' : 'false'};
  ${extras?.port ? `document.documentElement.dataset.webnavPort = '${Number(extras.port)}';` : ''}
  ${extras?.session ? `document.documentElement.dataset.webnavSession = '${String(extras.session).replace(/[^\w.-]/g, '')}';` : ''}
  // A tick built BEFORE an authoritative change can LAND AFTER it (daemon queue).
  // A fresh pin (pill click / dashboard push) wins over this tick's stale mode —
  // without this, a stale tick rewrote webnavRec and the next pill click toggled
  // the wrong way ('stop' started recording again — live bug).
  const pinT = Number(document.documentElement.dataset.webnavPinT || 0);
  if (Date.now() - pinT > 1500) {
    document.documentElement.dataset.webnavRec = rec ? '1' : '0';
    const d = document.getElementById('__webnav_rec_badge');
    if (d) { d.style.boxShadow = 'inset 0 0 0 4px ' + (rec ? '#e5484d' : '#8b93a3');
      const b = d.querySelector('button');
      if (b) { b.style.background = rec ? '#e5484d' : '#8b93a3'; b.textContent = rec ? '\\u25CF REC \\u2014 stop' : '\\u23FA record'; } }
  }
  let queue = [];
  try { queue = JSON.parse((${DRAIN_JS})()); } catch {}
  return JSON.stringify({ installed, queue });
}`;

const TAG_ROLE: Record<string, string> = {
  a: 'link', button: 'button', select: 'combobox', textarea: 'textbox', summary: 'button',
};
export function descriptorRole(ev: LiveEvent): string | null {
  if (ev.role) return ev.role;
  if (ev.tagName === 'input') {
    if (ev.inputType === 'submit' || ev.inputType === 'button') return 'button';
    if (ev.inputType === 'checkbox') return 'checkbox';
    if (ev.inputType === 'radio') return 'radio';
    return 'textbox';
  }
  return TAG_ROLE[ev.tagName] ?? null;
}
export function descriptorName(ev: LiveEvent): string | null {
  return ev.ariaLabel || ev.leafText || ev.placeholder || ev.nameAttr || null;
}

export type Resolution = { ref: string } | { candidates: string[] } | null;

/** Resolve a descriptor against a REAL playwright snapshot. Strict: no role/name
 *  → null; unique role+name → ref; multiple + href → match the link target
 *  (host+path); still multiple → candidates (the loop may probe them); else null. */
export function resolveEvent(ev: LiveEvent, nodes: SnapNode[]): Resolution {
  const role = descriptorRole(ev), name = descriptorName(ev);
  if (!role || !name) return null;
  const cands = nodes.filter((n) => n.ref && n.role === role && n.name === name);
  if (cands.length === 0) return null;
  if (cands.length === 1) return { ref: cands[0].ref! };
  if (ev.href) {
    const byHref = cands.filter((n) => n.url && !didNavigate(n.url, ev.href!));
    if (byHref.length === 1) return { ref: byHref[0].ref! };
  }
  return { candidates: cands.map((n) => n.ref!) };
}

export interface Tick { url: string; snapshot: string }

/** Latest tick ≤ uptoIdx on the same page as the event (query/hash ignored). */
export function fromTickFor(ev: LiveEvent, ticks: Tick[], uptoIdx: number): number {
  for (let i = Math.min(uptoIdx, ticks.length - 1); i >= 0; i--) {
    if (!didNavigate(ticks[i].url, ev.url)) return i;
  }
  return -1;
}

/** Which tick is the event's landing? -1 = wait (need the lookahead tick).
 *  A navigation often lands AFTER the drain tick; the one-tick lookahead
 *  attributes it — unless a later click was drained, which then owns it.
 *  ponytail: bursts inside one interval can misattribute; interval default
 *  500ms makes that rare for deliberate QA clicking. */
export function chooseToTick(drainIdx: number, ticks: Tick[], hasLaterClick: boolean): number {
  const t0 = ticks[drainIdx], t1 = ticks[drainIdx + 1];
  if (!t0) return -1;
  if (!t1) return -1;
  if (didNavigate(t0.url, t1.url) && !hasLaterClick) return drainIdx + 1;
  return drainIdx;
}

/** Build the ActionEffect. Unresolved same-page CLICKS are dropped (noise);
 *  unresolved NAVIGATED clicks still emit with action:null (the draft's
 *  link-scan + cross-link mesh recover link edges); inputs always emit —
 *  the field identity powers the draft's login/credentials linkage. */
export function assembleEffect(ev: LiveEvent, ref: string | null, from: Tick, to: Tick): ActionEffect | null {
  // An input event NEVER navigates, by definition — correct-by-construction guard.
  // Without it, a password-field change drained in the SAME batch as the Login click
  // can pair with the landing tick and record navigated:true, which downstream makes
  // draftFromEffects skip the input-affordance branch → the credentials linkage
  // (needs/acceptsInput) never fires, plus a junk textbox "navigate" edge that
  // passes self-verify (final-review finding #1).
  const role = descriptorRole(ev), name = descriptorName(ev);
  // A CLICK on a form field never navigates either (live finding: a click into
  // "First Name" around a fast page transition paired with the landing tick and
  // recorded "nav: First Name"). Field clicks are input evidence, not edges.
  const fieldClick = ev.kind === 'click' && (role === 'textbox' || role === 'searchbox');
  const navigated = ev.kind === 'input' || fieldClick ? false : didNavigate(ev.url, to.url);
  let action: ActionRef | null = null;
  if (ref) {
    const fromNodes = parseSnapshot(from.snapshot);
    action = { role: role ?? '', name, ref, elementFp: recoverFingerprint(fromNodes, ref) };
  } else if (ev.kind === 'input' && role && name) {
    action = { role, name, ref: null, elementFp: { role, name, near: null } };
  }
  if (action && ev.kind === 'input' && typeof ev.value === 'string') action.value = ev.value;
  if (!action && !navigated) {
    return null;   // unresolved same-page click → honest drop
  }
  return {
    fromUrl: ev.url, fromSnapshot: from.snapshot,
    action,
    toUrl: to.url, toSnapshot: to.snapshot,
    navigated,
    diff: diffSnapshots(parseSnapshot(from.snapshot), parseSnapshot(to.snapshot)),
  };
}
