// Grammar suite — PICKERS & COMPOSITE INPUTS group.
// Matrix: docs/superpowers/specs/2026-07-12-structure-coverage-matrix.md
// Fixture idiom (reused from tests/explorer/draft.test.ts): YAML-ish snapshot literals via
// parseSnapshot, >=8 named nodes per landing (classifyReadiness='ready'), distinct first-segment
// URLs, driven through the REAL draftFromEffects pipeline with recorded action-effects.
import { describe, it, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { draftFromEffects } from '../../src/explorer/draft.js';
import type { StoredActionEffect } from '../../src/mapstore/record.js';
import { parseSnapshot } from '../../src/playwright/snapshot.js';
import { loadPatternPacks } from '../../src/explorer/patterns.js';

const CORE_PACKS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../packs/patterns/core');

const B = 'https://fx.test';

// A READY entry landing distinct from every fixture's own first segment, shared across this file.
const AUTH = ['- heading "Login" [ref=e1]', '- textbox "Username" [ref=e2]', '- textbox "Password" [ref=e3]',
  '- button "Login" [ref=e4]', '- paragraph "Sign in" [ref=e5]', '- link "Forgot" [ref=e6]:\n    - /url: https://fx.test/auth/forgot',
  '- paragraph "Co" [ref=e7]', '- paragraph "v1" [ref=e8]'].join('\n');

const enter = (toUrl: string, toSnapshot: string): StoredActionEffect => ({
  seq: 0, capturedAt: 0, fromUrl: `${B}/auth/login`, fromSnapshot: AUTH,
  action: { role: 'button', name: 'Login', ref: 'e4', elementFp: { role: 'button', name: 'Login', near: null } },
  toUrl, toSnapshot, navigated: true, diff: { added: [], removed: [] } as any,
});

// ── fx-select-portal (rows 17 Select, 19 Combobox, 22 Listbox) ──────────────────────────────
// Trigger combobox with aria-haspopup=listbox -> a PORTAL listbox appended at document end
// (depth 0, same as the trigger — portals are NOT nested under the trigger in a real a11y tree).
// Also covers the async-empty combobox (no options yet, readiness/never-recorded, not asserted
// here beyond "no option ever becomes an affordance").
describe('grammar: 17/19/22 select/combobox/listbox portal — options never stored, reveal to trigger', () => {
  const FORM = [
    '- heading "New Order" [ref=e1]',
    '- combobox "Country" [ref=e2] [aria-haspopup=listbox]',
    '- button "Save" [ref=e3]',
    '- paragraph "Choose a shipping country" [ref=e4]',
    '- paragraph "Required" [ref=e5]',
    '- paragraph "Draft order" [ref=e6]',
    '- paragraph "Order form" [ref=e7]',
    '- paragraph "Ships worldwide" [ref=e8]',
  ].join('\n');
  // opening the combobox portal-appends a listbox with >=3 same-depth options (a real value
  // domain) at the END of the document (depth 0, sibling of everything else) — proving
  // attribution is role-keyed (overlay-role ancestry), NOT proximity to the trigger.
  const PORTAL_OPTIONS = [
    '  - option "United States" [ref=e10]',
    '  - option "United Kingdom" [ref=e11]',
    '  - option "Canada" [ref=e12]',
  ];
  const FORM_OPEN = [FORM, '- listbox [ref=e9]:', ...PORTAL_OPTIONS].join('\n');
  const openTrigger: StoredActionEffect = {
    seq: 1, capturedAt: 0, fromUrl: `${B}/order/new`, fromSnapshot: FORM,
    action: { role: 'combobox', name: 'Country', ref: 'e2', elementFp: { role: 'combobox', name: 'Country', near: null } },
    toUrl: `${B}/order/new`, toSnapshot: FORM_OPEN, navigated: false,
    diff: { added: parseSnapshot(['- listbox [ref=e9]:', ...PORTAL_OPTIONS].join('\n')).map((n) => ({ ...n, depth: 1 })), removed: [] } as any,
  };
  // a value pick INSIDE the portal listbox (FROM = FORM_OPEN, so the option is insideOverlay).
  const pickOption: StoredActionEffect = {
    seq: 2, capturedAt: 0, fromUrl: `${B}/order/new`, fromSnapshot: FORM_OPEN,
    action: { role: 'option', name: 'United States', ref: 'e10', elementFp: { role: 'option', name: 'United States', near: null } },
    toUrl: `${B}/order/new`, toSnapshot: FORM_OPEN, navigated: false, diff: { added: [], removed: [] } as any,
  };

  it('the options are NEVER stored as page affordances (the no-values rule)', () => {
    const g = draftFromEffects([enter(`${B}/order/new`, FORM), openTrigger, pickOption] as never);
    const s = g.states.find((x) => x.label === 'order-new')!;
    for (const name of ['United States', 'United Kingdom', 'Canada']) {
      expect(s.affordances.some((a) => a.label === name)).toBe(false);
    }
  });

  // Matrix row 17: the trigger becomes a `reveal` (options are the value domain, never stored).
  // reveal-by-behavior (draft.ts): the opener's diff ADDED named option nodes → it opened an
  // overlay ⇒ reveal, even though every option is folded out as value domain so children === [].
  it('reveal attribution goes to the TRIGGER (combobox), not the page body — opener classifies reveal (options folded out as value domain, children may be empty)', () => {
    const g = draftFromEffects([enter(`${B}/order/new`, FORM), openTrigger, pickOption] as never);
    const s = g.states.find((x) => x.label === 'order-new')!;
    const opener = s.affordances.find((a) => a.label === 'Country')!;
    expect(opener).toBeTruthy();
    expect(opener.kind).toBe('reveal');
    // the reveal exposes NO option children — the value domain is read live, never stored.
    expect((opener.children ?? []).length).toBe(0);
  });

  it('page-level durable actions (Save) survive alongside the picker', () => {
    const g = draftFromEffects([enter(`${B}/order/new`, FORM), openTrigger, pickOption] as never);
    const s = g.states.find((x) => x.label === 'order-new')!;
    expect(s.affordances.some((a) => a.label === 'Save' && a.kind === 'mutate')).toBe(true);
  });
});

// ── fx-data-grid's role-2/named picker sibling: standalone listbox (row 22) baseline-present
// vs transient — covered separately in overlays.test.ts (menu/listbox baseline precedence, X8).

// ── row 18 Multi-select — PARTIAL (OQ2: needs container-scoped folding). Documents the
// honest degradation: tags-in-trigger (a NESTED value domain inside a page-level control) leak
// as page-level data today because subtreeFolds/enumeratedNames don't fold across the trigger
// boundary into a portal-listbox's OWN separate node set. We assert the CURRENT behavior described
// by the matrix row 18 verdict; if OQ2 lands this test's premise changes and must be revisited.
describe('grammar: 18 multi-select — PARTIAL (tags-in-trigger nested value domain, OQ2)', () => {
  const MULTI = [
    '- heading "Assign Labels" [ref=e1]',
    '- combobox "Labels" [ref=e2] [aria-haspopup=listbox]',
    '- button "bug" [ref=e3]',            // a selected-item tag rendered INSIDE the trigger
    '- button "urgent" [ref=e4]',         // a second selected-item tag
    '- button "Save" [ref=e5]',
    '- paragraph "Pick one or more labels" [ref=e6]',
    '- paragraph "Draft" [ref=e7]',
    '- paragraph "Issue form" [ref=e8]',
  ].join('\n');

  it('MATRIX-MISMATCH probe: tags-in-trigger DO get folded away today (better than the matrix PARTIAL claims)', () => {
    // rows 3-4 ("bug"/"urgent") are just 2 page-level buttons here — below the >=3 fold threshold,
    // so they synthesize as their OWN mutate affordances via interior synthesis. This is the honest
    // engine behavior on a 2-tag case: no fold fires (subtreeFolds needs >=3 named OR distinct
    // members to abstract), so nothing is de-valued. Document as-is, not bent to match the matrix's
    // framing of "leaks as page-level data" — with only 2 tags there is no fold to trigger, so they
    // simply synthesize as ordinary mutate controls (still technically "page-level data" in spirit:
    // per-selection tag names become stored affordances, which is the OQ2 gap in practice).
    const g = draftFromEffects([enter(`${B}/issue/9`, MULTI)] as never);
    const s = g.states.find((x) => x.label === 'issue')!;
    expect(s.affordances.some((a) => a.label === 'bug')).toBe(true);
    expect(s.affordances.some((a) => a.label === 'urgent')).toBe(true);
    // per matrix OQ2: this is the honest degradation — per-selection values ARE stored as
    // ordinary affordances because no container-scoped fold exists to catch a 2-item trigger.
  });
});

// ── X10 worked example — the real the analytics SPA div-soup date-picker (extension-loop plan Task 3) ──
// Sourced from `graph-analyse --draft` on the real 5-session the analytics SPA recording: clicking the
// date-range summary button ("Last 7 Days (CD) : 02 Jul 2026 - 08 Jul 2026UTC") adds a subtree
// whose calendar grid is nested `generic` wrappers around 31 `gridcell` day cells — no dialog/
// menu/listbox NAMED-control signal survives the core's own enumeratedNames value-fold (every
// quick-range button is a >=3 same-role/depth sibling group, so the strict overlayControl scan
// has nothing left to flip). That gap is `packs/patterns/core/date-picker-divsoup.json` (the
// shipped core pack this test loads for real, not a synthetic stand-in). Proves: the opener
// classifies `reveal` ONLY once the pack is loaded (core alone declines → mutate), and no day
// cell ever becomes a stored affordance/child either way (the no-values rule holds independent
// of detection).
describe('grammar: X10 div-soup date-picker (real the analytics SPA shape) — core pack flips opener to reveal, days never stored', () => {
  const REPORT = [
    '- heading "Report" [ref=e1]',
    '- button "Last 7 Days (CD) : 02 Jul 2026 - 08 Jul 2026UTC" [ref=e2]',
    '- button "Add filter" [ref=e3]',
    '- button "Share" [ref=e4]',
    '- paragraph "Sales Report" [ref=e5]',
    '- paragraph "Table" [ref=e6]',
    '- paragraph "Flat" [ref=e7]',
    '- paragraph "Draft" [ref=e8]',
  ].join('\n');
  // The real shape (from the actual the analytics SPA capture): a dialog root of nested role-less `generic`
  // wrappers; the calendar body is WEEK-ROW `generic` wrappers each holding ~7 `gridcell` day
  // cells — identical wrapper shape across rows is a genuine repeated SUBTREE the core's own
  // subtreeFolds/templateFolds already catches (STRAGGLER-UNIT exclusion), which is what actually
  // gates the whole calendar (including leaf quick-range buttons that share no fold of their own)
  // in the real data. Reproduced faithfully here rather than a flat single-parent grid.
  const weekdayHeaders = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    .map((d, i) => `        - generic "${d}" [ref=e${100 + i}]`);
  const dayCells = Array.from({ length: 31 }, (_, i) => i + 1);
  const weekRows: string[] = [];
  for (let d = 0; d < dayCells.length; d += 7) {
    weekRows.push('      - generic [ref=e' + (500 + d) + ']:');
    for (const day of dayCells.slice(d, d + 7))
      weekRows.push(`        - gridcell "July ${day}, 2026" [ref=e${200 + day}]`);
  }
  const quickRanges = ['Custom', 'Yesterday', 'Last Month', 'MTD (Last Available Date)', 'YTD (Last Available Date)', 'This Year (CD)']
    .map((n, i) => `      - button "${n}" [ref=e${300 + i}]`);
  const PICKER_ADDED_SNAPSHOT = [
    '- dialog [ref=e50]:',
    '  - generic [ref=e51]:',
    ...quickRanges,
    '    - generic [ref=e60]:',
    '      - generic [ref=e61]:',
    ...weekdayHeaders,
    ...weekRows,
  ].join('\n');
  const REPORT_WITH_PICKER = [REPORT, PICKER_ADDED_SNAPSHOT].join('\n');

  const enterReport = (): StoredActionEffect => ({
    seq: 0, capturedAt: 0, fromUrl: `${B}/auth/login`, fromSnapshot: AUTH,
    action: { role: 'button', name: 'Login', ref: 'e4', elementFp: { role: 'button', name: 'Login', near: null } },
    toUrl: `${B}/report/7001`, toSnapshot: REPORT, navigated: true, diff: { added: [], removed: [] } as any,
  });
  const openPicker: StoredActionEffect = {
    seq: 1, capturedAt: 0, fromUrl: `${B}/report/7001`, fromSnapshot: REPORT,
    action: { role: 'button', name: 'Last 7 Days (CD) : 02 Jul 2026 - 08 Jul 2026UTC', ref: 'e2',
      elementFp: { role: 'button', name: 'Last 7 Days (CD) : 02 Jul 2026 - 08 Jul 2026UTC', near: null } },
    toUrl: `${B}/report/7001`, toSnapshot: REPORT_WITH_PICKER, navigated: false,
    diff: { added: parseSnapshot(PICKER_ADDED_SNAPSHOT), removed: [] } as any,
  };
  const effs = [enterReport(), openPicker] as never;

  it('WITHOUT the pack (core alone): the picker stays undetected — opener classifies mutate', () => {
    const g = draftFromEffects(effs, []);
    const s = g.states.find((x) => x.label === 'report')!;
    const opener = s.affordances.find((a) => a.label.startsWith('Last 7 Days'))!;
    expect(opener).toBeTruthy();
    expect(opener.kind).toBe('mutate');
  });

  it('WITH the shipped core pack: the opener classifies reveal', () => {
    const packs = loadPatternPacks([CORE_PACKS_DIR]);
    expect(packs.some((p) => p.name === 'date-picker-divsoup-overlay')).toBe(true);
    const g = draftFromEffects(effs, packs);
    const s = g.states.find((x) => x.label === 'report')!;
    const opener = s.affordances.find((a) => a.label.startsWith('Last 7 Days'))!;
    expect(opener.kind).toBe('reveal');
  });

  it('day values are NEVER stored as affordances or reveal children (with or without the pack)', () => {
    for (const packs of [[], loadPatternPacks([CORE_PACKS_DIR])]) {
      const g = draftFromEffects(effs, packs as never);
      const all = g.states.flatMap((s) => s.affordances.flatMap((a) => [a, ...(a.children ?? [])]));
      for (const day of ['July 1, 2026', 'July 15, 2026', 'July 31, 2026'])
        expect(all.some((a) => a.label === day), day).toBe(false);
      for (const wd of ['Sunday', 'Wednesday', 'Saturday'])
        expect(all.some((a) => a.label === wd), wd).toBe(false);
    }
  });

  it('page-level durable actions (Add filter, Share) survive alongside the picker', () => {
    const g = draftFromEffects(effs, loadPatternPacks([CORE_PACKS_DIR]));
    const s = g.states.find((x) => x.label === 'report')!;
    expect(s.affordances.some((a) => a.label === 'Add filter')).toBe(true);
    expect(s.affordances.some((a) => a.label === 'Share')).toBe(true);
  });
});
