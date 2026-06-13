import { describe, it, expect } from 'vitest';
import { draftFromEffects } from '../../src/explorer/draft.js';
import type { StoredActionEffect } from '../../src/mapstore/record.js';
import { parseSnapshot } from '../../src/playwright/snapshot.js';
import { matchState } from '../../src/explorer/fingerprint.js';
import { resolveByFingerprint } from '../../src/playwright/fingerprint.js';
import { makeState } from '../../src/mapstore/types.js';

// Snapshots shaped like the real OrangeHRM captures.
const LOGIN = [
  '- heading "Login" [ref=e10]',
  '- textbox "Username" [ref=e23]',
  '- textbox "Password" [ref=e30]',
  '- button "Login" [ref=e32]',
].join('\n');
const DASHBOARD = [
  '- heading "Dashboard" [ref=e11]',
  '- link "Admin" [ref=e21]:\n    - /url: https://x.com/web/index.php/admin/viewAdminModule',
  '- link "PIM" [ref=e26]:\n    - /url: https://x.com/web/index.php/pim/viewPimModule',
].join('\n');
const ADMIN = ['- heading "Admin" [ref=e100]', '- heading "System Users" [ref=e101]'].join('\n');
const PIM = ['- heading "PIM" [ref=e200]', '- heading "Employee Information" [ref=e201]'].join('\n');

function eff(seq: number, fromUrl: string, fromSnapshot: string, action: any, toUrl: string, toSnapshot: string, navigated: boolean): StoredActionEffect {
  return { seq, capturedAt: 0, fromUrl, fromSnapshot, action, toUrl, toSnapshot, navigated,
    diff: { added: [], removed: [] } as any };
}

// A recorded walk-through: login (type user/pass, click Login) → dashboard;
// dashboard → Admin (via use navigate, action:null — the URL-nav case);
// dashboard → PIM (via use click, with elementFp).
const B = 'https://x.com/web/index.php';
const effects: StoredActionEffect[] = [
  eff(0, `${B}/auth/login`, LOGIN, { role: 'textbox', name: 'Username', ref: 'e23', elementFp: { role: 'textbox', name: 'Username', near: null } }, `${B}/auth/login`, LOGIN, false),
  eff(1, `${B}/auth/login`, LOGIN, { role: 'textbox', name: 'Password', ref: 'e30', elementFp: { role: 'textbox', name: 'Password', near: null } }, `${B}/auth/login`, LOGIN, false),
  eff(2, `${B}/auth/login`, LOGIN, { role: 'button', name: 'Login', ref: 'e32', elementFp: { role: 'button', name: 'Login', near: null } }, `${B}/dashboard/index`, DASHBOARD, true),
  // dashboard → Admin via bare use navigate (action:null) — must reconstruct from the link scan
  eff(3, `${B}/dashboard/index`, DASHBOARD, null, `${B}/admin/viewAdminModule`, ADMIN, true),
  // dashboard → PIM via use click (action carries elementFp)
  eff(4, `${B}/dashboard/index`, DASHBOARD, { role: 'link', name: 'PIM', ref: 'e26', elementFp: { role: 'link', name: 'PIM', near: null } }, `${B}/pim/viewPimModule`, PIM, true),
];

describe('draftFromEffects', () => {
  const draft = draftFromEffects(effects);
  const byLabel = Object.fromEntries(draft.states.map((s) => [s.label, s]));

  it('produces one state per distinct landing page with ABSOLUTE urlPatterns', () => {
    expect(draft.states.length).toBe(4);  // login, dashboard, admin, pim
    for (const s of draft.states) expect(s.urlPattern).toMatch(/^https:\/\//);
  });

  it('every state fingerprint resolves UNIQUELY via matchState (the review-A fix, not heading-slice)', () => {
    const stubs = draft.states.map((s) => makeState({ id: 'd:' + s.label, nodeId: 'd', semanticName: s.label, urlPattern: s.urlPattern, role: 'detail', fingerprint: s.fingerprint }));
    for (const s of draft.states) {
      const nodes = parseSnapshot(snapFor(s.label));
      const m = matchState(nodes, stubs);
      expect(m.status).toBe('matched');
      if (m.status === 'matched') expect(m.state.id).toBe('d:' + s.label);
      expect(s._warning).toBeUndefined();   // no self-verify flags
    }
  });

  it('login state fingerprints on its textboxes+button (ZERO headings case)', () => {
    expect(byLabel['auth-login'].fingerprint.some((t) => t.startsWith('textbox:') || t.startsWith('button:'))).toBe(true);
  });

  it('reconstructs the action:null (use navigate) edge by scanning the from-page links', () => {
    const dash = byLabel['dashboard-index'];
    const adminEdge = dash.affordances.find((a) => a.to === 'admin-viewadminmodule');
    expect(adminEdge).toBeTruthy();
    expect(adminEdge!.elementFp).toEqual({ role: 'link', name: 'Admin', near: null });  // from the link scan
  });

  it('carries the use-click captured elementFp onto its edge', () => {
    const dash = byLabel['dashboard-index'];
    const pimEdge = dash.affordances.find((a) => a.to === 'pim-viewpimmodule');
    expect(pimEdge!.elementFp).toEqual({ role: 'link', name: 'PIM', near: null });
  });

  it('every navigate edge elementFp resolves via resolveByFingerprint on its from-page', () => {
    for (const s of draft.states) {
      const nodes = parseSnapshot(snapFor(s.label));
      for (const a of s.affordances) {
        if (a.kind === 'navigate' && a.elementFp) {
          expect(resolveByFingerprint(a.elementFp, nodes)).not.toBeNull();
        }
      }
    }
  });

  it('wires login: use-type fields → input affordances + the navigate gets acceptsInput=credentials', () => {
    const login = byLabel['auth-login'];
    expect(login.affordances.filter((a) => a.kind === 'input').map((a) => a.label).sort()).toEqual(['Password', 'Username']);
    const submit = login.affordances.find((a) => a.kind === 'navigate');
    expect(submit!.acceptsInput).toBe('credentials');
    expect(submit!.needs!.length).toBe(2);
  });

  it('receipt names the entry + a ready-to-run walk example', () => {
    expect(draft.receipt.entry).toBe('auth-login');
    expect(draft.receipt.walkExample).toContain('webnav walk --start');
  });
});

// ── cross-link mesh: a module page's OWN declared sidebar links to OTHER known pages
// become navigate affordances even when never clicked — so modules aren't dead-ends and
// the agent never hand-authors (error-prone) back-edges. The recorded walk only ever
// clicked dashboard→admin and dashboard→pim FORWARD; the back/sibling links live in each
// module's landing snapshot and must be synthesized.
describe('draftFromEffects — cross-link mesh (synthesized, not clicked)', () => {
  // module landings that carry the full sidebar (Dashboard + sibling modules).
  const SIDEBAR = (active: string) => [
    `- heading "${active}" [ref=e1]`,
    '- link "Dashboard" [ref=e2]:\n    - /url: https://x.com/web/index.php/dashboard/index',
    '- link "Admin" [ref=e3]:\n    - /url: https://x.com/web/index.php/admin/viewAdminModule',
    '- link "PIM" [ref=e4]:\n    - /url: https://x.com/web/index.php/pim/viewPimModule',
  ].join('\n');
  const ADMIN2 = SIDEBAR('Admin');
  const PIM2 = SIDEBAR('PIM');
  const DASH2 = [
    '- heading "Dashboard" [ref=e1]',
    '- link "Admin" [ref=e3]:\n    - /url: https://x.com/web/index.php/admin/viewAdminModule',
    '- link "PIM" [ref=e4]:\n    - /url: https://x.com/web/index.php/pim/viewPimModule',
  ].join('\n');
  const effs: StoredActionEffect[] = [
    // dashboard → admin (clicked), then admin's snapshot carries Dashboard + PIM links (never clicked).
    eff(0, `${B}/dashboard/index`, DASH2, { role: 'link', name: 'Admin', ref: 'e3', elementFp: { role: 'link', name: 'Admin', near: null } }, `${B}/admin/viewAdminModule`, ADMIN2, true),
    eff(1, `${B}/dashboard/index`, DASH2, { role: 'link', name: 'PIM', ref: 'e4', elementFp: { role: 'link', name: 'PIM', near: null } }, `${B}/pim/viewPimModule`, PIM2, true),
  ];
  const draft = draftFromEffects(effs);
  const byLabel = Object.fromEntries(draft.states.map((s) => [s.label, s]));

  it('synthesizes a back-edge from a module to Dashboard that was NEVER clicked', () => {
    const admin = byLabel['admin-viewadminmodule'];
    const back = admin.affordances.find((a) => a.to === 'dashboard-index');
    expect(back).toBeTruthy();
    expect(back!.kind).toBe('navigate');
    expect(back!.elementFp).toEqual({ role: 'link', name: 'Dashboard', near: null });
  });

  it('synthesizes a sibling-edge admin → pim from the declared sidebar', () => {
    const admin = byLabel['admin-viewadminmodule'];
    expect(admin.affordances.find((a) => a.to === 'pim-viewpimmodule')).toBeTruthy();
  });

  it('does NOT synthesize a self-edge (the active module links to its own url)', () => {
    const admin = byLabel['admin-viewadminmodule'];
    expect(admin.affordances.find((a) => a.to === 'admin-viewadminmodule')).toBeUndefined();
  });

  it('does NOT duplicate an edge already captured from a click', () => {
    const dash = byLabel['dashboard-index'];
    const adminEdges = dash.affordances.filter((a) => a.to === 'admin-viewadminmodule');
    expect(adminEdges.length).toBe(1);
  });

  it('every synthesized edge resolves on its from-page (no dead-end modules)', () => {
    const snap: Record<string, string> = {
      'dashboard-index': DASH2, 'admin-viewadminmodule': ADMIN2, 'pim-viewpimmodule': PIM2,
    };
    for (const s of draft.states) {
      const nodes = parseSnapshot(snap[s.label] ?? '');
      const navs = s.affordances.filter((a) => a.kind === 'navigate' && a.elementFp);
      // every module must have at least one outgoing edge (not a dead-end)
      expect(navs.length).toBeGreaterThan(0);
      for (const a of navs) expect(resolveByFingerprint(a.elementFp!, nodes)).not.toBeNull();
    }
  });
});

// ── Layer 1 (learning-the-core): the draft must capture the in-page affordance REPERTOIRE,
// not just navigate edges. A recorded non-navigating click → mutate; a click that opened an
// overlay (diff.added non-empty) → reveal with children; a filter form on a landing page →
// synthesized inputs; a destructive-looking affordance → needsClassification (commit stays false).
// Spec: docs/superpowers/specs/2026-06-13-learning-the-core-design.md (Layer 1).
describe('draftFromEffects — Layer 1 in-page repertoire (mutate/reveal/input/needsClassification)', () => {
  const LIST = [
    '- heading "Employee List" [ref=e1]',
    '- textbox "Employee Name" [ref=e2]',
    '- combobox "Job Title" [ref=e3]',
    '- button "Search" [ref=e4]',
    '- button "Reset" [ref=e5]',
    '- button "Add" [ref=e6]',
    '- button "Delete Selected" [ref=e7]',
  ].join('\n');
  // after a "Sort by Job Title" click: same url, nothing newly revealed (pure in-place mutate).
  const LIST_SORTED = LIST;  // identity for the diff; the action just reordered rows (no new nodes)
  // after clicking a "⋮" actions button: a menu overlay appears (new nodes added).
  const MENU_OPEN = [LIST, '- menuitem "Edit" [ref=e20]', '- menuitem "Delete" [ref=e21]'].join('\n');
  const B = 'https://hr.example.com/pim';

  const mk = (seq: number, action: any, toSnapshot: string, navigated: boolean, added: any[] = []) => ({
    seq, capturedAt: 0, fromUrl: `${B}/list`, fromSnapshot: LIST, action,
    toUrl: `${B}/list`, toSnapshot, navigated, diff: { added, removed: [] } as any,
  });

  it('a non-navigating click with NO newly-revealed nodes → a mutate affordance', () => {
    const effs = [mk(0, { role: 'button', name: 'Search', ref: 'e4', elementFp: { role: 'button', name: 'Search', near: null } }, LIST_SORTED, false)];
    const draft = draftFromEffects(effs as any);
    const list = draft.states.find((s) => s.label === 'pim-list')!;
    const search = list.affordances.find((a) => a.label === 'Search');
    expect(search).toBeTruthy();
    expect(search!.kind).toBe('mutate');
  });

  it('a non-navigating click that REVEALS new nodes → a reveal affordance with ARIA children', () => {
    const added = [
      { role: 'menuitem', name: 'Edit', ref: 'e20', url: null, raw: '', depth: 2 },
      { role: 'menuitem', name: 'Delete', ref: 'e21', url: null, raw: '', depth: 2 },
      { role: 'generic', name: null, ref: 'e22', url: null, raw: '', depth: 2 },  // no role+name → NOT a child
    ];
    const effs = [mk(0, { role: 'button', name: 'Row actions', ref: 'e9', elementFp: { role: 'button', name: 'Row actions', near: null } }, MENU_OPEN, false, added)];
    const draft = draftFromEffects(effs as any);
    const list = draft.states.find((s) => s.label === 'pim-list')!;
    const reveal = list.affordances.find((a) => a.kind === 'reveal');
    expect(reveal).toBeTruthy();
    const childLabels = (reveal!.children ?? []).map((c) => c.label).sort();
    expect(childLabels).toEqual(['Delete', 'Edit']);   // the generic/unnamed node is dropped, not guessed
  });

  it('interior-synthesis: declared-but-unclicked form fields + buttons become input/mutate', () => {
    // no recorded in-page actions at all — purely from the landing snapshot's declared elements.
    const effs = [
      { seq: 0, capturedAt: 0, fromUrl: `${B}/auth`, fromSnapshot: '- button "Login" [ref=e1]', action: { role: 'button', name: 'Login', ref: 'e1', elementFp: { role: 'button', name: 'Login', near: null } }, toUrl: `${B}/list`, toSnapshot: LIST, navigated: true, diff: { added: [], removed: [] } },
    ];
    const draft = draftFromEffects(effs as any);
    const list = draft.states.find((s) => s.label === 'pim-list')!;
    const byKind = (k: string) => list.affordances.filter((a) => a.kind === k).map((a) => a.label);
    expect(byKind('input')).toContain('Employee Name');   // textbox
    expect(byKind('input')).toContain('Job Title');        // combobox
    expect(byKind('mutate')).toEqual(expect.arrayContaining(['Search', 'Reset', 'Add', 'Delete Selected']));  // buttons
  });

  it('a destructive-looking affordance is flagged needsClassification but commit stays false (#2/#5a)', () => {
    const effs = [
      { seq: 0, capturedAt: 0, fromUrl: `${B}/auth`, fromSnapshot: '- button "Login" [ref=e1]', action: { role: 'button', name: 'Login', ref: 'e1', elementFp: { role: 'button', name: 'Login', near: null } }, toUrl: `${B}/list`, toSnapshot: LIST, navigated: true, diff: { added: [], removed: [] } },
    ];
    const draft = draftFromEffects(effs as any);
    const list = draft.states.find((s) => s.label === 'pim-list')!;
    const del = list.affordances.find((a) => a.label === 'Delete Selected')!;
    expect(del.needsClassification).toBe(true);
    expect((del as any).commit).not.toBe(true);            // never auto-set commit
    const search = list.affordances.find((a) => a.label === 'Search')!;
    expect(search.needsClassification).toBeFalsy();        // non-destructive → not flagged
  });
});

// the snapshot a given drafted state was built from (test helper)
function snapFor(label: string): string {
  return { 'auth-login': LOGIN, 'dashboard-index': DASHBOARD, 'admin-viewadminmodule': ADMIN, 'pim-viewpimmodule': PIM }[label] ?? '';
}
