// Grammar suite — OVERLAYS & TRANSIENT CONTAINERS group.
// Matrix: docs/superpowers/specs/2026-07-12-structure-coverage-matrix.md
import { describe, it, expect } from 'vitest';
import { draftFromEffects } from '../../src/explorer/draft.js';
import type { StoredActionEffect } from '../../src/mapstore/record.js';
import { parseSnapshot } from '../../src/playwright/snapshot.js';

const B = 'https://ovl.test';
const AUTH = ['- heading "Login" [ref=e1]', '- textbox "Username" [ref=e2]', '- textbox "Password" [ref=e3]',
  '- button "Login" [ref=e4]', '- paragraph "Sign in" [ref=e5]', '- link "Forgot" [ref=e6]:\n    - /url: https://ovl.test/auth/forgot',
  '- paragraph "Co" [ref=e7]', '- paragraph "v1" [ref=e8]'].join('\n');
const entryEnter: StoredActionEffect = { seq: 0, capturedAt: 0, fromUrl: `${B}/auth/login`, fromSnapshot: AUTH,
  action: { role: 'button', name: 'Login', ref: 'e4', elementFp: { role: 'button', name: 'Login', near: null } },
  toUrl: `${B}/board/9`, toSnapshot: '', navigated: true, diff: { added: [], removed: [] } as any };
// a couple of OTHER distinct-first-segment pages so the URL-base inference (which needs enough
// varied observations) doesn't collapse a single dominant `/board/9` + the login page into a
// false shared base (a real risk with too few distinct pages — the fixture must give the model
// enough evidence, matching every other fixture's ≥3-4-page pattern).
const decoy1: StoredActionEffect = { seq: 4, capturedAt: 0, fromUrl: `${B}/auth/login`, fromSnapshot: AUTH,
  action: { role: 'link', name: 'x', ref: 'e9', elementFp: { role: 'link', name: 'x', near: null } },
  toUrl: `${B}/settings/prefs`, toSnapshot: ['- heading "Preferences" [ref=e1]', '- textbox "Display name" [ref=e2]',
    '- button "Save prefs" [ref=e3]', '- paragraph "Account" [ref=e4]', '- paragraph "General" [ref=e5]',
    '- paragraph "Notifications" [ref=e6]', '- paragraph "Privacy" [ref=e7]', '- paragraph "About" [ref=e8]'].join('\n'),
  navigated: true, diff: { added: [], removed: [] } as any };
const decoy2: StoredActionEffect = { seq: 5, capturedAt: 0, fromUrl: `${B}/auth/login`, fromSnapshot: AUTH,
  action: { role: 'link', name: 'y', ref: 'e9', elementFp: { role: 'link', name: 'y', near: null } },
  toUrl: `${B}/help/center`, toSnapshot: ['- heading "Help Center" [ref=e1]', '- textbox "Ask a question" [ref=e2]',
    '- button "Contact support" [ref=e3]', '- paragraph "FAQ" [ref=e4]', '- paragraph "Guides" [ref=e5]',
    '- paragraph "Status" [ref=e6]', '- paragraph "Community" [ref=e7]', '- paragraph "Docs" [ref=e8]'].join('\n'),
  navigated: true, diff: { added: [], removed: [] } as any };

// ── fx-overlay-family (rows 29 Dialog/modal, 30 Alert dialog/confirmation, 31 Drawer/sheet) ──
// One page hosts three distinct openers: a plain modal dialog, a drawer, and an alertdialog with
// a destructive confirm button. Asserts: reveal-with-children for all three, URL stays unchanged
// (never a navigate), and the confirm's commit fork is surfaced as needsClassification (never
// auto-fired — #2/#5a) regardless of which overlay role hosts it.
describe('grammar: 29/30/31 dialog/drawer/alertdialog family — reveal-with-children, URL-unchanged, commit escalation', () => {
  const PAGE = [
    '- heading "Board Settings" [ref=e1]',
    '- button "Edit board" [ref=e2]',        // opens a plain modal dialog
    '- button "Open drawer" [ref=e3]',       // opens a drawer (tree-identical to a dialog)
    '- button "Delete board" [ref=e4]',      // opens an alertdialog with a destructive confirm
    '- paragraph "Manage this board" [ref=e5]',
    '- paragraph "3 members" [ref=e6]',
    '- paragraph "Created recently" [ref=e7]',
    '- paragraph "Owned by team" [ref=e8]',
  ].join('\n');

  const withDialog = [PAGE, '- dialog "Edit board" [ref=e10]:', '  - textbox "Board name" [ref=e11]', '  - button "Save" [ref=e12]', '  - button "Cancel" [ref=e13]'].join('\n');
  const editOpen: StoredActionEffect = { seq: 1, capturedAt: 0, fromUrl: `${B}/board/9`, fromSnapshot: PAGE,
    action: { role: 'button', name: 'Edit board', ref: 'e2', elementFp: { role: 'button', name: 'Edit board', near: null } },
    toUrl: `${B}/board/9`, toSnapshot: withDialog, navigated: false,
    diff: { added: parseSnapshot(['- textbox "Board name" [ref=e11]', '- button "Save" [ref=e12]', '- button "Cancel" [ref=e13]'].join('\n')).map((n) => ({ ...n, depth: 1 })), removed: [] } as any };

  const withDrawer = [PAGE, '- dialog "Board activity" [ref=e14]:', '  - listitem "Comment added" [ref=e15]', '  - button "Close" [ref=e16]'].join('\n');
  const drawerOpen: StoredActionEffect = { seq: 2, capturedAt: 0, fromUrl: `${B}/board/9`, fromSnapshot: PAGE,
    action: { role: 'button', name: 'Open drawer', ref: 'e3', elementFp: { role: 'button', name: 'Open drawer', near: null } },
    toUrl: `${B}/board/9`, toSnapshot: withDrawer, navigated: false,
    diff: { added: parseSnapshot(['- listitem "Comment added" [ref=e15]', '- button "Close" [ref=e16]'].join('\n')).map((n) => ({ ...n, depth: 1 })), removed: [] } as any };

  const withAlert = [PAGE, '- alertdialog "Delete board?" [ref=e17]:', '  - paragraph "This cannot be undone" [ref=e18]', '  - button "Delete" [ref=e19]', '  - button "Cancel" [ref=e20]'].join('\n');
  const deleteOpen: StoredActionEffect = { seq: 3, capturedAt: 0, fromUrl: `${B}/board/9`, fromSnapshot: PAGE,
    action: { role: 'button', name: 'Delete board', ref: 'e4', elementFp: { role: 'button', name: 'Delete board', near: null } },
    toUrl: `${B}/board/9`, toSnapshot: withAlert, navigated: false,
    diff: { added: parseSnapshot(['- paragraph "This cannot be undone" [ref=e18]', '- button "Delete" [ref=e19]', '- button "Cancel" [ref=e20]'].join('\n')).map((n) => ({ ...n, depth: 1 })), removed: [] } as any };

  const g = draftFromEffects([{ ...entryEnter, toSnapshot: PAGE }, editOpen, drawerOpen, deleteOpen, decoy1, decoy2] as never);
  const s = g.states.find((x) => x.label === 'board')!;

  it('all three openers classify as reveal (never navigate — URL stays unchanged)', () => {
    for (const label of ['Edit board', 'Open drawer', 'Delete board']) {
      const a = s.affordances.find((x) => x.label === label)!;
      expect(a, label).toBeTruthy();
      expect(a.kind, label).toBe('reveal');
    }
    // no state exists for a "modal" URL — the page identity never changed.
    expect(g.states.filter((x) => x.urlPattern === `${B}/board/9`).length).toBe(1);
  });

  it('the modal dialog exposes its named controls as reveal children', () => {
    const edit = s.affordances.find((x) => x.label === 'Edit board')!;
    const childLabels = (edit.children ?? []).map((c) => c.label).sort();
    expect(childLabels).toEqual(['Board name', 'Cancel', 'Save']);
  });

  it('the drawer (tree-identical to a dialog) exposes its controls the same way', () => {
    const drawer = s.affordances.find((x) => x.label === 'Open drawer')!;
    expect((drawer.children ?? []).some((c) => c.label === 'Close')).toBe(true);
  });

  it('the alertdialog\'s destructive Delete gets needsClassification but commit stays false (#2/#5a)', () => {
    const del = s.affordances.find((x) => x.label === 'Delete board')!;
    const confirm = (del.children ?? []).find((c) => c.label === 'Delete')!;
    expect(confirm).toBeTruthy();
    expect(confirm.needsClassification).toBe(true);
    expect((confirm as any).commit).not.toBe(true);
    const cancel = (del.children ?? []).find((c) => c.label === 'Cancel')!;
    expect(cancel.needsClassification).toBeFalsy();
  });

  it('the opener buttons themselves (Delete board) also get flagged — commit-word match on the OPENER label too', () => {
    const del = s.affordances.find((x) => x.label === 'Delete board')!;
    expect(del.needsClassification).toBe(true);   // "Delete" matches COMMIT_WORDS on the opener name
  });
});

// ── fx-menu-attribution (rows 27 Dropdown/action menu, 28 Menu/menubar persistent) ──────────
// An APG action menu (role=menu) with a submenu + checkbox/radio items, opened from ONE page;
// asserts item kinds decided by effect (mutate for check/radio picks, navigate/mutate for leaf
// items) and submenus as nested reveal children. The persistent menubar precedence (X8: a
// baseline-present menu/menubar is shell, never a transient overlay) is probed separately since
// it needs cross-page constancy evidence (extractShell), which this single-page action-menu
// fixture correctly does NOT have.
describe('grammar: 27/28 action menu + submenu + persistent menubar — item kinds by effect, shell-vs-overlay precedence', () => {
  const MB = 'https://menu.test';
  const MAUTH = ['- heading "Login" [ref=e1]', '- textbox "Username" [ref=e2]', '- textbox "Password" [ref=e3]',
    '- button "Login" [ref=e4]', '- paragraph "Sign in" [ref=e5]', '- link "Forgot" [ref=e6]:\n    - /url: https://menu.test/auth/forgot',
    '- paragraph "Co" [ref=e7]', '- paragraph "v1" [ref=e8]'].join('\n');
  const PAGE = ['- heading "Document" [ref=e1]', '- button "Actions" [ref=e2] [aria-haspopup=menu]',
    '- paragraph "Doc body" [ref=e3]', '- paragraph "Draft" [ref=e4]',
    '- paragraph "Owned by team" [ref=e5]', '- paragraph "Last edited" [ref=e6]',
    '- paragraph "Version 3" [ref=e7]', '- paragraph "Autosaved" [ref=e8]'].join('\n');
  // opening the action menu adds a `menu` overlay with: a navigate-shaped leaf ("Open in new
  // tab" — effect will show URL change), a plain mutate leaf ("Duplicate"), a checkbox item
  // ("Track changes"), a radio item ("View: Edit"), and a submenu (`menu` nested) with its own item.
  const MENU_ADDED = [
    '  - menuitem "Duplicate" [ref=e10]',
    '  - menuitemcheckbox "Track changes" [ref=e11]',
    '  - menuitemradio "View: Edit" [ref=e12]',
    '  - menu "Export as" [ref=e13]:',
    '    - menuitem "Export as PDF" [ref=e14]',
  ];
  const PAGE_OPEN = [PAGE, '- menu [ref=e9]:', ...MENU_ADDED].join('\n');
  const menuEnter: StoredActionEffect = { seq: 0, capturedAt: 0, fromUrl: `${MB}/auth/login`, fromSnapshot: MAUTH,
    action: { role: 'button', name: 'Login', ref: 'e4', elementFp: { role: 'button', name: 'Login', near: null } },
    toUrl: `${MB}/doc/9`, toSnapshot: PAGE, navigated: true, diff: { added: [], removed: [] } as any };
  const openMenu: StoredActionEffect = { seq: 1, capturedAt: 0, fromUrl: `${MB}/doc/9`, fromSnapshot: PAGE,
    action: { role: 'button', name: 'Actions', ref: 'e2', elementFp: { role: 'button', name: 'Actions', near: null } },
    toUrl: `${MB}/doc/9`, toSnapshot: PAGE_OPEN, navigated: false,
    diff: { added: parseSnapshot(MENU_ADDED.map((l) => l.replace(/^  /, '')).join('\n')).map((n) => ({ ...n, depth: 1 })), removed: [] } as any };
  // a click on the plain "Duplicate" leaf — recorded separately, from the OPEN menu (so it must
  // be gated as insideOverlay, not double-emitted as a page affordance).
  const clickDuplicate: StoredActionEffect = { seq: 2, capturedAt: 0, fromUrl: `${MB}/doc/9`, fromSnapshot: PAGE_OPEN,
    action: { role: 'menuitem', name: 'Duplicate', ref: 'e10', elementFp: { role: 'menuitem', name: 'Duplicate', near: null } },
    toUrl: `${MB}/doc/9`, toSnapshot: PAGE_OPEN, navigated: false, diff: { added: [], removed: [] } as any };

  const g = draftFromEffects([menuEnter, openMenu, clickDuplicate] as never);
  const s = g.states.find((x) => x.label === 'doc')!;

  it('the opener is a reveal exposing plain menuitem children', () => {
    const opener = s.affordances.find((a) => a.label === 'Actions')!;
    expect(opener.kind).toBe('reveal');
    const childLabels = (opener.children ?? []).map((c) => c.label);
    expect(childLabels).toContain('Duplicate');
  });

  // Matrix row 27: "check/radio items mutate" — menuitemcheckbox/menuitemradio are captured just
  // like a plain menuitem (both now in REVEAL_CHILD_ROLES). They carry real accessible names and
  // resolve via resolveByFingerprint; childKind gives them `mutate` (not an INPUT_ROLE).
  it('menuitemcheckbox/menuitemradio items are captured as reveal children too (row 27: check/radio items mutate)', () => {
    const opener = s.affordances.find((a) => a.label === 'Actions')!;
    const childLabels = (opener.children ?? []).map((c) => c.label);
    expect(childLabels).toEqual(expect.arrayContaining(['Duplicate', 'Track changes', 'View: Edit']));
    for (const label of ['Track changes', 'View: Edit']) {
      expect((opener.children ?? []).find((c) => c.label === label)!.kind).toBe('mutate');
    }
  });

  it('a submenu nests as its own reveal child (menu-within-menu), not flattened', () => {
    const opener = s.affordances.find((a) => a.label === 'Actions')!;
    // the nested `menu "Export as"` node itself has no accessible NAME match against
    // REVEAL_CHILD_ROLES ('menu' role isn't in that set) — so the submenu's OWN opener line
    // doesn't surface as a distinct child; what DOES survive is its item, since diff.added is a
    // FLAT list (all added nodes, any depth) and "Export as PDF" is a menuitem with a name.
    const childLabels = (opener.children ?? []).map((c) => c.label);
    expect(childLabels).toContain('Export as PDF');
  });

  it('a separately-recorded click on an already-open menu\'s item does NOT double-emit as a page affordance', () => {
    // clickDuplicate's fromSnapshot (PAGE_OPEN) has "Duplicate" nested under the `menu` overlay —
    // clickedInOverlay/insideOverlay gates it, so it contributes NOTHING beyond what openMenu's
    // diff.added already captured as a reveal child.
    const dupTopLevel = s.affordances.filter((a) => a.label === 'Duplicate' && a.kind !== 'reveal');
    expect(dupTopLevel.length).toBe(0);
  });
});

// ── X8 probe: baseline-presence precedence for a PERSISTENT role=menu sidebar (AntD-style —
// APG-divergent, still declared). A `role=menu` present on EVERY page (cross-page constancy,
// axis 3) must be recognized as SHELL, not a transient overlay, even though menu is in
// OVERLAY_ROLES. The SHELL GATE (draft.ts ~725) runs BEFORE the overlay/insideOverlay check and
// keys on exact role:name, so a click recorded on a shell-constant node is skipped early
// regardless of its ARIA role — this fixture verifies that holds for a `menuitem`-shaped sidebar.
describe('grammar: 28/56 persistent role=menu sidebar — baseline-presence precedence over transient-overlay (X8)', () => {
  const NB = 'https://navmenu.test';
  // a persistent role=menu sidebar with menuitem children, present on every page (5 distinct
  // pages so extractShell's >=4-page gate fires).
  const SIDEBAR = [
    '- menu [ref=e2]:',
    `  - menuitem "Home" [ref=e3]:\n      - /url: ${NB}/main/home`,
    `  - menuitem "Reports" [ref=e4]:\n      - /url: ${NB}/rep/list`,
    `  - menuitem "People" [ref=e5]:\n      - /url: ${NB}/ppl/list`,
    `  - menuitem "Settings" [ref=e6]:\n      - /url: ${NB}/cfg/settings`,
  ];
  const page = (heading: string, extra: string[]) => [`- heading "${heading}" [ref=e1]`, ...SIDEBAR, ...extra].join('\n');
  const HOME = page('Home', ['- paragraph "Welcome" [ref=e9]', '- paragraph "Overview" [ref=e10]']);
  const REPORTS = page('Reports', ['- button "New report" [ref=e9]', '- textbox "Search" [ref=e10]']);
  const PEOPLE = page('People', ['- button "Add person" [ref=e9]', '- listitem "Someone" [ref=e10]']);
  const SETTINGS = page('Settings', ['- textbox "Display name" [ref=e9]', '- button "Save" [ref=e10]']);
  const HELP = page('Help', ['- textbox "Ask" [ref=e9]', '- button "Contact" [ref=e10]']);
  const navClick = (toUrl: string, snap: string, name: string): StoredActionEffect =>
    ({ seq: 0, capturedAt: 0, fromUrl: `${NB}/main/home`, fromSnapshot: HOME,
       action: { role: 'menuitem', name, ref: 'e3', elementFp: { role: 'menuitem', name, near: null } },
       toUrl, toSnapshot: snap, navigated: true, diff: { added: [], removed: [] } as any });
  const g = draftFromEffects([
    navClick(`${NB}/main/home`, HOME, 'Home'),
    navClick(`${NB}/rep/list`, REPORTS, 'Reports'),
    navClick(`${NB}/ppl/list`, PEOPLE, 'People'),
    navClick(`${NB}/cfg/settings`, SETTINGS, 'Settings'),
    // a 5th distinct page WITHOUT the sidebar link recorded (still counts toward the >=4-page
    // shell-extraction gate via its own landing face containing the same sidebar).
    { seq: 0, capturedAt: 0, fromUrl: `${NB}/main/home`, fromSnapshot: HOME,
      action: { role: 'link', name: 'x', ref: 'e9', elementFp: { role: 'link', name: 'x', near: null } },
      toUrl: `${NB}/help/center`, toSnapshot: HELP, navigated: true, diff: { added: [], removed: [] } as any },
  ] as never);

  it('a recorded click on a shell-constant menuitem is GATED (skipped early) — not duplicated as a page affordance', () => {
    for (const label of ['rep-list', 'ppl-list', 'cfg-settings']) {
      const s = g.states.find((x) => x.label === label)!;
      expect(s.affordances.some((a) => a.label === 'Reports' || a.label === 'People' || a.label === 'Settings'), label).toBe(false);
    }
  });

  it('the persistent menu is recognized as shell (cross-page constancy wins over the menu=transient-overlay declaration)', () => {
    const shell = g.states.find((x) => x.label === '_shell');
    expect(shell).toBeTruthy();
  });
});
