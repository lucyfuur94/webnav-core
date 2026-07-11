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

// ── fx-app-shell OQ1 probe: main-landmark identity scoping. The matrix (row 54) documents this
// as PARTIAL — ancillary complementary rails can pollute state identity via spurious provisional
// splits. We probe with a SINGLE-instance dashboard whose only variance vs its siblings would come
// from the rail; today's shell-extraction (axis 3, cross-PAGE presence) already removes constant
// chrome regardless of landmark role, so a rail present on every page is caught the same way as
// the sidebar — this fixture demonstrates that OQ1's harder case (a rail that's present but whose
// CONTENT varies per page, e.g. per-section notifications) is NOT exercised by simple constancy.
describe('grammar: 54 app shell OQ1 probe — a per-page-varying right rail is NOT captured by shell extraction', () => {
  const SB = 'https://rail.test';
  const NAV = [
    `- link "Home" [ref=e2]:\n    - /url: ${SB}/main/home`,
    `- link "Reports" [ref=e3]:\n    - /url: ${SB}/rep/list`,
    `- link "People" [ref=e4]:\n    - /url: ${SB}/ppl/list`,
    `- link "Settings" [ref=e5]:\n    - /url: ${SB}/cfg/settings`,
  ];
  const page = (heading: string, rail: string, extra: string[]): string =>
    [`- heading "${heading}" [ref=e1]`, ...NAV, `- button "${rail}" [ref=e9]`, ...extra].join('\n');
  const HOME = page('Home', 'Notify: 2 new', ['- paragraph "Welcome" [ref=e10]', '- paragraph "Overview" [ref=e11]']);
  const REPORTS = page('Reports', 'Notify: 5 new', ['- button "New report" [ref=e10]', '- textbox "Search" [ref=e11]']);
  const PEOPLE = page('People', 'Notify: 0 new', ['- button "Add person" [ref=e10]', '- listitem "Someone" [ref=e11]']);
  const SETTINGS = page('Settings', 'Notify: 1 new', ['- textbox "Name" [ref=e10]', '- button "Save" [ref=e11]']);
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

  it('the varying rail token DOES leak onto each page as its own affordance (OQ1: no main-scoping to exclude it)', () => {
    // this is the honest documented gap: since it's not constant it's not shell, and since it has
    // a name + resolvable role it passes interior synthesis as an ordinary page mutate — exactly
    // the "ancillary complementary rail pollutes identity/repertoire" risk the matrix names.
    const home = g.states.find((s) => s.label === 'main-home')!;
    expect(home.affordances.some((a) => a.label === 'Notify: 2 new')).toBe(true);
  });
});
