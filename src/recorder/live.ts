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
  seq: number; kind: 'click' | 'input'; url: string; tagName: string;
  role?: string | null; ariaLabel?: string | null; leafText?: string | null;
  href?: string | null; placeholder?: string | null; nameAttr?: string | null;
  inputType?: string | null;
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
// not re-learned twice). Secret-field rule: no typed value is ever read; the ONE
// sanctioned .value read is a submit/button/reset input's label (static author text —
// its accessible name — never user-typed; LIVE lesson #2: saucedemo's Login is
// <input type=submit value="Login">, unresolvable without it). leafText is capped and
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
    const p = document.createElement('div');
    p.style.cssText = 'position:absolute;top:10px;right:10px;background:#e5484d;color:#fff;font:700 11px/1 -apple-system,sans-serif;padding:5px 9px;border-radius:999px;';
    p.textContent = '\\u25CF REC';
    d.appendChild(p);
    (document.body || document.documentElement).appendChild(d);
  }
  if (document.documentElement.dataset.webnavInstalled) return 'already';
  document.documentElement.dataset.webnavInstalled = '1';
  const push = (e) => {
    const q = JSON.parse(sessionStorage.getItem('__webnav_evq') || '[]');
    const seq = (Number(sessionStorage.getItem('__webnav_seq')) || 0) + 1;
    sessionStorage.setItem('__webnav_seq', String(seq));
    q.push(Object.assign({ seq, url: location.href }, e));
    sessionStorage.setItem('__webnav_evq', JSON.stringify(q));
    return seq;
  };
  const INTERACTIVE = ['a','button','select','textarea','summary','label'];
  document.addEventListener('click', (ev) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
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
    push({ kind: 'input', tagName: el.tagName.toLowerCase(), role: el.getAttribute('role'),
      ariaLabel: el.getAttribute('aria-label'), leafText: null, href: null,
      placeholder: el.getAttribute('placeholder'), nameAttr: el.getAttribute('name'),
      inputType: el instanceof HTMLInputElement ? el.type : null });
  }, true);
  return 'installed';
}`;

// Atomic read+clear: draining and processing are one step, so no event is seen twice.
export const DRAIN_JS = `() => {
  const q = sessionStorage.getItem('__webnav_evq') || '[]';
  sessionStorage.removeItem('__webnav_evq');
  return q;
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
  const navigated = ev.kind === 'input' ? false : didNavigate(ev.url, to.url);
  const role = descriptorRole(ev), name = descriptorName(ev);
  let action: ActionRef | null = null;
  if (ref) {
    const fromNodes = parseSnapshot(from.snapshot);
    action = { role: role ?? '', name, ref, elementFp: recoverFingerprint(fromNodes, ref) };
  } else if (ev.kind === 'input' && role && name) {
    action = { role, name, ref: null, elementFp: { role, name, near: null } };
  } else if (!navigated) {
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
