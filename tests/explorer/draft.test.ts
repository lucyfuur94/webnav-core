import { describe, it, expect } from 'vitest';
import { draftFromEffects } from '../../src/explorer/draft.js';
import type { StoredActionEffect } from '../../src/mapstore/record.js';
import { parseSnapshot } from '../../src/playwright/snapshot.js';
import { matchState } from '../../src/explorer/fingerprint.js';
import { resolveByFingerprint } from '../../src/playwright/fingerprint.js';
import { makeState } from '../../src/mapstore/types.js';

// Snapshots shaped like the real OrangeHRM captures. Each landing carries ≥8 named nodes +
// a content node so classifyReadiness='ready' (the identity gate); padding is page-specific
// content so it doesn't dilute fingerprint uniqueness.
const LOGIN = [
  '- heading "Login" [ref=e10]',
  '- textbox "Username" [ref=e23]',
  '- textbox "Password" [ref=e30]',
  '- button "Login" [ref=e32]',
  '- paragraph "Enter your credentials" [ref=e33]',
  '- link "Forgot password?" [ref=e34]:\n    - /url: https://x.com/web/index.php/auth/forgot',
  '- paragraph "OrangeHRM Inc" [ref=e35]',
  '- paragraph "All rights reserved" [ref=e36]',
].join('\n');
const DASHBOARD = [
  '- heading "Dashboard" [ref=e11]',
  '- link "Admin" [ref=e21]:\n    - /url: https://x.com/web/index.php/admin/viewAdminModule',
  '- link "PIM" [ref=e26]:\n    - /url: https://x.com/web/index.php/pim/viewPimModule',
  '- heading "Time at Work" [ref=e12]',
  '- heading "My Actions" [ref=e13]',
  '- listitem "Pending self review" [ref=e14]',
  '- listitem "Candidate to interview" [ref=e15]',
  '- paragraph "Quick launch" [ref=e16]',
].join('\n');
const ADMIN = [
  '- heading "Admin" [ref=e100]', '- heading "System Users" [ref=e101]',
  '- button "Add user" [ref=e102]', '- textbox "Username filter" [ref=e103]',
  '- listitem "admin (Admin)" [ref=e104]', '- listitem "manager (ESS)" [ref=e105]',
  '- paragraph "User Management" [ref=e106]', '- paragraph "2 records found" [ref=e107]',
].join('\n');
const PIM = [
  '- heading "PIM" [ref=e200]', '- heading "Employee Information" [ref=e201]',
  '- button "Add employee" [ref=e202]', '- textbox "Employee name" [ref=e203]',
  '- listitem "John Smith" [ref=e204]', '- listitem "Jane Doe" [ref=e205]',
  '- paragraph "Employee List" [ref=e206]', '- paragraph "43 records found" [ref=e207]',
].join('\n');

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

  it('login state gets a MINIMAL unique fingerprint (heading:Login suffices here)', () => {
    // the login fixture has heading "Login" — the minimal-prefix algorithm correctly keys on
    // it (unique among the 4 pages). The point is uniqueness + minimality, not which role.
    const login = byLabel['auth-login'];
    expect(login.fingerprint).toEqual(['heading:Login']);
    expect(login._warning).toBeUndefined();
  });

  it('a ZERO-heading page fingerprints on its textbox/button tokens instead', () => {
    // when a page truly has NO heading, candidateTokens falls through to button/textbox — verify
    // the fingerprint still resolves (the real "sparse page" case). Padded to ≥8 ready nodes.
    const NOHEAD = ['- textbox "Email" [ref=e1]', '- textbox "PIN" [ref=e2]', '- button "Enter" [ref=e3]',
      '- paragraph "Sign in to continue" [ref=e4]', '- button "Cancel" [ref=e5b]', '- link "Terms" [ref=e6]:\n    - /url: https://z.test/terms',
      '- paragraph "Secure login" [ref=e7]', '- paragraph "v2.1" [ref=e8]'].join('\n');
    const HOME = ['- heading "Home" [ref=e9]', '- link "Login" [ref=e5]:\n    - /url: https://z.test/login',
      '- paragraph "Welcome" [ref=e10]', '- link "About" [ref=e11]:\n    - /url: https://z.test/about',
      '- link "Docs" [ref=e12]:\n    - /url: https://z.test/docs', '- button "Get started" [ref=e13]',
      '- paragraph "The tool" [ref=e14]', '- paragraph "Footer" [ref=e15]'].join('\n');
    const d = draftFromEffects([
      { seq: 0, capturedAt: 0, fromUrl: 'https://z.test/home', fromSnapshot: HOME, action: { role: 'link', name: 'Login', ref: 'e5', elementFp: { role: 'link', name: 'Login', near: null } }, toUrl: 'https://z.test/login', toSnapshot: NOHEAD, navigated: true, diff: { added: [], removed: [] } },
    ] as any);
    const login = d.states.find((s) => s.label === 'login')!;
    expect(login.fingerprint.some((t) => t.startsWith('textbox:') || t.startsWith('button:'))).toBe(true);
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
  // module landings that carry the full sidebar (Dashboard + sibling modules) + page-specific
  // content (so each is classifyReadiness='ready' with a unique fingerprint from its heading).
  const SIDEBAR = (active: string, content: string[]) => [
    `- heading "${active}" [ref=e1]`,
    '- link "Dashboard" [ref=e2]:\n    - /url: https://x.com/web/index.php/dashboard/index',
    '- link "Admin" [ref=e3]:\n    - /url: https://x.com/web/index.php/admin/viewAdminModule',
    '- link "PIM" [ref=e4]:\n    - /url: https://x.com/web/index.php/pim/viewPimModule',
    ...content,
  ].join('\n');
  const ADMIN2 = SIDEBAR('Admin', ['- heading "System Users" [ref=e5]', '- button "Add user" [ref=e6]',
    '- listitem "admin row" [ref=e7]', '- paragraph "User Management" [ref=e8]']);
  const PIM2 = SIDEBAR('PIM', ['- heading "Employee Information" [ref=e5]', '- button "Add employee" [ref=e6]',
    '- listitem "John row" [ref=e7]', '- paragraph "Employee List" [ref=e8]']);
  const DASH2 = [
    '- heading "Dashboard" [ref=e1]',
    '- link "Admin" [ref=e3]:\n    - /url: https://x.com/web/index.php/admin/viewAdminModule',
    '- link "PIM" [ref=e4]:\n    - /url: https://x.com/web/index.php/pim/viewPimModule',
    '- heading "Time at Work" [ref=e5]', '- listitem "Pending review" [ref=e6]',
    '- listitem "Interview candidate" [ref=e7]', '- paragraph "Quick launch" [ref=e8]',
    '- paragraph "Employee distribution" [ref=e9]',
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
    '- listitem "John Smith" [ref=e8]',   // pad to ≥8 ready nodes
  ].join('\n');
  // after a "Sort by Job Title" click: same url, nothing newly revealed (pure in-place mutate).
  const LIST_SORTED = LIST;  // identity for the diff; the action just reordered rows (no new nodes)
  // after clicking a "⋮" actions button: a menu overlay appears (new nodes added).
  const MENU_OPEN = [LIST, '- menuitem "Edit" [ref=e20]', '- menuitem "Delete" [ref=e21]'].join('\n');
  const B = 'https://hr.example.com';
  // a READY entry page distinct from /pim/list, so the URL model doesn't strip `pim` as base
  // (single-path recordings over-collapse). Prepended to every recording here.
  const AUTH = ['- heading "Login" [ref=e1]', '- textbox "Username" [ref=e2]', '- textbox "Password" [ref=e3]',
    '- button "Login" [ref=e4]', '- paragraph "Sign in" [ref=e5]', '- link "Forgot" [ref=e6]:\n    - /url: https://hr.example.com/auth/forgot',
    '- paragraph "Co" [ref=e7]', '- paragraph "v1" [ref=e8]'].join('\n');
  const ENTRY = { seq: 0, capturedAt: 0, fromUrl: `${B}/auth/login`, fromSnapshot: AUTH,
    action: { role: 'button', name: 'Login', ref: 'e4', elementFp: { role: 'button', name: 'Login', near: null } },
    toUrl: `${B}/pim/list`, toSnapshot: LIST, navigated: true, diff: { added: [], removed: [] } };

  const mk = (action: any, toSnapshot: string, navigated: boolean, added: any[] = []) => ({
    seq: 1, capturedAt: 0, fromUrl: `${B}/pim/list`, fromSnapshot: LIST, action,
    toUrl: `${B}/pim/list`, toSnapshot, navigated, diff: { added, removed: [] } as any,
  });

  it('a non-navigating click with NO newly-revealed nodes → a mutate affordance', () => {
    const effs = [ENTRY, mk({ role: 'button', name: 'Search', ref: 'e4', elementFp: { role: 'button', name: 'Search', near: null } }, LIST_SORTED, false)];
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
    const effs = [ENTRY, mk({ role: 'button', name: 'Row actions', ref: 'e9', elementFp: { role: 'button', name: 'Row actions', near: null } }, MENU_OPEN, false, added)];
    const draft = draftFromEffects(effs as any);
    const list = draft.states.find((s) => s.label === 'pim-list')!;
    const reveal = list.affordances.find((a) => a.kind === 'reveal');
    expect(reveal).toBeTruthy();
    const childLabels = (reveal!.children ?? []).map((c) => c.label).sort();
    expect(childLabels).toEqual(['Delete', 'Edit']);   // the generic/unnamed node is dropped, not guessed
  });

  it('interior-synthesis: declared-but-unclicked form fields + buttons become input/mutate', () => {
    // no recorded in-page actions — purely from the landing snapshot's declared elements.
    const draft = draftFromEffects([ENTRY] as any);
    const list = draft.states.find((s) => s.label === 'pim-list')!;
    const byKind = (k: string) => list.affordances.filter((a) => a.kind === k).map((a) => a.label);
    expect(byKind('input')).toContain('Employee Name');   // textbox
    expect(byKind('input')).toContain('Job Title');        // combobox
    expect(byKind('mutate')).toEqual(expect.arrayContaining(['Search', 'Reset', 'Add', 'Delete Selected']));  // buttons
  });

  it('a destructive-looking affordance is flagged needsClassification but commit stays false (#2/#5a)', () => {
    const draft = draftFromEffects([ENTRY] as any);
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

describe('fingerprint exclusivity (live walk finding: ambiguous landing)', () => {
  // A sparse page whose first candidate token ("Open Menu") appears on EVERY page must
  // keep growing its fingerprint until no OTHER page satisfies it — a self-match-only
  // greedy stopped at ["button:Open Menu"], and a walk landing on the rich page then
  // matched two states (matchState 'ambiguous').
  // both pages LEAD with the shared "Open Menu" chrome (+ shared "Close" / "Cart") so the greedy
  // fingerprint must grow past it; each carries distinct content to stay resolvable. ≥8 ready nodes.
  const RICH = ['RootWebArea "Products" [ref=e1]', '  button "Open Menu" [ref=e2]', '  button "Close" [ref=e2b]',
    '  button "Cart" [ref=e2c]', '  link "Backpack" [ref=e3]', '    /url: https://x.test/item',
    '  link "Bike Light" [ref=e3b]', '    /url: https://x.test/item2', '  button "Add to cart" [ref=e4]',
    '  button "Sort" [ref=e4b]'].join('\n');
  const SPARSE = ['RootWebArea "Checkout" [ref=e1]', '  button "Open Menu" [ref=e2]', '  button "Close" [ref=e2b]',
    '  button "Cart" [ref=e2c]', '  button "Continue" [ref=e3]', '  button "Cancel" [ref=e3b]',
    '  link "Info" [ref=e3c]', '    /url: https://x.test/info', '  button "Finish here" [ref=e4]'].join('\n');
  const effs: StoredActionEffect[] = [
    { seq: 0, capturedAt: 0, fromUrl: 'https://x.test/rich', fromSnapshot: RICH,
      action: { role: 'button', name: 'Go', ref: 'e4', elementFp: { role: 'button', name: 'Add to cart', near: null } },
      toUrl: 'https://x.test/sparse', toSnapshot: SPARSE, navigated: true, diff: { added: [], removed: [] } },
  ] as any;

  it('no drafted fingerprint is fully satisfied by another page', () => {
    const draft = draftFromEffects(effs);
    const rich = parseSnapshot(RICH), sparse = parseSnapshot(SPARSE);
    const nodesFor = (label: string) => (label === 'rich' ? rich : sparse);
    for (const s of draft.states) {
      for (const other of draft.states) {
        if (other.label === s.label) continue;
        const satisfiedByOther = s.fingerprint.every((t) => {
          const [role, name] = t.split(':');
          return nodesFor(other.label).some((n) => n.role === role && (name === undefined || n.name === name));
        });
        expect(satisfiedByOther, `${s.label} fp ${JSON.stringify(s.fingerprint)} must not match ${other.label}`).toBe(false);
      }
    }
    // concretely: sparse's fp must have grown past the shared "Open Menu" token
    const sparseState = draft.states.find((st) => st.label === 'sparse')!;
    expect(sparseState.fingerprint).toContain('button:Continue');
  });
});

describe('navigating commit-words (live finding: human fired Finish)', () => {
  it('a navigate whose element label is a commit word gets needsClassification', () => {
    const FROM = ['RootWebArea "Overview" [ref=e1]', '  heading "Checkout: Overview" [ref=e2]',
      '  button "Finish" [ref=e3]', '  heading "Payment Information" [ref=e4]', '  heading "Price Total" [ref=e5]',
      '  listitem "Backpack $29.99" [ref=e6]', '  paragraph "SauceCard #31337" [ref=e7]', '  button "Cancel" [ref=e8]'].join('\n');
    const TO = ['RootWebArea "Complete" [ref=e1]', '  heading "Thank you for your order!" [ref=e2]',
      '  paragraph "Your order has been dispatched" [ref=e3]', '  button "Back Home" [ref=e4]',
      '  heading "Checkout Complete!" [ref=e5]', '  paragraph "and will arrive soon" [ref=e6]',
      '  listitem "Order #12" [ref=e7]', '  paragraph "Confirmation sent" [ref=e8]'].join('\n');
    const effs = [{ seq: 0, capturedAt: 0, fromUrl: 'https://x.test/overview', fromSnapshot: FROM,
      action: { role: 'button', name: 'Finish', ref: 'e3', elementFp: { role: 'button', name: 'Finish', near: null } },
      toUrl: 'https://x.test/complete', toSnapshot: TO, navigated: true, diff: { added: [], removed: [] } }];
    const draft = draftFromEffects(effs as any);
    const overview = draft.states.find((s) => s.label === 'overview')!;
    const finish = overview.affordances.find((a) => a.kind === 'navigate' && a.label === 'Finish')!;
    expect(finish.needsClassification).toBe(true);   // a walk must NOT auto-fire this (#2)
    expect((finish as any).commit).not.toBe(true);   // candidate flag only — agent classifies (#5a)
  });
});

// ── observation-based identity (structure-inference, 2026-07-10): keying, landings, aliases,
// template merge/split, cores, naming. Replaces the old stablePathKey/-2-suffix keying. Each
// `it` pins one of the 6 rules. Landing snapshots MUST be classifyReadiness='ready' (≥8 named
// nodes + a content node), so every fixture carries a shared 5-link sidebar + a distinct heading.
const XB = 'https://x.test/v3/9999';
// a shared 5-link sidebar (present on every page → the site shell) + a page-specific heading.
const shell = (activeHeading: string, extra: string[] = []): string => [
  `- heading "${activeHeading}" [ref=e1]`,
  '- link "Home" [ref=e2]:\n    - /url: https://x.test/v3/9999/home',
  '- link "Reports" [ref=e3]:\n    - /url: https://x.test/v3/9999/report/list',
  '- link "Dashboards" [ref=e4]:\n    - /url: https://x.test/v3/9999/dashboard/list',
  '- link "Announcements" [ref=e5]:\n    - /url: https://x.test/v3/9999/announcements',
  '- link "Help Center" [ref=e6]:\n    - /url: https://x.test/v3/9999/help-center',
  ...extra,
].join('\n');
// navigated-effect helper: a page landed on via navigation (settle URL = requested URL).
const nav = (toUrl: string, toSnapshot: string, extra: Partial<StoredActionEffect> = {}): StoredActionEffect =>
  ({ seq: 0, capturedAt: 0, fromUrl: `${XB}/home`, fromSnapshot: shell('Home'),
     action: { role: 'link', name: 'x', ref: 'e9', elementFp: { role: 'link', name: 'x', near: null } },
     toUrl, toSnapshot, navigated: true, diff: { added: [], removed: [] } as any, ...extra });

describe('draftFromEffects — observation-based identity', () => {
  const LIST_SNAP = shell('Reports', ['- button "New report" [ref=e7]', '- textbox "Search reports" [ref=e8]']);
  const ANN_SNAP = shell('Announcements', ['- button "Post" [ref=e7]', '- paragraph "Latest news" [ref=e8]']);
  const HELP_SNAP = shell('Help Center', ['- textbox "Ask a question" [ref=e7]', '- button "Contact" [ref=e8]']);
  const DL_SNAP = shell('Downloads', ['- button "Download all" [ref=e7]', '- listitem "report.csv" [ref=e8]']);
  const REPORTS_SNAP = shell('Reports', ['- button "Filter" [ref=e7]', '- textbox "Search reports" [ref=e8]']);

  // RULE 1 — keying + alias: a pre-redirect ghost URL (missing the /v3/9999 tenant) is aliased
  // to the settled key via requestedUrl, so /report/list (ghost) and /v3/9999/report/list merge.
  // NO -2 suffix anywhere.
  it('merges a pre-redirect ghost via requestedUrl alias + base inference (no report-list-2)', () => {
    const effects = [
      nav(`${XB}/report/list`, LIST_SNAP),
      nav(`${XB}/announcements`, ANN_SNAP),
      nav(`${XB}/help-center`, HELP_SNAP),
      nav(`${XB}/download/list`, DL_SNAP),
      nav(`${XB}/report/list`, REPORTS_SNAP, { requestedUrl: 'https://x.test/report/list' }),
    ];
    const g = draftFromEffects(effects as never);
    const labels = g.states.map((s) => s.label);
    expect(labels).toContain('report-list');
    expect(labels.join(',')).not.toMatch(/-2\b/);
    // the ghost + the settled visit are ONE state (aliased), not two
    expect(labels.filter((l) => l === 'report-list').length).toBe(1);
  });

  // RULE 3 — propose/dispose: /report/{id} variants with near-identical faces MUST merge to one
  // templated page; /dashboard/list vs /dashboard/8001 (different faces) must NOT merge.
  it('merges same-structure param URLs (report/{id}) and does NOT merge dashboard/list vs dashboard/8001', () => {
    const REP_A = shell('Report A', ['- tab "Table" [ref=e7]', '- tab "Charts" [ref=e8]', '- button "Export" [ref=e9]']);
    const REP_B = shell('Report A', ['- tab "Table" [ref=e7]', '- tab "Charts" [ref=e8]', '- button "Export" [ref=e9]']);
    const REP_C = shell('Report A', ['- tab "Table" [ref=e7]', '- tab "Charts" [ref=e8]', '- button "Export" [ref=e9]']);
    const DASH_LIST = shell('Dashboards', ['- button "New dashboard" [ref=e7]', '- listitem "Sales" [ref=e8]']);
    const DASH_ONE = shell('Sales KPIs', ['- img "Revenue chart" [ref=e7]', '- img "Users chart" [ref=e8]']);
    const g = draftFromEffects([
      nav(`${XB}/report/7001/a`, REP_A),
      nav(`${XB}/report/7001/b`, REP_B),
      nav(`${XB}/report/7001/c`, REP_C),
      nav(`${XB}/dashboard/list`, DASH_LIST),
      nav(`${XB}/dashboard/8001`, DASH_ONE),
    ] as never);
    const labels = g.states.map((s) => s.label);
    // the three report variants collapsed into ONE templated page (label = non-{param} tail)
    expect(labels.filter((l) => l === 'report-7001').length).toBe(1);
    expect(g.states.some((s) => s.urlPattern.includes('/report/7001/'))).toBe(true);
    // dashboard/list and dashboard/8001 did NOT merge (distinct faces) — two states
    expect(labels).toContain('dashboard-list');
    expect(labels.some((l) => l === 'dashboard-1210')).toBe(true);
  });

  // RULE 4 — SPA split: two visits to ONE key with structurally different faces → two states,
  // each named by a heading token UNIQUE to its cluster; a cluster with no distinguishing
  // heading goes to needsFix.
  it('splits same-URL states by structure (SPA) using a distinguishing heading', () => {
    const OWNED = shell('Owned reports', ['- button "New report" [ref=e7]', '- listitem "My report" [ref=e8]']);
    const SHARED = shell('Shared reports', ['- button "Filter" [ref=e7]', '- listitem "Team report" [ref=e8]']);
    const g = draftFromEffects([
      nav(`${XB}/report/list`, OWNED),
      nav(`${XB}/report/list`, SHARED),
    ] as never);
    const labels = g.states.map((s) => s.label);
    // one url, two structurally-distinct landings → two split states named by unique headings
    expect(labels.some((l) => /owned/.test(l))).toBe(true);
    expect(labels.some((l) => /shared/.test(l))).toBe(true);
    expect(labels.length).toBe(2);
  });

  it('a same-url cluster with no distinguishing heading goes to needsFix', () => {
    // two landings at one key, structurally distinct (jaccard<0.5 → separate clusters) but with
    // the SAME heading "Reports" → no heading distinguishes the split → needsFix. Each landing
    // has a distinct set of listitems (no shared shell here) so the faces don't cluster together.
    const items = (prefix: string) => Array.from({ length: 8 }, (_, i) => `- listitem "${prefix} ${i}" [ref=e${i + 2}]`);
    const A = ['- heading "Reports" [ref=e1]', ...items('Alpha')].join('\n');
    const B = ['- heading "Reports" [ref=e1]', ...items('Beta')].join('\n');
    const g = draftFromEffects([
      nav(`${XB}/report/list`, A),
      nav(`${XB}/report/list`, B),
    ] as never);
    expect((g.needsFix ?? []).some((d) => /no distinguishing heading/i.test(d.reason))).toBe(true);
  });

  // RULE 2 + core (RULE 5) — a single-landing page keeps ALL its tokens as core but is marked
  // provisional (one visit = no variance signal), and that surfaces in receipt.requests.
  it('a single-landing state carries provisional and surfaces in receipt.requests', () => {
    const g = draftFromEffects([nav(`${XB}/report/list`, LIST_SNAP)] as never);
    const rep = g.states.find((s) => s.label === 'report-list')!;
    expect(rep.provisional).toBeTruthy();
    expect(g.receipt.requests.some((r) => r.startsWith('report-list'))).toBe(true);
  });

  // RULE 2 — a landing whose snapshot is NOT ready (too sparse → classifyReadiness 'loading')
  // never defines a page face, so it produces no state.
  it('a loading (unready) landing never defines a page face', () => {
    const SPARSE = ['- heading "Half rendered" [ref=e1]', '- link "Home" [ref=e2]'].join('\n'); // 2 nodes < 8
    const g = draftFromEffects([
      nav(`${XB}/report/list`, LIST_SNAP),
      nav(`${XB}/loading`, SPARSE),
    ] as never);
    const labels = g.states.map((s) => s.label);
    expect(labels).toContain('report-list');
    expect(labels.some((l) => /loading|half/.test(l))).toBe(false);   // dropped, never a state
  });
});

// ── multi-session merge: concatenated effects from several sessions of ONE site fold into
// one map because stable keying puts same-page visits in the same state. (The CLI does the
// concat; here we prove draftFromEffects merges a concatenated effects list.)
describe('draftFromEffects — multi-session merge (concatenated effects, one map)', () => {
  const home = 'https://x.test/home';
  const other = 'https://x.test/other';
  const HOME = ['RootWebArea "H" [ref=e1]', '  heading "Home" [ref=e2]',
    '  link "Other" [ref=e3]:\n    - /url: https://x.test/other', '  button "AlphaAction" [ref=e4]',
    '  paragraph "Welcome home" [ref=e6]', '  listitem "Recent item" [ref=e7]', '  button "Refresh" [ref=e8]',
    '  paragraph "Dashboard" [ref=e9]'].join('\n');
  const HOME2 = ['RootWebArea "H" [ref=e1]', '  heading "Home" [ref=e2]',
    '  link "Other" [ref=e3]:\n    - /url: https://x.test/other', '  button "BetaAction" [ref=e5]',
    '  paragraph "Welcome home" [ref=e6]', '  listitem "Recent item" [ref=e7]', '  button "Refresh" [ref=e8]',
    '  paragraph "Dashboard" [ref=e9]'].join('\n');
  const OTHER = ['RootWebArea "O" [ref=e1]', '  heading "Other Page" [ref=e2]',
    '  paragraph "This is another page" [ref=e3]', '  button "Do thing" [ref=e4]', '  listitem "Row A" [ref=e5]',
    '  listitem "Row B" [ref=e6]', '  paragraph "Details" [ref=e7]', '  button "Close" [ref=e8]'].join('\n');
  // session 1 explored Home's AlphaAction; session 2 explored Home's BetaAction + navigated to Other.
  const s1 = [{ seq: 0, capturedAt: 0, fromUrl: home, fromSnapshot: HOME, action: { role: 'button', name: 'AlphaAction', ref: 'e4', elementFp: { role: 'button', name: 'AlphaAction', near: null } }, toUrl: home, toSnapshot: HOME, navigated: false, diff: { added: [], removed: [] } }];
  const s2 = [
    { seq: 0, capturedAt: 0, fromUrl: home, fromSnapshot: HOME2, action: { role: 'button', name: 'BetaAction', ref: 'e5', elementFp: { role: 'button', name: 'BetaAction', near: null } }, toUrl: home, toSnapshot: HOME2, navigated: false, diff: { added: [], removed: [] } },
    { seq: 1, capturedAt: 0, fromUrl: home, fromSnapshot: HOME2, action: { role: 'link', name: 'Other', ref: 'e3', elementFp: { role: 'link', name: 'Other', near: null } }, toUrl: other, toSnapshot: OTHER, navigated: true, diff: { added: [], removed: [] } },
  ];
  const draft = draftFromEffects([...s1, ...s2] as any);
  const byLabel = Object.fromEntries(draft.states.map((s) => [s.label, s]));

  it('same page from two sessions → ONE merged state (home), plus the distinct other page', () => {
    expect(draft.states.length).toBe(2);   // home (merged) + other
    expect(byLabel['home']).toBeTruthy();
    expect(byLabel['other']).toBeTruthy();
  });
  it('the merged home state has affordances from BOTH sessions', () => {
    const labels = byLabel['home'].affordances.map((a) => a.label);
    expect(labels).toContain('AlphaAction');   // session 1
    expect(labels).toContain('BetaAction');    // session 2
  });
  it('a navigate edge recorded in session 2 lands correctly in the merged map', () => {
    const toOther = byLabel['home'].affordances.find((a) => a.kind === 'navigate' && a.to === 'other');
    expect(toOther).toBeTruthy();
  });
});

// ── degenerate landings → needsFix (partial success): a 404/error page and a no-distinctive-
// content (chrome-only) landing are HELD OUT of `states` so they don't poison the good states'
// fingerprints, and reported in `needsFix` for the agent to resolve. The good states still emit.
describe('draftFromEffects — degenerate landings go to needsFix, good states still emit', () => {
  const B = 'https://q.test';
  // distinct top-level sections (different first segment) so no positional /{param} template
  // groups them — each keeps its own key. Labels are the last-2 tail segments.
  const U = { home: `${B}/main/home`, reports: `${B}/data/reports`, agent: `${B}/sys/agent`, blank: `${B}/misc/blank` };
  // a shared sidebar chrome present on EVERY page (≥8 nodes) so the blank landing (chrome-only)
  // still passes readiness but has no distinctive content vs the others.
  const CHROME = [`- link "Home" [ref=e2]:\n    - /url: ${U.home}`,
    `- link "Reports" [ref=e3]:\n    - /url: ${U.reports}`,
    `- link "Agent" [ref=e4]:\n    - /url: ${U.agent}`,
    `- link "Blank" [ref=e5]:\n    - /url: ${U.blank}`,
    '- link "Settings" [ref=e6]:\n    - /url: https://q.test/cfg/settings',
    '- link "Profile" [ref=e7]:\n    - /url: https://q.test/acct/profile',
    '- button "Open Menu" [ref=e8]', '- button "Log out" [ref=e9]'];
  const HOME = ['- heading "Home" [ref=e1]', ...CHROME, '- heading "Welcome back" [ref=e10]'].join('\n');
  const REPORTS = ['- heading "Reports" [ref=e1]', ...CHROME, '- heading "Saved reports" [ref=e10]'].join('\n');
  const NOT_FOUND = ['- heading "Page not found" [ref=e1]', ...CHROME,
    '- paragraph "This page could not be found." [ref=e10]'].join('\n');
  // a blank landing: NO distinctive heading, only the shared sidebar chrome the others also have.
  const BLANK = [...CHROME].join('\n');
  const effs = [
    { seq: 0, capturedAt: 0, fromUrl: U.home, fromSnapshot: HOME, action: { role: 'link', name: 'Reports', ref: 'e2', elementFp: { role: 'link', name: 'Reports', near: null } }, toUrl: U.reports, toSnapshot: REPORTS, navigated: true, diff: { added: [], removed: [] } },
    { seq: 1, capturedAt: 0, fromUrl: U.home, fromSnapshot: HOME, action: { role: 'link', name: 'Agent', ref: 'e3', elementFp: { role: 'link', name: 'Agent', near: null } }, toUrl: U.agent, toSnapshot: NOT_FOUND, navigated: true, diff: { added: [], removed: [] } },
    { seq: 2, capturedAt: 0, fromUrl: U.home, fromSnapshot: HOME, action: { role: 'link', name: 'Blank', ref: 'e4', elementFp: { role: 'link', name: 'Blank', near: null } }, toUrl: U.blank, toSnapshot: BLANK, navigated: true, diff: { added: [], removed: [] } },
  ];
  const draft = draftFromEffects(effs as any);
  const labels = draft.states.map((s) => s.label);

  it('the 404 page is held out of states and reported in needsFix', () => {
    expect(labels).not.toContain('sys-agent');
    const nf = (draft.needsFix ?? []).find((d) => d.label === 'sys-agent');
    expect(nf).toBeTruthy();
    expect(nf!.reason).toMatch(/error page/i);
  });
  it('the blank chrome-only landing is held out too (no distinctive content)', () => {
    expect(labels).not.toContain('misc-blank');
    expect((draft.needsFix ?? []).some((d) => d.label === 'misc-blank' && /distinctive|chrome/i.test(d.reason))).toBe(true);
  });
  it('the good states (home, reports) still emit with clean unique fingerprints', () => {
    expect(labels).toContain('main-home');
    expect(labels).toContain('data-reports');
    for (const s of draft.states) expect(s._warning).toBeUndefined();   // no ambiguity poisoning
  });
  it('good states carry NO navigate affordance pointing at a degenerate (dead) target', () => {
    const home = draft.states.find((s) => s.label === 'main-home')!;
    expect(home.affordances.some((a) => a.kind === 'navigate' && (a.to === 'sys-agent' || a.to === 'misc-blank'))).toBe(false);
    expect(home.affordances.some((a) => a.kind === 'navigate' && a.to === 'data-reports')).toBe(true);   // good edge kept
  });
});

// ── site SHELL (structure-inference axis 3, Task 8): nodes present on ≥80% of the site's
// DISTINCT pages are the shared chrome (sidebar/topbar). They are stored ONCE on a synthetic
// `_shell` state (role:'shell') — NOT duplicated as navigate affordances on every page state.
// A 5-link sidebar present on 5 distinct-first-segment pages → shell fires (≥4-page gate),
// each shell link that keys to a known page becomes a `_shell` navigate; page states carry
// NO sidebar-link navigates. Spec: 2026-07-10-structure-inference-design.md (axis 3).
describe('draftFromEffects — site shell state (stored once, not per-page duplicates)', () => {
  const SB = 'https://sd.test';
  // a 5-link sidebar shared by every page + the page's own heading + page-specific content
  // (so each landing is classifyReadiness='ready' AND uniquely fingerprintable by its heading).
  const NAV = [
    `- link "Home" [ref=e2]:\n    - /url: ${SB}/main/home`,
    `- link "Downloads" [ref=e3]:\n    - /url: ${SB}/dl/list`,
    `- link "Reports" [ref=e4]:\n    - /url: ${SB}/rep/list`,
    `- link "Settings" [ref=e5]:\n    - /url: ${SB}/cfg/settings`,
    `- link "Help" [ref=e6]:\n    - /url: ${SB}/help/center`,
  ];
  const page = (heading: string, extra: string[]): string =>
    [`- heading "${heading}" [ref=e1]`, ...NAV, ...extra].join('\n');
  const HOME = page('Home', ['- heading "Welcome" [ref=e7]', '- paragraph "Recent activity" [ref=e8]']);
  const DOWNLOADS = page('Downloads', ['- button "Download all" [ref=e7]', '- listitem "report.csv" [ref=e8]']);
  const REPORTS = page('Reports', ['- button "New report" [ref=e7]', '- textbox "Search reports" [ref=e8]']);
  const SETTINGS = page('Settings', ['- textbox "Display name" [ref=e7]', '- button "Save prefs" [ref=e8]']);
  const HELP = page('Help', ['- textbox "Ask a question" [ref=e7]', '- button "Contact support" [ref=e8]']);
  const shellNav = (toUrl: string, snap: string): StoredActionEffect =>
    ({ seq: 0, capturedAt: 0, fromUrl: `${SB}/main/home`, fromSnapshot: HOME,
       action: { role: 'link', name: 'x', ref: 'e2', elementFp: { role: 'link', name: 'x', near: null } },
       toUrl, toSnapshot: snap, navigated: true, diff: { added: [], removed: [] } as any });
  const g = draftFromEffects([
    shellNav(`${SB}/main/home`, HOME),
    shellNav(`${SB}/dl/list`, DOWNLOADS),
    shellNav(`${SB}/rep/list`, REPORTS),
    shellNav(`${SB}/cfg/settings`, SETTINGS),
    shellNav(`${SB}/help/center`, HELP),
  ] as never);

  it('extracts a _shell state once; page states carry no sidebar-duplicate affordances', () => {
    const shell = g.states.find((s) => s.label === '_shell')!;
    expect(shell).toBeTruthy();
    expect(shell.role).toBe('shell');
    // the shell carries the sidebar links as navigate affordances to the known pages.
    expect(shell.affordances.some((a) => a.kind === 'navigate' && a.to === 'dl-list')).toBe(true);
    expect(shell.affordances.some((a) => a.kind === 'navigate' && a.to === 'rep-list')).toBe(true);
    // a page state must NOT re-carry the sidebar link (it lives on _shell now).
    const reports = g.states.find((s) => s.label === 'rep-list')!;
    expect(reports.affordances.filter((a) => a.kind === 'navigate' && a.to === 'dl-list')).toHaveLength(0);
    expect(reports.affordances.filter((a) => a.kind === 'navigate' && a.to === 'help-center')).toHaveLength(0);
  });

  it('_shell is excluded from hierarchy roles and from receipt.states', () => {
    const shell = g.states.find((s) => s.label === '_shell')!;
    expect(shell.role).toBe('shell');           // not hub/section/detail
    expect(shell.parentState).toBeUndefined();  // never placed in the tree
    expect(g.receipt.states).not.toContain('_shell');
    // the real pages ARE in the receipt
    expect(g.receipt.states).toContain('rep-list');
  });
});

// ── alias-aware mesh (Task 8 controller): a page's declared sidebar link href can differ from
// the URL the walk actually SETTLED at (a redirect). The mesh must resolve the link href through
// key() (base-strip + alias) — NOT raw sameTarget — so the synthesized edge still lands on the
// right state. This isolates the rk≠sk alias path Task 7 left untested: the link href would NOT
// merge by base-strip alone; only the requestedUrl→settled alias closes the gap.
describe('draftFromEffects — mesh resolves an alias (redirect: href ≠ landed URL)', () => {
  const AB = 'https://a.test';
  // every landing settled under /dashboard/index (aliased FROM /auth/login via requestedUrl),
  // but the page's own sidebar link to the dashboard is href="/auth/login" (the pre-redirect
  // ghost). Distinct first segments elsewhere so nothing ELSE templates together.
  const linkTo = (href: string, label: string, ref: string) => `- link "${label}" [ref=${ref}]:\n    - /url: ${href}`;
  const SB2 = [
    linkTo(`${AB}/auth/login`, 'Dashboard', 'e2'),   // href is the pre-redirect ghost, NOT the settled url
    linkTo(`${AB}/pim/list`, 'People', 'e3'),
    linkTo(`${AB}/leave/list`, 'Leave', 'e4'),
    linkTo(`${AB}/time/list`, 'Time', 'e5'),
  ];
  const pg = (h: string, extra: string[]) => [`- heading "${h}" [ref=e1]`, ...SB2, ...extra].join('\n');
  const DASH = pg('Dashboard', ['- heading "My Actions" [ref=e7]', '- paragraph "Time at work" [ref=e8]', '- listitem "Pending review" [ref=e9]']);
  const PEOPLE = pg('People', ['- button "Add employee" [ref=e7]', '- listitem "Jane Doe" [ref=e8]', '- paragraph "43 records" [ref=e9]']);
  const LEAVE = pg('Leave', ['- button "Apply leave" [ref=e7]', '- listitem "Pending" [ref=e8]', '- paragraph "Balance 12d" [ref=e9]']);
  const TIME = pg('Time', ['- button "Punch in" [ref=e7]', '- listitem "Today" [ref=e8]', '- paragraph "This week" [ref=e9]']);
  // dashboard was REQUESTED at /auth/login but SETTLED at /dashboard/index → alias auth/login→dashboard/index.
  const dashEff: StoredActionEffect = { seq: 0, capturedAt: 0, fromUrl: `${AB}/pim/list`, fromSnapshot: PEOPLE,
    action: { role: 'link', name: 'Dashboard', ref: 'e2', elementFp: { role: 'link', name: 'Dashboard', near: null } },
    requestedUrl: `${AB}/auth/login`, toUrl: `${AB}/dashboard/index`, toSnapshot: DASH, navigated: true, diff: { added: [], removed: [] } as any };
  const other = (from: string, fromSnap: string, toUrl: string, toSnap: string): StoredActionEffect =>
    ({ seq: 0, capturedAt: 0, fromUrl: from, fromSnapshot: fromSnap,
       action: { role: 'link', name: 'x', ref: 'e3', elementFp: { role: 'link', name: 'x', near: null } },
       toUrl, toSnapshot: toSnap, navigated: true, diff: { added: [], removed: [] } as any });
  const g = draftFromEffects([
    dashEff,
    other(`${AB}/dashboard/index`, DASH, `${AB}/pim/list`, PEOPLE),
    other(`${AB}/dashboard/index`, DASH, `${AB}/leave/list`, LEAVE),
    other(`${AB}/dashboard/index`, DASH, `${AB}/time/list`, TIME),
  ] as never);

  it('a sidebar link href=/auth/login resolves to the settled dashboard-index state via alias', () => {
    // sanity: the settled state exists under its settled label, NOT under an auth-login label.
    const labels = g.states.map((s) => s.label);
    expect(labels).toContain('dashboard-index');
    expect(labels).not.toContain('auth-login');
    // the People page's OWN sidebar link (href=/auth/login) must mesh to dashboard-index —
    // sameTarget on the raw href would look for a /auth/login page and find nothing.
    const shell = g.states.find((s) => s.label === '_shell');
    const carrier = shell ?? g.states.find((s) => s.label === 'pim-list')!;
    const edge = carrier.affordances.find((a) => a.kind === 'navigate' && a.to === 'dashboard-index');
    expect(edge, 'alias-resolved edge to dashboard-index').toBeTruthy();
    expect(edge!.elementFp).toEqual({ role: 'link', name: 'Dashboard', near: null });
  });
});

// ── shell-based hierarchy (Task 8 rule 4): a page reached by a SHELL link is a top-level
// section; a page reached only by a CONTENT (non-shell) drill-in link is a detail with that
// page as parent. isSidebarLink(label) = shell.has('link:'+label) || /logo|home/. Replaces the
// old ≥60%-of-pages recount.
describe('draftFromEffects — shell-based hierarchy (sections vs details)', () => {
  const HB = 'https://h.test';
  // 4 shell pages (a shared 4-link sidebar) so shell fires; the Reports page carries an EXTRA
  // content link to a detail page NOT in the sidebar → that detail is a `detail` under reports.
  const NAV = [
    `- link "Home" [ref=e2]:\n    - /url: ${HB}/main/home`,
    `- link "Reports" [ref=e3]:\n    - /url: ${HB}/rep/list`,
    `- link "People" [ref=e4]:\n    - /url: ${HB}/ppl/list`,
    `- link "Settings" [ref=e5]:\n    - /url: ${HB}/cfg/index`,
  ];
  const pg = (h: string, extra: string[]) => [`- heading "${h}" [ref=e1]`, ...NAV, ...extra].join('\n');
  const HOME = pg('Home', ['- heading "Welcome" [ref=e7]', '- paragraph "Overview" [ref=e8]', '- listitem "Recent" [ref=e9]']);
  const PEOPLE = pg('People', ['- button "Add person" [ref=e7]', '- listitem "Someone" [ref=e8]', '- paragraph "Roster" [ref=e9]']);
  const SETTINGS = pg('Settings', ['- textbox "Name" [ref=e7]', '- button "Save it" [ref=e8]', '- paragraph "Prefs" [ref=e9]']);
  // Reports has a CONTENT link (NOT in the sidebar) to a specific report detail page.
  const REPORTS = pg('Reports', ['- button "New report" [ref=e7]',
    `- link "Q3 revenue report" [ref=e8]:\n    - /url: ${HB}/rep/9001`, '- paragraph "Saved reports" [ref=e9]']);
  const DETAIL = pg('Q3 revenue report', ['- tab "Table" [ref=e7]', '- button "Export it" [ref=e8]', '- paragraph "Rendered" [ref=e9]']);
  const hnav = (from: string, fromSnap: string, toUrl: string, toSnap: string, name = 'x', ref = 'e2'): StoredActionEffect =>
    ({ seq: 0, capturedAt: 0, fromUrl: from, fromSnapshot: fromSnap,
       action: { role: 'link', name, ref, elementFp: { role: 'link', name, near: null } },
       toUrl, toSnapshot: toSnap, navigated: true, diff: { added: [], removed: [] } as any });
  const g = draftFromEffects([
    // the recorded clicks are the SHELL links (their action.name = the sidebar link name), so
    // isSidebarLink recognizes them — a real sidebar click records the link's accessible name.
    hnav(`${HB}/main/home`, HOME, `${HB}/main/home`, HOME, 'Home', 'e2'),
    hnav(`${HB}/main/home`, HOME, `${HB}/rep/list`, REPORTS, 'Reports', 'e3'),
    hnav(`${HB}/main/home`, HOME, `${HB}/ppl/list`, PEOPLE, 'People', 'e4'),
    hnav(`${HB}/main/home`, HOME, `${HB}/cfg/index`, SETTINGS, 'Settings', 'e5'),
    // drill IN from Reports to a specific report via a content link (never in the sidebar).
    hnav(`${HB}/rep/list`, REPORTS, `${HB}/rep/9001`, DETAIL, 'Q3 revenue report', 'e8'),
  ] as never);

  it('shell-linked pages are sections; a content-linked page is a detail of its parent', () => {
    const reports = g.states.find((s) => s.label === 'rep-list')!;
    const people = g.states.find((s) => s.label === 'ppl-list')!;
    expect(reports.role).toBe('section');       // reached by the sidebar (shell) link
    expect(reports.parentState).toBeNull();
    expect(people.role).toBe('section');
    const detail = g.states.find((s) => s.label === 'rep-9001')!;
    expect(detail.role).toBe('detail');          // reached only by a content link ON reports
    expect(detail.parentState).toBe('rep-list');
  });
});

// ── shell-subtracted structural similarity (over-merge guard, mutation-proven gap): the dispose
// check and the SPA-split clustering MUST compare faces with the shell removed. This fixture is
// tuned so RAW-face jaccard is ≥0.5 (9 shared chrome tokens vs 4 distinct tokens per page →
// 9/17 ≈ 0.529 — they'd falsely merge/collapse on raw faces) while shell-subtracted jaccard is 0
// (fully distinct content → they stay separate). Reverting minusShell to raw faceOf in either
// site makes these tests fail (verified by mutation before commit).
describe('draftFromEffects — dispose + SPA split run on SHELL-SUBTRACTED faces', () => {
  const MB = 'https://m.test';
  // 9-token chrome (6 links + 3 buttons) on EVERY page — heavy enough to push raw jaccard over
  // the 0.5 merge threshold between any two pages. 5 distinct keys → extractShell fires (≥4).
  const CHROME = [
    `- link "Home" [ref=e2]:\n    - /url: ${MB}/main/home`,
    `- link "Settings" [ref=e3]:\n    - /url: ${MB}/cfg/settings`,
    `- link "Items" [ref=e4]:\n    - /url: ${MB}/item/list`,
    `- link "Views" [ref=e5]:\n    - /url: ${MB}/spa/view`,
    `- link "Docs" [ref=e6]:\n    - /url: ${MB}/ext/docs`,
    `- link "Support" [ref=e7]:\n    - /url: ${MB}/ext/support`,
    '- button "Open Menu" [ref=e8]', '- button "Log out" [ref=e9]', '- button "Toggle theme" [ref=e10]',
  ];
  const pg = (h: string, extra: string[]) => [`- heading "${h}" [ref=e1]`, ...CHROME, ...extra].join('\n');
  const HOME = pg('Home', ['- paragraph "Welcome" [ref=e11]', '- listitem "Recent" [ref=e12]', '- paragraph "Overview" [ref=e13]']);
  const SETTINGS = pg('Settings', ['- textbox "Display name" [ref=e11]', '- button "Save prefs" [ref=e12]', '- paragraph "Preferences" [ref=e13]']);
  // two pages under ONE /{param} template (/item/list vs /item/9001), structurally DISTINCT:
  const ITEM_LIST = pg('All items', ['- button "New item" [ref=e11]', '- listitem "Row one" [ref=e12]', '- paragraph "Sorted by date" [ref=e13]']);
  const ITEM_DETAIL = pg('Item detail', ['- tab "Overview" [ref=e11]', '- button "Archive it" [ref=e12]', '- paragraph "Metadata" [ref=e13]']);
  // two landings at ONE key (/spa/view), structurally distinct — the SPA-split case:
  const SPA_OWNED = pg('Owned things', ['- button "New thing" [ref=e11]', '- listitem "Mine" [ref=e12]', '- paragraph "Owner view" [ref=e13]']);
  const SPA_SHARED = pg('Shared things', ['- button "Ask access" [ref=e11]', '- listitem "Theirs" [ref=e12]', '- paragraph "Shared view" [ref=e13]']);
  const mnav = (toUrl: string, toSnap: string): StoredActionEffect =>
    ({ seq: 0, capturedAt: 0, fromUrl: `${MB}/main/home`, fromSnapshot: HOME,
       action: { role: 'link', name: 'x', ref: 'e2', elementFp: { role: 'link', name: 'x', near: null } },
       toUrl, toSnapshot: toSnap, navigated: true, diff: { added: [], removed: [] } as any });
  const g = draftFromEffects([
    mnav(`${MB}/cfg/settings`, SETTINGS),
    mnav(`${MB}/item/list`, ITEM_LIST),
    mnav(`${MB}/item/9001`, ITEM_DETAIL),
    mnav(`${MB}/spa/view`, SPA_OWNED),
    mnav(`${MB}/spa/view`, SPA_SHARED),
  ] as never);
  const labels = g.states.map((s) => s.label);

  it('dispose: chrome-heavy /{param} pages with distinct content stay SEPARATE states', () => {
    // raw faces would merge (jaccard 9/17 ≈ 0.529 ≥ 0.5) into one templated 'item' state;
    // shell-subtracted faces (jaccard 0) must dispose the merge — two states survive.
    expect(labels).toContain('item-list');
    expect(labels).toContain('item-9001');
    expect(labels).not.toContain('item');   // the false template merge must NOT happen
  });

  it('SPA split: chrome-heavy same-URL landings with distinct content still split', () => {
    // raw faces would cluster together (0.529 ≥ 0.5) into one 'spa-view' state; shell-subtracted
    // clustering keeps them apart, each named by its distinguishing heading.
    expect(labels.some((l) => /owned/.test(l))).toBe(true);
    expect(labels.some((l) => /shared/.test(l))).toBe(true);
    expect(labels).not.toContain('spa-view');   // the false single-cluster collapse must NOT happen
  });
});
