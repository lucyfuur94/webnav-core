import type { SnapNode } from '../playwright/snapshot.js';
import type { DeclaredShadow } from '../mapstore/types.js';

// Layer 2 — extract a page's DECLARED domain shadow as EVIDENCE (#5a: webnav records what the
// page declares, it NEVER interprets). Everything here is a verbatim string read from the
// snapshot; webnav does not name an entity, assert a relationship, or guess a field's meaning.
// The calling agent reads the shadow and reconstructs the domain model itself.
//
// Discipline (the hard line, review-bounded): we extract ONLY structure with a real ARIA role —
// `columnheader` for table columns, `heading` for a section title, real `textbox`/`combobox`/
// `checkbox`/`searchbox` for filters. We deliberately do NOT infer filters from a `generic`
// label paired with a `generic [cursor=pointer]` div (OrangeHRM's pseudo-selects) — that would be
// LAYOUT inference, which #5a forbids. Skipping honest-but-unobservable structure beats guessing.
// Design: docs/superpowers/specs/2026-06-13-learning-the-core-design.md (Layer 2).

const FILTER_ROLE: Record<string, 'text' | 'select' | 'date' | 'checkbox'> = {
  textbox: 'text', searchbox: 'text', combobox: 'select', checkbox: 'checkbox',
};
const RECORD_COUNT_RE = /\(\s*(\d[\d,]*)\s*\)\s*records?\s+found/i;

/** Strip decorative icon-font glyphs (Unicode Private Use Areas) and collapse whitespace from a
 *  declared name. These are rendering artifacts (Font Awesome sort/icon codepoints OrangeHRM
 *  appends to headers/buttons), NOT semantic text — removing them is the same class of cleanup as
 *  trimming a trailing space, never interpretation (#5a). Returns '' for a glyph-only name (e.g.
 *  the select-all checkbox column). */
const cleanText = (s: string | null): string =>
  (s ?? '').replace(/[\u{E000}-\u{F8FF}\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu, '').replace(/\s+/g, ' ').trim();

/** The nearest preceding `heading` node before index `idx` (cleaned name), or null. */
function precedingHeading(nodes: SnapNode[], idx: number): string | null {
  for (let i = idx - 1; i >= 0; i--) {
    if (nodes[i].role === 'heading') {
      const h = cleanText(nodes[i].name);
      if (h) return h;
    }
  }
  return null;
}

export interface ShadowOpts {
  /** name of the navigation/region whose direct link/tab children are the sub-tabs (verbatim). */
  subTabContainer?: string;
}

export function extractShadow(nodes: SnapNode[], opts: ShadowOpts = {}): DeclaredShadow {
  const shadow: DeclaredShadow = {};

  // ── collections: each `table` → its columnheaders (cleaned) + nearest heading + record count ──
  const collections: NonNullable<DeclaredShadow['collections']> = [];
  nodes.forEach((n, i) => {
    if (n.role !== 'table') return;
    const tableDepth = n.depth;
    const columns: string[] = [];
    // columnheaders are descendants of this table (until the next node at <= table depth).
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[j].depth <= tableDepth) break;
      if (nodes[j].role !== 'columnheader') continue;
      const col = cleanText(nodes[j].name);
      if (col) columns.push(col);                   // drop the empty select-all/checkbox column
    }
    if (!columns.length) return;                      // a table with no named headers carries no shadow
    // record count: nearest node matching "(N) Records Found" anywhere on the page.
    let recordCount: number | null = null;
    for (const m of nodes) {
      const hit = (m.raw ?? '').match(RECORD_COUNT_RE) || (m.name ?? '').match(RECORD_COUNT_RE);
      if (hit) { recordCount = Number(hit[1].replace(/,/g, '')); break; }
    }
    collections.push({ heading: precedingHeading(nodes, i), columns, recordCount });
  });
  if (collections.length) shadow.collections = collections;

  // ── filters: ONLY real-ARIA controls with an accessible name (no div-soup inference) ──
  const filters: NonNullable<DeclaredShadow['filters']> = [];
  const seenField = new Set<string>();
  for (const n of nodes) {
    const control = FILTER_ROLE[n.role];
    if (!control) continue;
    const field = cleanText(n.name);
    if (!field || seenField.has(field)) continue;
    seenField.add(field);
    filters.push({ field, control });
  }
  if (filters.length) shadow.filters = filters;

  // ── createsEntity: the `Add` button's nearest enclosing heading (the owned entity panel) ──
  const addIdx = nodes.findIndex((n) => n.role === 'button' && /\badd\b/i.test(cleanText(n.name)));
  if (addIdx >= 0) {
    const h = precedingHeading(nodes, addIdx);
    if (h) shadow.createsEntity = h;
  }

  // ── subTabs: direct link/tab labels under the named topbar container (cleaned) ──
  if (opts.subTabContainer) {
    const ci = nodes.findIndex((n) => cleanText(n.name) === opts.subTabContainer);
    if (ci >= 0) {
      const cDepth = nodes[ci].depth;
      const tabs: string[] = [];
      for (let j = ci + 1; j < nodes.length; j++) {
        if (nodes[j].depth <= cDepth) break;
        if (nodes[j].role !== 'link' && nodes[j].role !== 'tab') continue;
        const t = cleanText(nodes[j].name);
        if (t) tabs.push(t);
      }
      if (tabs.length) shadow.subTabs = tabs;
    }
  }

  return shadow;
}
