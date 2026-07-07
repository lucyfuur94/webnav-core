// Pure core of the human-driven live recorder (spec:
// docs/superpowers/specs/2026-07-07-playwright-recorder-design.md).
// The injected listener only TAGS + REPORTS one-element descriptors; ALL
// snapshotting is playwright's. No in-page tree serialization, no .value reads.

import type { SnapNode } from '../playwright/snapshot.js';
import { didNavigate } from '../explorer/diff.js';

export interface LiveEvent {
  seq: number; kind: 'click' | 'input'; url: string; tagName: string;
  role?: string | null; ariaLabel?: string | null; leafText?: string | null;
  href?: string | null; placeholder?: string | null; nameAttr?: string | null;
  inputType?: string | null;
}

// Injected once per document (idempotent — a navigation loses page JS, the loop
// re-evals this every tick). Events queue in sessionStorage: a window-scoped
// queue dies with the document, losing the navigating click — the most important
// event (the Chrome-extension bug, not re-learned twice). Secret-field rule: no
// .value access anywhere below; leafText is capped and taken from interactive
// elements / childless nodes only (containers concatenate their whole subtree —
// the extension's name-blob failure).
export const INSTALLER_JS = `() => {
  if (window.__webnav_installed) return 'already';
  window.__webnav_installed = true;
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
    const takeText = INTERACTIVE.indexOf(tag) >= 0 || el.getAttribute('role') || el.children.length === 0;
    const seq = push({
      kind: 'click', tagName: tag,
      role: el.getAttribute('role'), ariaLabel: el.getAttribute('aria-label'),
      leafText: takeText ? ((el.textContent || '').trim().slice(0, 80) || null) : null,
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
