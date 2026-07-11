// Grammar suite — PAGE STRUCTURE & CHROME group.
// Matrix: docs/superpowers/specs/2026-07-12-structure-coverage-matrix.md
import { describe, it, expect } from 'vitest';
import { draftFromEffects } from '../../src/explorer/draft.js';
import type { StoredActionEffect } from '../../src/mapstore/record.js';

// ── fx-app-shell (rows 53 Landmarks, 54 App shell, 55 App bar/navbar, 56 Sidebar/vertical nav) ──
// 5 pages sharing a banner + sidebar (5-link nav) + a complementary rail; asserts ONE shell
// record, from-anywhere mesh, and that page states don't re-carry the sidebar as their own edges.
describe('grammar: 53/54/55/56 app shell — one shell record, from-anywhere mesh, no per-page duplication', () => {
  const SB = 'https://shell.test';
  const NAV = [
    `- link "Home" [ref=e2]:\n    - /url: ${SB}/main/home`,
    `- link "Reports" [ref=e3]:\n    - /url: ${SB}/rep/list`,
    `- link "People" [ref=e4]:\n    - /url: ${SB}/ppl/list`,
    `- link "Settings" [ref=e5]:\n    - /url: ${SB}/cfg/settings`,
    `- link "Help" [ref=e6]:\n    - /url: ${SB}/help/center`,
    // a persistent right-rail (complementary landmark equivalent, modeled as a labeled region-ish
    // control set) present on EVERY page too — the OQ1 main-scoping probe: it must not pollute
    // page identity even though it's constant chrome.
    '- button "Open notifications" [ref=e7]',
    '- button "Toggle theme" [ref=e8]',
  ];
  const page = (heading: string, extra: string[]): string =>
    [`- heading "${heading}" [ref=e1]`, ...NAV, ...extra].join('\n');
  const HOME = page('Home', ['- paragraph "Welcome" [ref=e9]', '- paragraph "Recent activity" [ref=e10]']);
  const REPORTS = page('Reports', ['- button "New report" [ref=e9]', '- textbox "Search reports" [ref=e10]']);
  const PEOPLE = page('People', ['- button "Add person" [ref=e9]', '- listitem "Someone" [ref=e10]']);
  const SETTINGS = page('Settings', ['- textbox "Display name" [ref=e9]', '- button "Save prefs" [ref=e10]']);
  const HELP = page('Help', ['- textbox "Ask a question" [ref=e9]', '- button "Contact support" [ref=e10]']);
  const shellNav = (toUrl: string, snap: string): StoredActionEffect =>
    ({ seq: 0, capturedAt: 0, fromUrl: `${SB}/main/home`, fromSnapshot: HOME,
       action: { role: 'link', name: 'x', ref: 'e2', elementFp: { role: 'link', name: 'x', near: null } },
       toUrl, toSnapshot: snap, navigated: true, diff: { added: [], removed: [] } as any });
  const g = draftFromEffects([
    shellNav(`${SB}/main/home`, HOME),
    shellNav(`${SB}/rep/list`, REPORTS),
    shellNav(`${SB}/ppl/list`, PEOPLE),
    shellNav(`${SB}/cfg/settings`, SETTINGS),
    shellNav(`${SB}/help/center`, HELP),
  ] as never);

  it('extracts exactly one `_shell` state (role: shell) carrying the sidebar as navigate edges', () => {
    const shell = g.states.filter((s) => s.label === '_shell');
    expect(shell.length).toBe(1);
    expect(shell[0].role).toBe('shell');
    for (const to of ['rep-list', 'ppl-list', 'cfg-settings', 'help-center']) {
      expect(shell[0].affordances.some((a) => a.kind === 'navigate' && a.to === to), to).toBe(true);
    }
  });

  it('the shell links form a from-anywhere mesh: no page state re-carries a sidebar navigate', () => {
    for (const label of ['rep-list', 'ppl-list', 'cfg-settings', 'help-center']) {
      const s = g.states.find((x) => x.label === label)!;
      // none of the sidebar targets appear as page-level (non-shell) navigate affordances
      for (const to of ['main-home', 'rep-list', 'ppl-list', 'cfg-settings', 'help-center']) {
        if (to === label) continue;
        expect(s.affordances.some((a) => a.kind === 'navigate' && a.to === to), `${label} -> ${to}`).toBe(false);
      }
    }
  });

  it('the persistent right-rail buttons (constant across all pages) also land on _shell, not per-page', () => {
    const shell = g.states.find((s) => s.label === '_shell')!;
    // "Open notifications"/"Toggle theme" are constant chrome -> shell-gated, not page affordances.
    for (const label of ['main-home', 'rep-list']) {
      const s = g.states.find((x) => x.label === label)!;
      expect(s.affordances.some((a) => a.label === 'Open notifications' || a.label === 'Toggle theme')).toBe(false);
    }
  });

  it('_shell is excluded from receipt.states and the hierarchy tree (not a page)', () => {
    expect(g.receipt.states).not.toContain('_shell');
    expect(g.states.find((s) => s.label === '_shell')!.parentState).toBeUndefined();
  });
});

// ── fx-app-shell OQ1 probe: main-landmark identity scoping (X3, FIXED 2026-07-12). The matrix
// (row 54) documented this PARTIAL — a per-page-VARYING complementary rail (not constant enough to
// be shell) leaked into state identity. X3's fix: when a landing DECLARES a `main` landmark, the
// identity face + fingerprint candidate pool scope to the `main` subtree, so a rail OUTSIDE `main`
// can no longer anchor identity. The fixture now matches the real progneo shape — content in
// `main`, a per-page-varying `Notify: N new` rail in a `complementary` OUTSIDE it. (This was the
// documented rail-LEAK gap before X3; the assertions below are the FIXED behavior.)
describe('grammar: 54 app shell OQ1 probe — a rail OUTSIDE `main` does NOT anchor identity (X3 fixed)', () => {
  const SB = 'https://rail.test';
  const NAV = [
    `- link "Home" [ref=e2]:\n      - /url: ${SB}/main/home`,
    `- link "Reports" [ref=e3]:\n      - /url: ${SB}/rep/list`,
    `- link "People" [ref=e4]:\n      - /url: ${SB}/ppl/list`,
    `- link "Settings" [ref=e5]:\n      - /url: ${SB}/cfg/settings`,
  ];
  // content lives inside `main`; the varying rail sits in a `complementary` OUTSIDE `main`.
  const page = (heading: string, rail: string, extra: string[]): string =>
    ['- banner [ref=e0]:', ...NAV.map((l) => '    ' + l),
     `- complementary [ref=e8]:\n    - button "${rail}" [ref=e9]`,
     '- main [ref=e1]:', `    - heading "${heading}" [ref=e10]`, ...extra.map((x) => '    ' + x)].join('\n');
  const HOME = page('Home', 'Notify: 2 new', ['- paragraph "Welcome" [ref=e11]', '- paragraph "Overview" [ref=e12]', '- button "Create item" [ref=e13]']);
  const REPORTS = page('Reports', 'Notify: 5 new', ['- button "New report" [ref=e11]', '- textbox "Search" [ref=e12]', '- paragraph "Report list" [ref=e13]']);
  const PEOPLE = page('People', 'Notify: 0 new', ['- button "Add person" [ref=e11]', '- listitem "Someone" [ref=e12]', '- paragraph "People dir" [ref=e13]']);
  const SETTINGS = page('Settings', 'Notify: 1 new', ['- textbox "Name" [ref=e11]', '- button "Save" [ref=e12]', '- paragraph "Prefs" [ref=e13]']);
  const nav = (toUrl: string, snap: string): StoredActionEffect =>
    ({ seq: 0, capturedAt: 0, fromUrl: `${SB}/main/home`, fromSnapshot: HOME,
       action: { role: 'link', name: 'x', ref: 'e2', elementFp: { role: 'link', name: 'x', near: null } },
       toUrl, toSnapshot: snap, navigated: true, diff: { added: [], removed: [] } as any });
  const g = draftFromEffects([
    nav(`${SB}/main/home`, HOME), nav(`${SB}/rep/list`, REPORTS),
    nav(`${SB}/ppl/list`, PEOPLE), nav(`${SB}/cfg/settings`, SETTINGS),
  ] as never);

  it('a per-page-varying rail token ("Notify: N new") never becomes shell (differs on every page, <80% constancy)', () => {
    const shell = g.states.find((s) => s.label === '_shell');
    const railTokens = ['Notify: 2 new', 'Notify: 5 new', 'Notify: 0 new', 'Notify: 1 new'];
    if (shell) {
      for (const t of railTokens) expect(shell.affordances.some((a) => a.label === t)).toBe(false);
    }
  });

  it('the varying rail token OUTSIDE `main` does NOT anchor any state fingerprint (X3: main-scoped identity)', () => {
    // FIXED behavior: with `main` declared, identity scopes to the main subtree, so a
    // complementary-rail token can never enter a state's fingerprint. Each page's identity rests
    // on its `main` heading, not on the ancillary rail.
    const railTokens = ['Notify: 2 new', 'Notify: 5 new', 'Notify: 0 new', 'Notify: 1 new'];
    for (const s of g.states) {
      for (const t of railTokens) expect(s.fingerprint.join(','), `${s.label} fp`).not.toContain(t);
    }
    // identity rests on the in-`main` heading instead.
    const home = g.states.find((s) => s.label === 'main-home')!;
    expect(home.fingerprint).toContain('heading:Home');
  });
});

// The discriminating OQ1 probe: two SAME-URL landings IDENTICAL inside `main`, differing ONLY in a
// large complementary rail OUTSIDE `main`. Before X3 the rail dragged full-face jaccard below the
// SPA-split bar → two clusters with no distinguishing heading → the state was LOST to needsFix
// ("same-url state with no distinguishing heading"). With X3 the identity face scopes to `main`
// (identical) → one clean state. This is the rail-LEAK class the matrix (row 54 / X3) names, and
// the RED/GREEN pin: it FAILS on the pre-X3 code (state → needsFix) and PASSES with main-scoping.
describe('grammar: 54 app shell OQ1 — same-`main` landings with a differing rail MERGE, not split (X3 fixed)', () => {
  const U = 'https://rail.test/dash/view';
  const rail = (items: string[]): string =>
    '- complementary [ref=e8]:\n' + items.map((t, i) => `    - button "${t}" [ref=e${20 + i}]`).join('\n');
  const MAIN = ['- main [ref=e1]:',
    '    - heading "Sales View" [ref=e10]',
    '    - button "Export" [ref=e11]', '    - button "Refresh" [ref=e12]',
    '    - textbox "Filter" [ref=e13]', '    - paragraph "Sales content here" [ref=e14]'].join('\n');
  const A = ['- banner [ref=e0]', rail(['Alpha news 1', 'Alpha news 2', 'Alpha news 3', 'Alpha news 4', 'Alpha news 5']), MAIN].join('\n');
  const B = ['- banner [ref=e0]', rail(['Beta note 9', 'Beta note 8', 'Beta note 7', 'Beta note 6', 'Beta note 5']), MAIN].join('\n');
  const nav = (snap: string, seq: number): StoredActionEffect =>
    ({ seq, capturedAt: 0, fromUrl: U, fromSnapshot: A,
       action: { role: 'link', name: 'x', ref: 'e2', elementFp: { role: 'link', name: 'x', near: null } },
       toUrl: U, toSnapshot: snap, navigated: true, diff: { added: [], removed: [] } as any });
  const g = draftFromEffects([nav(A, 0), nav(B, 1)] as never);

  it('the two landings collapse to ONE state (no spurious SPA split from the differing rail)', () => {
    const pages = g.states.filter((s) => s.label !== '_shell');
    expect(pages.length).toBe(1);
    expect(pages[0].fingerprint).toContain('heading:Sales View');
    expect((g.needsFix ?? []).some((n) => /same-url state with no distinguishing heading/.test(n.reason))).toBe(false);
  });
});
