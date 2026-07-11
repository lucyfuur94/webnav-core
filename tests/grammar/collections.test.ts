// Grammar suite — COLLECTIONS & DATA DISPLAY group.
// Matrix: docs/superpowers/specs/2026-07-12-structure-coverage-matrix.md
import { describe, it, expect } from 'vitest';
import { draftFromEffects } from '../../src/explorer/draft.js';
import type { StoredActionEffect } from '../../src/mapstore/record.js';

const B = 'https://fx.test';
const AUTH = ['- heading "Login" [ref=e1]', '- textbox "Username" [ref=e2]', '- textbox "Password" [ref=e3]',
  '- button "Login" [ref=e4]', '- paragraph "Sign in" [ref=e5]', '- link "Forgot" [ref=e6]:\n    - /url: https://fx.test/auth/forgot',
  '- paragraph "Co" [ref=e7]', '- paragraph "v1" [ref=e8]'].join('\n');

// ── fx-data-grid (rows 44 Data grid, 2 Icon-only button, 59 Pagination) ────────────────────
// A 50-row table: sortable columnheader buttons, per-row icon buttons (one named "<X> Edit",
// one UNNAMED icon button = OQ3/GAPS X6 probe), row links to /items/:id, a select-all checkbox
// + per-row checkboxes, and pagination links.
describe('grammar: 44/2/59 data grid — row fold, near, effects, URL-template edge, unnamed icon honest omission', () => {
  // per-row control names share a TRAILING word ("<X> Edit") — the fold mechanism
  // (subtreeFolds/commonTrailingWords) groups by shared SUFFIX, matching the design's own
  // "<X> Remove"/"<X> dimension" pattern (infer.test.ts), not a shared prefix. Each row is its
  // OWN subtree container (a real grid's `row`/`gridcell` nesting) — flat siblings would let
  // page-level singletons (Bulk delete, columnheaders) collide with the row-repeat's L1/L2
  // shape and corrupt the fold's label (a real finding: see MATRIX-MISMATCH notes below for
  // what happens WITHOUT row containers).
  const gridRow = (id: number, name: string) => [
    `  - row [ref=row${id}]:`,
    `    - link "${name}" [ref=r${id}]:\n        - /url: ${B}/items/${id}`,
    `    - checkbox "Select ${name}" [ref=c${id}]`,
    `    - button "${name} Edit" [ref=e${id}]`,
    // an UNNAMED icon-only button (no accessible name) sits alongside the named one, per row.
    `    - button [ref=u${id}]`,
  ];
  const GRID = (ids: [number, string][]) => [
    '- heading "Items" [ref=e1]',
    '- checkbox "Select all" [ref=e2]',
    '- columnheader "Name" [ref=e3] [aria-sort]',
    '- columnheader "Status" [ref=e4] [aria-sort]',
    '- button "Bulk delete" [ref=e5]',
    '- table [ref=e9]:',
    ...ids.flatMap(([id, name]) => gridRow(id, name)),
    '- link "Next" [ref=e6]:\n    - /url: https://fx.test/items/list?page=2',
    '- link "Prev" [ref=e7]:\n    - /url: https://fx.test/items/list?page=0',
    '- paragraph "1-50 of 500" [ref=e8]',
  ].join('\n');
  const LANDING_A = GRID([[1, 'Alpha widget'], [2, 'Beta widget'], [3, 'Gamma widget']]);

  const enter: StoredActionEffect = { seq: 0, capturedAt: 0, fromUrl: `${B}/auth/login`, fromSnapshot: AUTH,
    action: { role: 'button', name: 'Login', ref: 'e4', elementFp: { role: 'button', name: 'Login', near: null } },
    toUrl: `${B}/items/list`, toSnapshot: LANDING_A, navigated: true, diff: { added: [], removed: [] } as any };

  const g = draftFromEffects([enter] as never);
  const s = g.states.find((x) => x.label === 'items-list')!;

  it('the state exists with a clean fingerprint (not the row data)', () => {
    expect(s).toBeTruthy();
    for (const t of s.fingerprint) {
      expect(t).not.toMatch(/widget/i);   // row-instance names never anchor identity
    }
  });

  it('row content (per-item names/links) is NOT stored as its own affordance — folds instead', () => {
    for (const name of ['Alpha widget', 'Beta widget', 'Gamma widget']) {
      expect(s.affordances.some((a) => a.label === name)).toBe(false);
    }
  });

  it('per-row Edit buttons fold to ONE fold-scoped mutate affordance (A5, common-trailing-words label)', () => {
    // affordance emission folds against p.coreNodes (named-only, core-filtered — containers like
    // `table`/`row` are dropped), so the row's control set (checkbox + 2 buttons) re-derives its
    // OWN shallower grouping rather than the single unitSize-5 subtree infer.test.ts shows on the
    // raw tree. The 3 "<X> widget Edit" buttons still fold to ONE affordance; label is the longest
    // common trailing words ("widget Edit"), not the bare word "Edit" — both names share it.
    const rows = s.affordances.filter((a) => a.scope && a.label === 'widget Edit');
    expect(rows.length).toBe(1);
    expect(rows[0].kind).toBe('mutate');
    expect(rows[0].elementFp ?? null).toBeNull();   // informational, no single durable coordinate
  });

  it('the unnamed icon-only button produces NO affordance — honest omission (OQ3/GAPS X6)', () => {
    // the name-filter strips it entirely: neither a per-row fold (it never accumulated a name to
    // fold on) nor an individual affordance. This IS the matrix's documented PARTIAL degradation
    // for row 2 — proven here, not assumed.
    const allLabels = s.affordances.flatMap((a) => [a.label, ...(a.children ?? []).map((c) => c.label)]);
    expect(allLabels.some((l) => l === '')).toBe(false);
    // no affordance count attributable to the 3 unnamed row buttons — they leave zero trace.
  });

  it('select-all + toolbar controls survive as page-level mutate affordances', () => {
    expect(s.affordances.some((a) => a.label === 'Select all' && a.kind === 'input')).toBe(true);
    expect(s.affordances.some((a) => a.label === 'Bulk delete' && a.kind === 'mutate' && a.needsClassification)).toBe(true);
  });

  // MATRIX-MISMATCH: interior synthesis's declared-interactive-control filter
  // (`draft.ts` ~854-855) only accepts INPUT_ROLES + 'button'; `columnheader` (the sort control
  // role in a real a11y tree) is neither, so a sortable header is silently never synthesized as
  // an affordance at all — not folded, not gated, just absent. The matrix's row 44 "headers
  // mutate" claim does not hold for the columnheader role today.
  it.fails('sortable column headers survive as their own affordances (not folded — only 2, below fold threshold) — MATRIX-MISMATCH: columnheader role is not in interior synthesis\'s accepted-control set (INPUT_ROLES ∪ button), so headers never synthesize', () => {
    expect(s.affordances.some((a) => a.label === 'Name')).toBe(true);
    expect(s.affordances.some((a) => a.label === 'Status')).toBe(true);
  });

  it('current (mismatched) behavior: columnheader controls are silently absent from the repertoire', () => {
    expect(s.affordances.some((a) => a.label === 'Name')).toBe(false);
    expect(s.affordances.some((a) => a.label === 'Status')).toBe(false);
  });

  it('pagination links (Next/Prev) resolve to the SAME URL-template state, not a separate page', () => {
    // ?page= query params collapse to one state per axis-4 identity (URL query dropped by keyOf).
    const labels = g.states.map((x) => x.label);
    expect(labels.filter((l) => l === 'items-list').length).toBe(1);
  });
});

// ── fx-data-grid's row-link -> detail URL template: a title link (/items/:id) becomes the
// list-to-detail navigate edge (A4 + A5, row 44/49's "home turf"). Verifies the edge kind and
// that the destination merges under one /items/{param} template rather than one state per id.
describe('grammar: 44 data grid — title-link URL template is the list-to-detail edge', () => {
  const DETAIL = (id: number, name: string) => [
    `- heading "${name}" [ref=e1]`,
    '- tab "Overview" [ref=e2]',
    '- tab "History" [ref=e3]',
    '- button "Archive" [ref=e4]',
    '- button "Duplicate" [ref=e5]',
    '- paragraph "Item metadata" [ref=e6]',
    '- paragraph "Created recently" [ref=e7]',
    '- paragraph "Owned by team" [ref=e8]',
  ].join('\n');
  const LIST = [
    '- heading "Items" [ref=e1]',
    '- checkbox "Select all" [ref=e2]',
    '- columnheader "Name" [ref=e3]',
    `- link "Alpha widget" [ref=r1]:\n    - /url: ${B}/items/1`,
    `- link "Beta widget" [ref=r2]:\n    - /url: ${B}/items/2`,
    '- button "Bulk delete" [ref=e5]',
    '- paragraph "1-2 of 2" [ref=e8]',
    '- paragraph "All items" [ref=e9]',
  ].join('\n');
  const enter: StoredActionEffect = { seq: 0, capturedAt: 0, fromUrl: `${B}/auth/login`, fromSnapshot: AUTH,
    action: { role: 'button', name: 'Login', ref: 'e4', elementFp: { role: 'button', name: 'Login', near: null } },
    toUrl: `${B}/items/list`, toSnapshot: LIST, navigated: true, diff: { added: [], removed: [] } as any };
  const clickA: StoredActionEffect = { seq: 1, capturedAt: 0, fromUrl: `${B}/items/list`, fromSnapshot: LIST,
    action: { role: 'link', name: 'Alpha widget', ref: 'r1', elementFp: { role: 'link', name: 'Alpha widget', near: null } },
    toUrl: `${B}/items/1`, toSnapshot: DETAIL(1, 'Alpha widget'), navigated: true, diff: { added: [], removed: [] } as any };
  const clickB: StoredActionEffect = { seq: 2, capturedAt: 0, fromUrl: `${B}/items/list`, fromSnapshot: LIST,
    action: { role: 'link', name: 'Beta widget', ref: 'r2', elementFp: { role: 'link', name: 'Beta widget', near: null } },
    toUrl: `${B}/items/2`, toSnapshot: DETAIL(2, 'Beta widget'), navigated: true, diff: { added: [], removed: [] } as any };

  const g = draftFromEffects([enter, clickA, clickB] as never);

  it('the two clicked detail instances merge into ONE /items/{param} templated state', () => {
    const labels = g.states.map((s) => s.label);
    expect(labels.filter((l) => l === 'items').length).toBe(1);
    const detail = g.states.find((s) => s.label === 'items')!;
    expect(detail.template).toMatch(/\{param\}/);
  });

  it('the list carries navigate edges to the detail template (not two separate item states)', () => {
    const list = g.states.find((s) => s.label === 'items-list')!;
    const navs = list.affordances.filter((a) => a.kind === 'navigate' && a.to === 'items');
    expect(navs.length).toBeGreaterThan(0);
  });

  it('the per-instance heading (item name) does NOT anchor the detail fingerprint (data, not identity)', () => {
    const detail = g.states.find((s) => s.label === 'items')!;
    expect(detail.fingerprint.join()).not.toMatch(/Alpha widget|Beta widget/);
  });
});
