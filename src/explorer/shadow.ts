import type { SnapNode } from '../playwright/snapshot.js';
import type { DeclaredShadow } from '../mapstore/types.js';
import { insideOverlay } from './infer.js';

// Layer 2 — extract a page's DECLARED domain shadow as EVIDENCE (#5a: webnav records what the
// page declares, it NEVER interprets). Everything here is a verbatim string read from the
// snapshot; webnav does not name an entity, assert a relationship, or guess a field's meaning.
// The calling agent reads the shadow and reconstructs the domain model itself.
//
// Discipline (the hard line, review-bounded): we extract ONLY durable STRUCTURE with a real ARIA
// role — `columnheader` for table columns, `heading` for a section title, real `textbox`/
// `combobox`/`checkbox`/`searchbox` for filters — and never a DATA value (a record count, an
// enumerated overlay option). We deliberately do NOT infer filters from a `generic`
// label paired with a `generic [cursor=pointer]` div (a common custom-dropdown pseudo-select
// pattern) — that would be LAYOUT inference, which #5a forbids. Skipping honest-but-unobservable
// structure beats guessing.
// Design: docs/superpowers/specs/2026-06-13-learning-the-core-design.md (Layer 2).

const FILTER_ROLE: Record<string, 'text' | 'select' | 'date' | 'checkbox'> = {
  textbox: 'text', searchbox: 'text', combobox: 'select', checkbox: 'checkbox',
};

/** Strip decorative icon-font glyphs (Unicode Private Use Areas) and collapse whitespace from a
 *  declared name. These are rendering artifacts (Font Awesome sort/icon codepoints some apps
 *  append to headers/buttons), NOT semantic text — removing them is the same class of cleanup as
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

// Read the shadow from a page's CORE nodes (Task 10) — the durable, data-separated structure.
// A record COUNT is NOT extracted: it is a DATA value (changes with the rows), not structure
// (rule 2, 2026-07-10). `recordCount` stays on DeclaredShadow only for legacy stored data; nothing
// populates it here. There is also NO sub-tab option: naming a site's topbar region by a literal
// container name was a site-specific heuristic (deleted 2026-07-10) — sub-tabs surface as ordinary
// declared links/tabs, never a hard-coded container lookup.
export function extractShadow(nodes: SnapNode[]): DeclaredShadow {
  const shadow: DeclaredShadow = {};

  // ── collections: each `table` → its columnheaders (cleaned) + nearest heading ──
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
    // recordCount is DATA (rule 2) — left null; the field survives only for legacy stored maps.
    collections.push({ heading: precedingHeading(nodes, i), columns, recordCount: null });
  });
  if (collections.length) shadow.collections = collections;

  // ── filters: ONLY real-ARIA controls with an accessible name (no div-soup inference), and
  // NEVER one INSIDE an overlay — a filter control nested under a dialog/listbox is the overlay's
  // own control (a value-picker search box) or an enumerated value, i.e. DATA, not the page's
  // declared filter surface (rule 2). insideOverlay gates it out.
  const filters: NonNullable<DeclaredShadow['filters']> = [];
  const seenField = new Set<string>();
  nodes.forEach((n, i) => {
    const control = FILTER_ROLE[n.role];
    if (!control) return;
    if (insideOverlay(nodes, i)) return;              // overlay control / enumerated value → data
    const field = cleanText(n.name);
    if (!field || seenField.has(field)) return;
    seenField.add(field);
    filters.push({ field, control });
  });
  if (filters.length) shadow.filters = filters;

  // ── createsEntity: the `Add` button's nearest enclosing heading (the owned entity panel) ──
  const addIdx = nodes.findIndex((n) => n.role === 'button' && /\badd\b/i.test(cleanText(n.name)));
  if (addIdx >= 0) {
    const h = precedingHeading(nodes, addIdx);
    if (h) shadow.createsEntity = h;
  }

  return shadow;
}
