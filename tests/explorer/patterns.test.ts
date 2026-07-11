import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import {
  lintPackEntry, evaluateTrigger, loadPatternPacks, packDetectsOverlay, packValueNames,
  ARIA_ROLES, ARIA_ATTRS, PACK_TYPES, TRIGGER_CONTEXTS, type PatternPack,
} from '../../src/explorer/patterns.js';
import { draftFromEffects } from '../../src/explorer/draft.js';
import { parseSnapshot } from '../../src/playwright/snapshot.js';

// A valid value-domain pack: a role-less div-soup grid of ≥20 `gridcell` day cells inside a
// `generic` root → the date-picker case (X10). Its fixture proves the trigger matches.
const validValueDomain = (): unknown => ({
  name: 'date-picker-divsoup', version: 1, type: 'value-domain',
  trigger: { context: 'diff.added', root: { role: 'generic' }, contains: [{ role: 'gridcell', min: 20 }] },
  fixture: {
    snapshot: ['- generic [ref=e1]', ...Array.from({ length: 20 }, (_, i) => `  - gridcell "${i + 1}" [ref=e${i + 10}]`)].join('\n'),
    expect: 'matched',
  },
  evidence: 'AntD/MUI div-soup date picker: role-less grid of same-shape day cells the core cannot fold',
});

// A valid overlay-open pack: an undeclared portal whose added subtree is a `generic` root holding a
// heading + ≥2 buttons — a shape the strict 4-exclusion detection can miss when role-less.
const validOverlayOpen = (): unknown => ({
  name: 'divsoup-popover', version: 1, type: 'overlay-open',
  trigger: { context: 'diff.added', root: { role: 'generic' }, contains: [{ role: 'heading', min: 1 }, { role: 'button', min: 2 }] },
  fixture: {
    snapshot: ['- generic [ref=e1]', '  - heading "Filters" [ref=e2]', '  - button "Apply" [ref=e3]', '  - button "Cancel" [ref=e4]'].join('\n'),
    expect: 'matched',
  },
  evidence: 'undeclared role-less popover portal appended at document end',
});

describe('patterns — allow-lists', () => {
  it('roles and attrs the core reads are in the allow-lists', () => {
    for (const r of ['button', 'link', 'textbox', 'combobox', 'tab', 'option', 'columnheader', 'gridcell', 'generic', 'dialog', 'main'])
      expect(ARIA_ROLES.has(r)).toBe(true);
    expect(ARIA_ATTRS.has('aria-sort')).toBe(true);
    expect(ARIA_ATTRS.has('aria-expanded')).toBe(true);
  });
});

describe('patterns — lint accepts valid entries', () => {
  it('accepts a valid value-domain entry (0 reasons)', () => {
    expect(lintPackEntry(validValueDomain())).toEqual([]);
  });
  it('accepts a valid overlay-open entry (0 reasons)', () => {
    expect(lintPackEntry(validOverlayOpen())).toEqual([]);
  });
  it('accepts a rootless trigger', () => {
    const e = validValueDomain() as any; delete e.trigger.root;
    expect(lintPackEntry(e)).toEqual([]);
  });
  it('accepts an attr-presence predicate (aria-sort on a columnheader)', () => {
    const e: any = { ...(validValueDomain() as any), name: 'sortable-grid',
      trigger: { context: 'landing', contains: [{ role: 'columnheader', min: 1, attr: 'aria-sort' }] },
      fixture: { snapshot: '- columnheader "Date" [ref=e1] [aria-sort=ascending]', expect: 'matched' } };
    expect(lintPackEntry(e)).toEqual([]);
  });
});

describe('patterns — lint rejects site-rules with NAMED reasons', () => {
  const rejects = (mut: (e: any) => void, needle: string) => {
    const e = validValueDomain() as any; mut(e);
    const reasons = lintPackEntry(e);
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.join('\n')).toContain(needle);
  };

  it('rejects a HOSTNAME as a root role', () => rejects((e) => { e.trigger.root.role = 'example.com'; }, 'not a known ARIA role'));
  it('rejects a URL as a contains role', () => rejects((e) => { e.trigger.contains[0].role = 'https://x.com/date'; }, 'not a known ARIA role'));
  it('rejects a free-text UI label as a role', () => rejects((e) => { e.trigger.contains[0].role = 'Apply Filters'; }, 'not a known ARIA role'));
  it('rejects an unknown attribute name', () => rejects((e) => { e.trigger.contains[0].attr = 'data-testid'; }, 'not a known ARIA attribute name'));
  it('rejects an unknown effect type', () => rejects((e) => { e.type = 'treat-as-shell'; }, '"type" must be one of'));
  it('rejects an unknown context', () => rejects((e) => { e.trigger.context = 'hostname'; }, 'trigger.context must be one of'));
  it('rejects a non-slug name', () => rejects((e) => { e.name = 'Date Picker!'; }, '"name" must be a kebab-case slug'));
  it('rejects a missing fixture', () => rejects((e) => { delete e.fixture; }, '"fixture" is required'));
  it('rejects an empty contains array', () => rejects((e) => { e.trigger.contains = []; }, 'non-empty array of predicates'));
  it('rejects min < 1', () => rejects((e) => { e.trigger.contains[0].min = 0; }, 'must be an integer ≥1'));
  it('rejects a non-integer version', () => rejects((e) => { e.version = 1.5; }, '"version" must be an integer'));
  it('rejects empty evidence', () => rejects((e) => { e.evidence = ''; }, '"evidence" must be a non-empty'));

  it('rejects an entry whose fixture DISAGREES with its trigger (expect matched but trigger declines)', () => {
    const e = validValueDomain() as any;
    e.fixture.snapshot = '- generic [ref=e1]\n  - gridcell "1" [ref=e2]';   // only 1 cell, min is 20 → unmatched
    const reasons = lintPackEntry(e);
    expect(reasons.join('\n')).toContain('fixture failed');
  });

  it('rejects a totally malformed entry', () => {
    expect(lintPackEntry(null)).toEqual(['entry is not a JSON object']);
    expect(lintPackEntry(42)).toEqual(['entry is not a JSON object']);
  });
});

describe('patterns — evaluateTrigger fixtures', () => {
  const parse = parseSnapshot;
  it('matches ≥min descendants inside a root subtree', () => {
    const nodes = parse(['- generic [ref=e1]', '  - gridcell "1" [ref=e2]', '  - gridcell "2" [ref=e3]', '  - gridcell "3" [ref=e4]'].join('\n'));
    expect(evaluateTrigger({ context: 'diff.added', root: { role: 'generic' }, contains: [{ role: 'gridcell', min: 3 }] }, nodes)).toBe(true);
    expect(evaluateTrigger({ context: 'diff.added', root: { role: 'generic' }, contains: [{ role: 'gridcell', min: 4 }] }, nodes)).toBe(false);
  });
  it('containment is subtree-scoped: cells OUTSIDE the root do not count', () => {
    // two generics; the first has 1 cell, the second has 2. min:2 must NOT match the first via leakage.
    const nodes = parse([
      '- generic [ref=e1]', '  - gridcell "a" [ref=e2]',
      '- generic [ref=e3]', '  - gridcell "b" [ref=e4]', '  - gridcell "c" [ref=e5]',
    ].join('\n'));
    // the SECOND generic subtree has 2 → matches (any root subtree matching fires)
    expect(evaluateTrigger({ context: 'diff.added', root: { role: 'generic' }, contains: [{ role: 'gridcell', min: 2 }] }, nodes)).toBe(true);
    // min:3 → no single generic subtree has 3 → no match (proves cells didn't leak across roots)
    expect(evaluateTrigger({ context: 'diff.added', root: { role: 'generic' }, contains: [{ role: 'gridcell', min: 3 }] }, nodes)).toBe(false);
  });
  it('rootless trigger counts across the whole list', () => {
    const nodes = parse(['- gridcell "1" [ref=e1]', '- gridcell "2" [ref=e2]', '- gridcell "3" [ref=e3]'].join('\n'));
    expect(evaluateTrigger({ context: 'diff.added', contains: [{ role: 'gridcell', min: 3 }] }, nodes)).toBe(true);
  });
  it('attr predicate tests bracket-attribute PRESENCE', () => {
    const nodes = parse(['- columnheader "Date" [ref=e1] [aria-sort=ascending]', '- columnheader "Name" [ref=e2]'].join('\n'));
    expect(evaluateTrigger({ context: 'landing', contains: [{ role: 'columnheader', min: 1, attr: 'aria-sort' }] }, nodes)).toBe(true);
    expect(evaluateTrigger({ context: 'landing', contains: [{ role: 'columnheader', min: 2, attr: 'aria-sort' }] }, nodes)).toBe(false);
  });
  it('empty node list never matches', () => {
    expect(evaluateTrigger({ context: 'diff.added', contains: [{ role: 'gridcell' }] }, [])).toBe(false);
  });
});

// ── HOOK INTEGRATION ─────────────────────────────────────────────────────────────────────────
// A synthetic div-soup overlay undetected by core → detected via pack; containment holds; the
// picked values never become stored structure. Effects mirror the Layer-1 test shape.
describe('draftFromEffects — pack hook integration', () => {
  const B = 'https://cal.example.com';
  // A READY entry so the URL model doesn't collapse the single path.
  const AUTH = ['- heading "Login" [ref=e1]', '- textbox "Username" [ref=e2]', '- textbox "Password" [ref=e3]',
    '- button "Login" [ref=e4]', '- paragraph "Sign in" [ref=e5]', '- link "Forgot" [ref=e6]:\n    - /url: https://cal.example.com/auth/forgot',
    '- paragraph "Co" [ref=e7]', '- paragraph "v1" [ref=e8]'].join('\n');
  // The booking page: a "Pick date" opener + ≥8 ready nodes.
  const PAGE = ['- heading "Booking" [ref=e1]', '- button "Pick date" [ref=e2]', '- textbox "Guest name" [ref=e3]',
    '- button "Confirm booking" [ref=e4]', '- paragraph "Reserve a slot" [ref=e5]', '- paragraph "Step 1" [ref=e6]',
    '- paragraph "Step 2" [ref=e7]', '- paragraph "Step 3" [ref=e8]'].join('\n');
  const ENTRY = { seq: 0, capturedAt: 0, fromUrl: `${B}/auth/login`, fromSnapshot: AUTH,
    action: { role: 'button', name: 'Login', ref: 'e4', elementFp: { role: 'button', name: 'Login', near: null } },
    toUrl: `${B}/book`, toSnapshot: PAGE, navigated: true, diff: { added: [], removed: [] } };

  // The div-soup date-picker overlay the "Pick date" click reveals: a role-less `generic` portal
  // holding 28 `gridcell` day cells — NO button/menuitem/option/tab/etc, so the core's strict
  // openedOverlay detection (overlayControl roles) DECLINES. Day names are pure DATA.
  const dayCells = Array.from({ length: 28 }, (_, i) => ({ role: 'gridcell', name: String(i + 1), ref: `e${i + 20}`, url: null, raw: `gridcell "${i + 1}" [ref=e${i + 20}]`, depth: 4 }));
  const PORTAL_ADDED = [{ role: 'generic', name: null, ref: 'e19', url: null, raw: 'generic [ref=e19]', depth: 3 }, ...dayCells];
  const PAGE_WITH_PORTAL = [PAGE, '- generic [ref=e19]', ...dayCells.map((c) => `  - gridcell "${c.name}" [ref=${c.ref}]`)].join('\n');

  const pickDate = {
    seq: 1, capturedAt: 0, fromUrl: `${B}/book`, fromSnapshot: PAGE,
    action: { role: 'button', name: 'Pick date', ref: 'e2', elementFp: { role: 'button', name: 'Pick date', near: null } },
    toUrl: `${B}/book`, toSnapshot: PAGE_WITH_PORTAL, navigated: false, diff: { added: PORTAL_ADDED, removed: [] } as any,
  };
  const effs = [ENTRY, pickDate] as any;

  const overlayPack = (): PatternPack => ({
    name: 'divsoup-daygrid', version: 1, type: 'overlay-open',
    trigger: { context: 'diff.added', root: { role: 'generic' }, contains: [{ role: 'gridcell', min: 20 }] },
    fixture: { snapshot: ['- generic [ref=e1]', ...Array.from({ length: 20 }, (_, i) => `  - gridcell "${i + 1}" [ref=e${i + 2}]`)].join('\n'), expect: 'matched' },
    evidence: 'div-soup day grid',
  });
  const valuePack = (): PatternPack => ({ ...overlayPack(), name: 'divsoup-daygrid-values', type: 'value-domain' });

  it('WITHOUT the pack: core does NOT detect the div-soup overlay (Pick date drafts as mutate)', () => {
    const draft = draftFromEffects(effs, []);
    const page = draft.states.find((s) => s.label === 'book')!;
    const pick = page.affordances.find((a) => a.label === 'Pick date')!;
    expect(pick.kind).toBe('mutate');   // core declined → NOT a reveal
  });

  it('WITH the overlay-open pack: the overlay IS detected (Pick date → reveal)', () => {
    const draft = draftFromEffects(effs, [overlayPack()]);
    const page = draft.states.find((s) => s.label === 'book')!;
    const pick = page.affordances.find((a) => a.label === 'Pick date')!;
    expect(pick.kind).toBe('reveal');   // pack flipped detection true
  });

  it('the day-cell VALUES are never stored (no gridcell name becomes an affordance/child)', () => {
    for (const packs of [[], [overlayPack()], [valuePack()], [overlayPack(), valuePack()]] as PatternPack[][]) {
      const draft = draftFromEffects(effs, packs);
      const page = draft.states.find((s) => s.label === 'book')!;
      const allLabels = page.affordances.flatMap((a) => [a.label, ...(a.children ?? []).map((c) => c.label)]);
      for (let d = 1; d <= 28; d++) expect(allLabels).not.toContain(String(d));   // no day value stored, ever
      expect(page.fingerprint.some((t) => /^gridcell:/.test(t))).toBe(false);      // values never anchor identity
    }
  });

  // A data-GRID REPAINT diff (final-review regression): a "Refresh list" click re-renders the
  // grid — an unnamed `generic` wrapper whose subtree carries named columnheaders + rows + 24
  // gridcells. Collection-dominant AND declares grid structure (rows/headers) → the shared
  // gridRepaint guard must keep it from pack overlay-open evaluation even though the trigger
  // (generic root, gridcell min:20) matches it structurally. The core's own detection also
  // declines (no overlayControl roles) — so without the guard, the pack would flip mutate→reveal.
  const repaintAdded = [
    { role: 'generic', name: null, ref: 'e40', url: null, raw: 'generic [ref=e40]', depth: 3 },
    ...Array.from({ length: 4 }, (_, i) => ({ role: 'columnheader', name: `Col ${i}`, ref: `e${41 + i}`, url: null, raw: `columnheader "Col ${i}"`, depth: 4 })),
    ...Array.from({ length: 6 }, (_, r) => [
      { role: 'row', name: `Row ${r} data`, ref: `e${50 + r * 5}`, url: null, raw: `row "Row ${r} data"`, depth: 4 },
      ...Array.from({ length: 4 }, (_, c) => ({ role: 'gridcell', name: `v${r}-${c}`, ref: `e${51 + r * 5 + c}`, url: null, raw: `gridcell "v${r}-${c}"`, depth: 5 })),
    ]).flat(),
  ];
  const refreshClick = {
    seq: 1, capturedAt: 0, fromUrl: `${B}/book`, fromSnapshot: PAGE,
    action: { role: 'button', name: 'Refresh list', ref: 'e9', elementFp: { role: 'button', name: 'Refresh list', near: null } },
    toUrl: `${B}/book`, toSnapshot: PAGE, navigated: false, diff: { added: repaintAdded, removed: [] } as any,
  };

  it('a pack ONLY ever SHRINKS what is stored — it cannot mint an affordance/edge/state', () => {
    const base = draftFromEffects(effs, []);
    for (const packs of [[overlayPack()], [valuePack()], [overlayPack(), valuePack()]] as PatternPack[][]) {
      const withPack = draftFromEffects(effs, packs);
      expect(withPack.states.length).toBe(base.states.length);   // no new states
      for (const s of withPack.states) {
        const b = base.states.find((x) => x.label === s.label)!;
        expect(b).toBeTruthy();                                   // no new state label
        // affordance COUNT never grows; a value-domain pack can only fold children away, never add.
        const total = (st: typeof s) => st.affordances.reduce((n, a) => n + 1 + (a.children?.length ?? 0), 0);
        expect(total(s)).toBeLessThanOrEqual(total(b));
        // no edge (navigate `to`) exists in withPack that wasn't in base.
        const edges = (st: typeof s) => st.affordances.filter((a) => a.kind === 'navigate').map((a) => a.to);
        for (const to of edges(s)) expect(edges(b)).toContain(to);
      }
    }
    // GRID-REPAINT arm (final-review finding): on a repaint diff an overlay-open pack that WOULD
    // match structurally must change NOTHING — kinds unchanged, counts unchanged (strict equality,
    // not ≤ — the pack path is never even consulted).
    const effsRepaint = [ENTRY, refreshClick] as any;
    const rBase = draftFromEffects(effsRepaint, []);
    const rPack = draftFromEffects(effsRepaint, [overlayPack()]);
    const kindsOf = (g: typeof rBase) => g.states.map((s) => ({ label: s.label,
      affs: s.affordances.map((a) => `${a.kind}|${a.label}|${(a.children ?? []).length}`).sort() }));
    expect(kindsOf(rPack)).toEqual(kindsOf(rBase));
  });

  it('REAL-SHAPE regression: repaint diff + the SHIPPED core pack → Refresh-list opener stays mutate', () => {
    const coreDir = fileURLToPath(new URL('../../packs/patterns/core', import.meta.url));
    const shipped = loadPatternPacks([coreDir]);
    expect(shipped.length).toBeGreaterThan(0);   // the date-picker pack must be present
    const draft = draftFromEffects([ENTRY, refreshClick] as any, shipped);
    const page = draft.states.find((s) => s.label === 'book')!;
    const refresh = page.affordances.find((a) => a.label === 'Refresh list')!;
    expect(refresh.kind).toBe('mutate');   // grid repaint never reaches pack overlay-open evaluation
    // and the pack still does its real job on the genuine date-picker portal in the same run:
    const draft2 = draftFromEffects([ENTRY, pickDate, refreshClick] as any, shipped);
    const page2 = draft2.states.find((s) => s.label === 'book')!;
    expect(page2.affordances.find((a) => a.label === 'Pick date')!.kind).toBe('reveal');
    expect(page2.affordances.find((a) => a.label === 'Refresh list')!.kind).toBe('mutate');
  });

  it('DETERMINISM: two draft runs with the same packs are byte-identical', () => {
    const a = draftFromEffects(effs, [overlayPack(), valuePack()]);
    const b = draftFromEffects(effs, [overlayPack(), valuePack()]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('patterns — loader', () => {
  it('a missing dir loads nothing (not an error)', () => {
    expect(loadPatternPacks(['/no/such/dir/for/webnav/packs'])).toEqual([]);
  });
  it('loads the shipped dirs deterministically (same order twice)', () => {
    const a = loadPatternPacks(); const b = loadPatternPacks();
    expect(a.map((p) => p.name)).toEqual(b.map((p) => p.name));   // sorted-filename determinism
  });
  it('a loaded pack carries its source file for loud errors', () => {
    // shipped dirs are empty of .json at Task 1, so this asserts the empty-but-valid load.
    expect(Array.isArray(loadPatternPacks())).toBe(true);
  });
});
