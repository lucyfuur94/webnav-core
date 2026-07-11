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
    // the three report variants collapsed into ONE templated page. Label = the MEANINGFUL tail
    // (opaque id segments `7001`/`{param}` dropped) → `report`, never a raw record id.
    expect(labels.filter((l) => l === 'report').length).toBe(1);
    expect(g.states.some((s) => s.urlPattern.includes('/report/7001/'))).toBe(true);
    // dashboard/list and dashboard/8001 did NOT merge (distinct faces). list stays a state; the
    // single-instance /dashboard/8001 (heading-only `Sales KPIs` fingerprint on an opaque-id tail)
    // is held out to needsFix — its identity may be instance data — so it did NOT fold into list.
    expect(labels).toContain('dashboard-list');
    expect((g.needsFix ?? []).some((n) => n.urlPattern.includes('/dashboard/8001'))).toBe(true);
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

// ── Task 10: fingerprints + shadow from the template CORE; requests carry the notes.
// The core (templateCore over the landing faces, minus shell) is the durable structure; a token
// that varies across landings is DATA and must never anchor identity. These pin: (1) a big
// heading that differs per instance falls OUT of the fingerprint; (1b) a param page whose only
// durable token is a heading gets the "may be instance data" warning; (3) that warning flows into
// receipt.requests.
describe('draftFromEffects — core-derived fingerprints (Task 10 rule 1)', () => {
  // Two visits to ONE parameterized dashboard: SAME skeleton (sidebar + Widgets/Export),
  // DIFFERENT big heading (a per-instance title: "Demo User dashboard" vs "Q3 Board"). The
  // heading VARIES → falls out of core → must not appear in the fingerprint.
  const dashLanding = (heading: string) => shell(heading, [
    '- button "Add widget" [ref=e7]', '- button "Export" [ref=e8]', '- listitem "Widget A" [ref=e9]',
  ]);
  it('a big heading that differs per instance is NOT in the fingerprint (no instance-data identity)', () => {
    // /dashboard/7 and /dashboard/8 merge to /dashboard/{param}; the differing heading is data.
    const g = draftFromEffects([
      nav(`${XB}/dashboard/7`, dashLanding('Demo User dashboard')),
      nav(`${XB}/dashboard/8`, dashLanding('Q3 Board')),
      // 3 more distinct pages so the shared sidebar registers as shell (≥4-page gate).
      nav(`${XB}/announcements`, shell('Announcements', ['- button "Post" [ref=e7]', '- paragraph "News" [ref=e8]'])),
      nav(`${XB}/help-center`, shell('Help Center', ['- textbox "Ask" [ref=e7]', '- button "Contact" [ref=e8]'])),
      nav(`${XB}/download/list`, shell('Downloads', ['- button "Download all" [ref=e7]', '- listitem "a.csv" [ref=e8]'])),
    ] as never);
    const dash = g.states.find((s) => /dashboard/.test(s.label))!;
    expect(dash).toBeTruthy();
    // the fingerprint contains NEITHER varying heading — they fell out of core by variance.
    expect(dash.fingerprint.join()).not.toContain('Demo User');
    expect(dash.fingerprint.join()).not.toContain('Q3 Board');
    // and it still resolves to a real durable token (Add widget / Export are core).
    expect(dash.fingerprint.every((t) => !t.startsWith('heading:'))).toBe(true);
  });

  it('param page whose only durable non-shell token is a heading gets the instance-data warning', () => {
    // two param instances (/employee/7, /employee/8) merge to /employee/{param}: their ONLY
    // non-shell content is a per-instance heading (everything else — the sidebar + a Save/Refresh
    // control set present on EVERY page — is shell). So each instance's shell-subtracted face is
    // just {heading:Employee Profile} → they merge (jaccard 1.0), and the core is heading-only.
    // A heading-only fingerprint on a {param} page ⇒ that heading may be instance DATA ⇒ warn.
    const common = ['- button "Save" [ref=e6b]', '- button "Refresh" [ref=e6c]'];   // on every page → shell
    const g = draftFromEffects([
      nav(`${XB}/employee/7`, shell('Employee Profile', common)),
      nav(`${XB}/employee/8`, shell('Employee Profile', common)),
      nav(`${XB}/announcements`, shell('Announcements', common)),
      nav(`${XB}/help-center`, shell('Help Center', common)),
      nav(`${XB}/download/list`, shell('Downloads', common)),
    ] as never);
    const emp = g.states.find((s) => /employee/.test(s.label))!;
    expect(emp).toBeTruthy();
    // fingerprint is heading-only (all other content is shell → subtracted; only heading:Employee Profile core)
    expect(emp.fingerprint).toEqual(['heading:Employee Profile']);
    // rule 1: the provisional note warns the identity rests on a possibly-instance heading.
    expect(emp.provisional).toContain('identity rests on a heading that may be instance data');
    // rule 3: it flows into receipt.requests.
    expect(g.receipt.requests.some((r) => r.includes('identity rests on a heading that may be instance data'))).toBe(true);
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
  it('NO navigate affordance (on any state OR the shell) points at a degenerate (dead) target', () => {
    // Reports/Agent/Blank live in the shared sidebar CHROME → they are from-anywhere SHELL edges
    // (axis 3), so the good `→ data-reports` edge lives on `_shell`, not duplicated onto `main-home`.
    // What matters for this test: no edge ANYWHERE points at a held-out (degenerate) page, and the
    // good edge is still reachable (shell synthesis already drops dead shell links).
    const allNav = draft.states.flatMap((s) => s.affordances.filter((a) => a.kind === 'navigate'));
    expect(allNav.some((a) => a.to === 'sys-agent' || a.to === 'misc-blank')).toBe(false);   // no dead edge
    expect(allNav.some((a) => a.to === 'data-reports')).toBe(true);                          // good edge kept
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
    const detail = g.states.find((s) => s.label === 'rep')!;   // /rep/9001 → opaque id dropped → `rep`
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
    // raw faces would merge (jaccard 9/17 ≈ 0.529 ≥ 0.5) into one templated state; shell-subtracted
    // faces (jaccard 0) must dispose the merge — TWO distinct states survive. (/item/9001's label is
    // `item` — opaque id dropped; the point is it stays SEPARATE from item-list, not merged into it.)
    expect(labels).toContain('item-list');
    expect(labels).toContain('item');
    const itemStates = g.states.filter((s) => s.label === 'item-list' || s.label === 'item');
    expect(new Set(itemStates.map((s) => s.urlPattern)).size).toBe(2);   // two distinct pages, not one merge
  });

  it('SPA split: chrome-heavy same-URL landings with distinct content still split', () => {
    // raw faces would cluster together (0.529 ≥ 0.5) into one 'spa-view' state; shell-subtracted
    // clustering keeps them apart, each named by its distinguishing heading.
    expect(labels.some((l) => /owned/.test(l))).toBe(true);
    expect(labels.some((l) => /shared/.test(l))).toBe(true);
    expect(labels).not.toContain('spa-view');   // the false single-cluster collapse must NOT happen
  });
});

// ── Task 9 (structure-inference): affordance synthesis stops storing DATA VALUES. Five rules:
//  1. a recorded click on a node INSIDE an overlay (its FROM snapshot has it under a dialog/menu)
//     emits NO page affordance — its structure already lives as the opener's children.
//  2. reveal children drop the overlay's enumerated value domain (subtreeFolds + the retained
//     overlay-scoped enumeratedNames) while keeping unique overlay controls (Search/Apply/Cancel).
//  3. interior synthesis reads a page's CORE nodes only (not the union of every landing) and skips
//     subtree-folded member names — a value seen in one landing does not synthesize.
//  4. ≥3 same-shape varying-name leaf controls fold (subtreeFolds abstracted level) to ONE
//     scope:'row' affordance labeled by the common trailing word, elementFp:null (informational).
//  5. a recorded `use type` on a textbox INSIDE an overlay (a picker search box) emits NO page
//     input affordance either.
describe('draftFromEffects — Task 9 overlay gate + folded row templates + core-only interior', () => {
  const RB = 'https://rpt.test';
  // a READY entry page with a distinct first segment so the URL model doesn't strip `report` as base.
  const AUTH = ['- heading "Login" [ref=e1]', '- textbox "Username" [ref=e2]', '- textbox "Password" [ref=e3]',
    '- button "Login" [ref=e4]', '- paragraph "Sign in" [ref=e5]', '- link "Forgot" [ref=e6]:\n    - /url: https://rpt.test/auth/forgot',
    '- paragraph "Co" [ref=e7]', '- paragraph "v1" [ref=e8]'].join('\n');
  // the report page: page-level durable actions (Add dimensions opener, Share, Run, Download) +
  // padding to ≥8 ready nodes. NO value chips here (that's what mutation-afters used to leak in).
  const REPORT = [
    '- heading "Report Builder" [ref=e1]',
    '- button "Add dimensions" [ref=e2]',
    '- button "Share" [ref=e3]',
    '- button "Run" [ref=e4]',
    '- button "Download" [ref=e5]',
    '- paragraph "Draft report" [ref=e6]',
    '- listitem "Row 1" [ref=e7]',
    '- listitem "Row 2" [ref=e8]',
  ].join('\n');
  // after clicking "Add dimensions": a dialog opens with its own controls (Search/Apply/Cancel) +
  // an enumerated value list of dimension checkboxes sharing the trailing word "dimension".
  const DIM_CHECKS = [
    '  - checkbox "Publisher dimension" [ref=e11]',
    '  - checkbox "Country dimension" [ref=e12]',
    '  - checkbox "Device dimension" [ref=e13]',
    '  - checkbox "Browser dimension" [ref=e14]',
  ];
  const REPORT_DIALOG = [
    REPORT,
    '- dialog "Choose dimensions" [ref=e10]:',
    '  - textbox "Search" [ref=e15]',
    ...DIM_CHECKS,
    '  - button "Apply" [ref=e16]',
    '  - button "Cancel" [ref=e17]',
  ].join('\n');
  // diff.added for the "Add dimensions" click = the dialog's contents (parsed SnapNodes carry depth).
  const dialogAdded = parseSnapshot([
    '- textbox "Search" [ref=e15]',
    ...DIM_CHECKS.map((l) => l.replace(/^  /, '')),
    '- button "Apply" [ref=e16]',
    '- button "Cancel" [ref=e17]',
  ].join('\n')).map((n) => ({ ...n, depth: 2 }));

  const enter: StoredActionEffect = { seq: 0, capturedAt: 0, fromUrl: `${RB}/auth/login`, fromSnapshot: AUTH,
    action: { role: 'button', name: 'Login', ref: 'e4', elementFp: { role: 'button', name: 'Login', near: null } },
    toUrl: `${RB}/report/9`, toSnapshot: REPORT, navigated: true, diff: { added: [], removed: [] } as any };
  // the opener click: from the plain report page → dialog appears (diff.added = dialog contents).
  const openDialog: StoredActionEffect = { seq: 1, capturedAt: 0, fromUrl: `${RB}/report/9`, fromSnapshot: REPORT,
    action: { role: 'button', name: 'Add dimensions', ref: 'e2', elementFp: { role: 'button', name: 'Add dimensions', near: null } },
    toUrl: `${RB}/report/9`, toSnapshot: REPORT_DIALOG, navigated: false, diff: { added: dialogAdded, removed: [] } as any };
  // a click on a value checkbox INSIDE the open dialog (FROM = REPORT_DIALOG, so it's insideOverlay).
  const clickInside: StoredActionEffect = { seq: 2, capturedAt: 0, fromUrl: `${RB}/report/9`, fromSnapshot: REPORT_DIALOG,
    action: { role: 'checkbox', name: 'Publisher dimension', ref: 'e11', elementFp: { role: 'checkbox', name: 'Publisher dimension', near: null } },
    toUrl: `${RB}/report/9`, toSnapshot: REPORT_DIALOG, navigated: false, diff: { added: [], removed: [] } as any };
  // a `use type` in the dialog's search box (FROM = REPORT_DIALOG, so the textbox is insideOverlay).
  const typeInside: StoredActionEffect = { seq: 3, capturedAt: 0, fromUrl: `${RB}/report/9`, fromSnapshot: REPORT_DIALOG,
    action: { role: 'textbox', name: 'Search', ref: 'e15', elementFp: { role: 'textbox', name: 'Search', near: null } },
    toUrl: `${RB}/report/9`, toSnapshot: REPORT_DIALOG, navigated: false, diff: { added: [], removed: [] } as any };

  it('RULE 1: a click on an option inside a dialog does not become a page affordance', () => {
    const g = draftFromEffects([enter, openDialog, clickInside] as never);
    const s = g.states.find((x) => x.label === 'report')!;
    // rule 1: the checkbox click inside the dialog is NOT a page affordance.
    expect(s.affordances.some((a) => a.label === 'Publisher dimension')).toBe(false);
    // the opener IS a reveal with its overlay controls (Share/Run/Download all still emit too).
    const opener = s.affordances.find((a) => a.label === 'Add dimensions')!;
    expect(opener.kind).toBe('reveal');
    expect((opener.children ?? []).some((c) => c.label === 'Apply')).toBe(true);   // overlay control kept
    // page-level durable actions survive.
    for (const label of ['Share', 'Run', 'Download']) {
      expect(s.affordances.some((a) => a.label === label), label).toBe(true);
    }
  });

  it('RULE 2: reveal children drop the enumerated value list but keep unique overlay controls', () => {
    const g = draftFromEffects([enter, openDialog] as never);
    const s = g.states.find((x) => x.label === 'report')!;
    const opener = s.affordances.find((a) => a.label === 'Add dimensions')!;
    const childLabels = (opener.children ?? []).map((c) => c.label).sort();
    // the 4 "<X> dimension" checkboxes fold OUT (foldedNames); Search/Apply/Cancel stay.
    expect(childLabels).toEqual(['Apply', 'Cancel', 'Search']);
    for (const chip of ['Publisher dimension', 'Country dimension', 'Device dimension', 'Browser dimension']) {
      expect(childLabels).not.toContain(chip);
    }
  });

  it('RULE 5: a use-type in a dialog search box does not become a page input affordance', () => {
    const g = draftFromEffects([enter, openDialog, typeInside] as never);
    const s = g.states.find((x) => x.label === 'report')!;
    expect(s.affordances.some((a) => a.kind === 'input' && a.label === 'Search')).toBe(false);
  });

  it('RULE 4: ≥3 "<X> Remove" leaf chips in a page core fold to ONE scope:row affordance labeled Remove', () => {
    // a report page whose CORE carries the row-scoped remove chips (seen on BOTH landings so they
    // survive templateCore) — subtreeFolds folds these same-shape (L2 `button()`), varying-name
    // (distinct L1) leaf siblings at the ABSTRACTED level, label = their common trailing word
    // 'Remove', unitSize 1 → scope:'row'. A genuinely DIFFERENT-shaped control (a textbox — a
    // distinct L2 sig) does NOT fold with them and still synthesizes as its own affordance.
    const CORE_REPORT = (extra: string[]) => [
      '- heading "Metric Report" [ref=e1]',
      '- button "OS Remove" [ref=e2]',
      '- button "Revenue Remove" [ref=e3]',
      '- button "Win Rate Remove" [ref=e4]',
      '- button "eCPM Remove" [ref=e5]',
      '- textbox "Metric filter" [ref=e6]',
      '- paragraph "Report body" [ref=e7]',
      ...extra,
    ].join('\n');
    const A = CORE_REPORT(['- listitem "Line A" [ref=e8]']);
    const B2 = CORE_REPORT(['- listitem "Line B" [ref=e8]']);
    const authEnter: StoredActionEffect = { seq: 0, capturedAt: 0, fromUrl: `${RB}/auth/login`, fromSnapshot: AUTH,
      action: { role: 'button', name: 'Login', ref: 'e4', elementFp: { role: 'button', name: 'Login', near: null } },
      toUrl: `${RB}/metric/7`, toSnapshot: A, navigated: true, diff: { added: [], removed: [] } as any };
    const revisit: StoredActionEffect = { seq: 1, capturedAt: 0, fromUrl: `${RB}/metric/7`, fromSnapshot: A,
      action: { role: 'textbox', name: 'Metric filter', ref: 'e6', elementFp: { role: 'textbox', name: 'Metric filter', near: null } },
      toUrl: `${RB}/metric/7`, toSnapshot: B2, navigated: true, diff: { added: [], removed: [] } as any };
    const g = draftFromEffects([authEnter, revisit] as never);
    const s = g.states.find((x) => x.label === 'metric')!;   // /metric/7 → opaque id dropped → `metric`
    // no per-value chip is stored as its own affordance.
    for (const chip of ['OS Remove', 'Revenue Remove', 'Win Rate Remove', 'eCPM Remove']) {
      expect(s.affordances.some((a) => a.label === chip), chip).toBe(false);
    }
    // exactly one scope:'row' affordance, labeled by the shared suffix, no elementFp (informational).
    const rows = s.affordances.filter((a) => a.scope === 'row');
    expect(rows.length).toBe(1);
    expect(rows[0].label).toBe('Remove');
    expect(rows[0].kind).toBe('mutate');
    expect(rows[0].elementFp ?? null).toBeNull();
    // the genuinely-unique (different-shaped) control still synthesizes.
    expect(s.affordances.some((a) => a.label === 'Metric filter')).toBe(true);
  });

  // REGRESSION-LOCK (Task 2 review Minor): the isTemplateFold role-fallback branch. A page toolbar
  // of ≥3 SAME-ROLE, DISTINCT-PURPOSE buttons (Search / Filter / Sort — no shared trailing word)
  // is NOT a repeated template — it is three real, distinct controls. subtreeFolds abstracted-folds
  // them by pure L2 shape (all `button()`), but commonTrailingWords yields '' (no shared suffix) so
  // the fold label falls back to the member role `button`; isTemplateFold's LAST line
  // (`!memberRoles.has(fold.label)`) rejects it as a plain toolbar. All three must survive UNFOLDED
  // as their own affordances. PINNED so DELETING that guard line refolds them away and this fails.
  it('REGRESSION: a toolbar of 3 same-role distinct-purpose buttons (Search/Filter/Sort) survives unfolded', () => {
    const TOOLBAR = (extra: string[]) => [
      '- heading "Metric Report" [ref=e1]',
      '- button "Search" [ref=e2]',
      '- button "Filter" [ref=e3]',
      '- button "Sort" [ref=e4]',
      '- paragraph "Report body" [ref=e5]',
      '- listitem "Row static" [ref=e6]',
      '- textbox "Metric filter" [ref=e9]',   // padding to ≥8 named nodes (classifyReadiness gate)
      '- paragraph "Report footer" [ref=e10]',
      ...extra,
    ].join('\n');
    const A = TOOLBAR(['- listitem "Line A" [ref=e7]']);
    const B2 = TOOLBAR(['- listitem "Line B" [ref=e7]']);
    const authEnter: StoredActionEffect = { seq: 0, capturedAt: 0, fromUrl: `${RB}/auth/login`, fromSnapshot: AUTH,
      action: { role: 'button', name: 'Login', ref: 'e4', elementFp: { role: 'button', name: 'Login', near: null } },
      toUrl: `${RB}/metric/7`, toSnapshot: A, navigated: true, diff: { added: [], removed: [] } as any };
    const revisit: StoredActionEffect = { seq: 1, capturedAt: 0, fromUrl: `${RB}/metric/7`, fromSnapshot: A,
      action: null, toUrl: `${RB}/metric/7`, toSnapshot: B2, navigated: true, diff: { added: [], removed: [] } as any };
    const g = draftFromEffects([authEnter, revisit] as never);
    const s = g.states.find((x) => x.label === 'metric')!;
    // no fold swallowed them: all three toolbar buttons are present as their own affordances.
    for (const btn of ['Search', 'Filter', 'Sort']) {
      expect(s.affordances.some((a) => a.label === btn && !a.scope), btn).toBe(true);
    }
    // and NO fold-scoped (row/widget) affordance appeared for this toolbar.
    expect(s.affordances.some((a) => a.scope)).toBe(false);
  });

  it('overlay gate matches ROLE+NAME: a page-level heading "Search" cannot shadow the dialog textbox "Search"', () => {
    // review fix: nodeIndexByName(first match) read the page heading (not in overlay) → gate false
    // → the picker's search box leaked as a page input. Role+name matching finds the textbox.
    const PAGE = [
      '- heading "Search" [ref=e1]',            // page-level SAME NAME, different role, depth 0
      '- button "New query" [ref=e2]',
      '- paragraph "Saved searches" [ref=e3]',
      '- listitem "Query A" [ref=e4]',
      '- listitem "Query B" [ref=e5]',
      '- paragraph "Body" [ref=e6]',
      '- listitem "Query C" [ref=e7]',
      '- paragraph "Footer" [ref=e8]',
    ].join('\n');
    const PAGE_DIALOG = [PAGE, '- dialog "Pick" [ref=e10]:', '  - textbox "Search" [ref=e11]', '  - button "Apply" [ref=e12]'].join('\n');
    const enter2: StoredActionEffect = { seq: 0, capturedAt: 0, fromUrl: `${RB}/auth/login`, fromSnapshot: AUTH,
      action: { role: 'button', name: 'Login', ref: 'e4', elementFp: { role: 'button', name: 'Login', near: null } },
      toUrl: `${RB}/qry/1`, toSnapshot: PAGE, navigated: true, diff: { added: [], removed: [] } as any };
    const typeInDialog: StoredActionEffect = { seq: 1, capturedAt: 0, fromUrl: `${RB}/qry/1`, fromSnapshot: PAGE_DIALOG,
      action: { role: 'textbox', name: 'Search', ref: 'e11', elementFp: { role: 'textbox', name: 'Search', near: null } },
      toUrl: `${RB}/qry/1`, toSnapshot: PAGE_DIALOG, navigated: false, diff: { added: [], removed: [] } as any };
    const g = draftFromEffects([enter2, typeInDialog] as never);
    const s = g.states.find((x) => x.label === 'qry')!;
    expect(s.affordances.some((a) => a.kind === 'input' && a.label === 'Search')).toBe(false);
  });

  it('legit-double: same role+name page-level AND in-overlay → exactly ONE page affordance (not zero, not two)', () => {
    // the flip side of preferring the overlay member: gating the recorded click loses nothing,
    // because the page-level twin is in coreNodes and interior synthesis re-adds it (dedup holds).
    const PAGE = [
      '- heading "Records" [ref=e1]',
      '- button "Filter" [ref=e2]',             // page-level control
      '- button "Export" [ref=e3]',
      '- paragraph "All records" [ref=e4]',
      '- listitem "Row 1" [ref=e5]',
      '- listitem "Row 2" [ref=e6]',
      '- paragraph "Body" [ref=e7]',
      '- paragraph "Footer" [ref=e8]',
    ].join('\n');
    const PAGE_DIALOG = [PAGE, '- dialog "Options" [ref=e10]:', '  - button "Filter" [ref=e11]', '  - button "Close" [ref=e12]'].join('\n');
    const enter2: StoredActionEffect = { seq: 0, capturedAt: 0, fromUrl: `${RB}/auth/login`, fromSnapshot: AUTH,
      action: { role: 'button', name: 'Login', ref: 'e4', elementFp: { role: 'button', name: 'Login', near: null } },
      toUrl: `${RB}/rec/2`, toSnapshot: PAGE, navigated: true, diff: { added: [], removed: [] } as any };
    const clickFilter: StoredActionEffect = { seq: 1, capturedAt: 0, fromUrl: `${RB}/rec/2`, fromSnapshot: PAGE_DIALOG,
      action: { role: 'button', name: 'Filter', ref: 'e11', elementFp: { role: 'button', name: 'Filter', near: null } },
      toUrl: `${RB}/rec/2`, toSnapshot: PAGE_DIALOG, navigated: false, diff: { added: [], removed: [] } as any };
    const g = draftFromEffects([enter2, clickFilter] as never);
    const s = g.states.find((x) => x.label === 'rec')!;
    expect(s.affordances.filter((a) => a.label === 'Filter').length).toBe(1);
  });

  it('RULE 3: interior synthesis reads CORE nodes only — a value in ONE landing does not synthesize', () => {
    // two landings of one page: a stable control on both (core) + a data value on only one (falls
    // out of core). Interior synthesis reads coreNodes, so the one-visit value never becomes an
    // affordance (the union would have leaked it). ≥8 ready nodes per landing.
    const PAGE = (uniqueBtn: string) => [
      '- heading "Inventory" [ref=e1]',
      '- button "Refresh" [ref=e2]',
      '- textbox "Filter" [ref=e3]',
      `- button "${uniqueBtn}" [ref=e4]`,   // varies between landings → falls out of core
      '- paragraph "Stock levels" [ref=e5]',
      '- listitem "Item A" [ref=e6]',
      '- listitem "Item B" [ref=e7]',
      '- paragraph "Footer" [ref=e8]',
    ].join('\n');
    const V1 = PAGE('Sold: SKU-001');
    const V2 = PAGE('Sold: SKU-999');
    const authEnter: StoredActionEffect = { seq: 0, capturedAt: 0, fromUrl: `${RB}/auth/login`, fromSnapshot: AUTH,
      action: { role: 'button', name: 'Login', ref: 'e4', elementFp: { role: 'button', name: 'Login', near: null } },
      toUrl: `${RB}/inv/3`, toSnapshot: V1, navigated: true, diff: { added: [], removed: [] } as any };
    const revisit: StoredActionEffect = { seq: 1, capturedAt: 0, fromUrl: `${RB}/inv/3`, fromSnapshot: V1,
      action: { role: 'button', name: 'Refresh', ref: 'e2', elementFp: { role: 'button', name: 'Refresh', near: null } },
      toUrl: `${RB}/inv/3`, toSnapshot: V2, navigated: true, diff: { added: [], removed: [] } as any };
    const g = draftFromEffects([authEnter, revisit] as never);
    const s = g.states.find((x) => x.label === 'inv')!;
    // the stable control (core) synthesizes; neither one-landing value does.
    expect(s.affordances.some((a) => a.label === 'Refresh')).toBe(true);
    expect(s.affordances.some((a) => a.label === 'Sold: SKU-001')).toBe(false);
    expect(s.affordances.some((a) => a.label === 'Sold: SKU-999')).toBe(false);
  });

  // GUARD (reviewer, binding): NEVER fold routing away. Repeated same-shape CARD subtrees fold as
  // widgets (their instance titles are data), but a link INSIDE a folded card has a DISTINCT
  // destination — a real route, not repeated template. The cross-link mesh must still emit each
  // card link's navigate edge, completely UNAFFECTED by the fold.
  it('GUARD: a link inside a folded card subtree still yields its navigate edge (mesh unaffected)', () => {
    // a catalog page whose 3 product cards each = { link → a distinct product page, heading }.
    // The cards fold (widget-scoped, unitSize ≥ 2) but the 3 links route to 3 KNOWN pages.
    const catalog = (a: string, b: string, c: string) => shell('Catalog', [
      '- generic [ref=e10]:',
      `  - link "${a}" [ref=e11]:\n      - /url: ${XB}/alpha/view`, '    - heading "Card A" [ref=e12]',
      `  - link "${b}" [ref=e13]:\n      - /url: ${XB}/beta/view`, '    - heading "Card B" [ref=e14]',
      `  - link "${c}" [ref=e15]:\n      - /url: ${XB}/gamma/view`, '    - heading "Card C" [ref=e16]',
    ]);
    const g = draftFromEffects([
      // two visits so the card links stay in the durable core; instance titles differ per visit.
      nav(`${XB}/catalog/list`, catalog('Alpha widget', 'Beta widget', 'Gamma widget')),
      nav(`${XB}/catalog/list`, catalog('Alpha widget', 'Beta widget', 'Gamma widget')),
      // distinct (non-param-groupable) destination pages so each keeps its own label.
      nav(`${XB}/alpha/view`, shell('Alpha', ['- button "Buy alpha" [ref=e7]', '- paragraph "alpha details" [ref=e8]'])),
      nav(`${XB}/beta/view`, shell('Beta', ['- textbox "Beta search" [ref=e7]', '- listitem "beta row" [ref=e8]'])),
      nav(`${XB}/gamma/view`, shell('Gamma', ['- button "Gamma go" [ref=e7]', '- heading "Gamma panel" [ref=e8]'])),
    ] as never);
    const cat = g.states.find((s) => s.label === 'catalog-list')!;
    // all three routes survive the fold — the mesh emits a navigate per distinct destination.
    const navTos = cat.affordances.filter((a) => a.kind === 'navigate').map((a) => a.to).sort();
    expect(navTos).toEqual(expect.arrayContaining(['alpha-view', 'beta-view', 'gamma-view']));
  });
});

// ── Task 15: offline-acceptance findings, each reproduced synthetically (the real the analytics SPA data
// surfaced these; here they are isolated so the producing-stage fix is pinned without the DB).
describe('draftFromEffects — Task 15 acceptance findings (synthetic repros)', () => {
  it('a pre-redirect 404 sharing a merged key does NOT suffix the healthy sibling (report-list, not report-list-reports)', () => {
    // old data has NO requestedUrl; base inference merges `/report/list` (settled 404 ghost) and
    // `/v3/9999/report/list` (real Reports). The 404 cluster must be held out to needsFix WITHOUT
    // forcing an SPA split that renames the good state `report-list-reports`.
    const REAL = shell('Reports', ['- button "New report" [ref=e7]', '- textbox "Search" [ref=e8]']);
    const GHOST404 = ['- heading "Page not found" [ref=e1]', '- paragraph "This page could not be found." [ref=e2]',
      '- link "Home" [ref=e3]:\n    - /url: https://x.test/v3/9999/home', '- link "Back" [ref=e4]',
      '- paragraph "404" [ref=e5]', '- paragraph "sorry" [ref=e6]', '- link "Help" [ref=e7]', '- button "Retry" [ref=e8]'].join('\n');
    const g = draftFromEffects([
      nav(`${XB}/report/list`, REAL),
      nav(`${XB}/announcements`, shell('Announcements', ['- button "Post" [ref=e7]', '- paragraph "News" [ref=e8]'])),
      nav(`${XB}/help-center`, shell('Help Center', ['- textbox "Ask" [ref=e7]', '- button "Contact" [ref=e8]'])),
      nav(`${XB}/download/list`, shell('Downloads', ['- button "All" [ref=e7]', '- listitem "a.csv" [ref=e8]'])),
      nav('https://x.test/report/list', GHOST404),   // pre-redirect ghost keyed to the SAME key
    ] as never);
    const labels = g.states.map((s) => s.label);
    expect(labels).toContain('report-list');
    expect(labels.join(',')).not.toMatch(/-reports\b/);   // healthy sibling NOT suffixed
    expect((g.needsFix ?? []).some((n) => /error page/i.test(n.reason))).toBe(true);
  });

  it('shell edges live ONCE on _shell — a recorded click on a shell node does not leak onto the page it was clicked from', () => {
    // click the sidebar "Reports" link FROM the announcements page; it must NOT become an
    // affordance on `announcements` (it is a from-anywhere shell edge on `_shell`).
    const g = draftFromEffects([
      nav(`${XB}/report/list`, shell('Reports', ['- button "New report" [ref=e7]', '- textbox "Search" [ref=e8]'])),
      nav(`${XB}/announcements`, shell('Announcements', ['- button "Post" [ref=e7]', '- paragraph "News" [ref=e8]'])),
      nav(`${XB}/help-center`, shell('Help Center', ['- textbox "Ask" [ref=e7]', '- button "Contact" [ref=e8]'])),
      nav(`${XB}/download/list`, shell('Downloads', ['- button "All" [ref=e7]', '- listitem "a.csv" [ref=e8]'])),
      { seq: 0, capturedAt: 0, fromUrl: `${XB}/announcements`, fromSnapshot: shell('Announcements'),
        action: { role: 'link', name: 'Reports', ref: 'e3', elementFp: { role: 'link', name: 'Reports', near: null } },
        toUrl: `${XB}/report/list`, toSnapshot: shell('Reports'), navigated: true, diff: { added: [], removed: [] } as any },
    ] as never);
    const ann = g.states.find((s) => s.label === 'announcements')!;
    expect(ann.affordances.some((a) => a.label === 'Reports')).toBe(false);   // not leaked onto the page
    const sh = g.states.find((s) => s.label === '_shell')!;
    expect(sh.affordances.some((a) => a.kind === 'navigate' && a.to === 'report-list')).toBe(true);  // on _shell
  });

  it('opaque id tail segments are dropped from labels (/report/7001/{hash} → report, colliding vizzes split by tab)', () => {
    // two structurally-DISTINCT vizzes of report 7001 (jaccard < 0.5 → dispose rejects the
    // template merge): both key to the clean label `report`, so the collision resolver must
    // distinguish them — the second by its unique `tab:Flat` (no distinguishing heading exists).
    const VIZ_A = shell('Metric Report', ['- tab "Table" [ref=e7]', '- tab "Charts" [ref=e8]',
      '- button "Export" [ref=e9]', '- button "Configure metrics" [ref=e10]', '- listitem "row" [ref=e11]']);
    const VIZ_FLAT = shell('Metric Report', ['- tab "Flat" [ref=e7]', '- textbox "Search rows" [ref=e8]',
      '- button "Download CSV" [ref=e9]', '- paragraph "Flat listing" [ref=e10]']);
    const g = draftFromEffects([
      nav(`${XB}/report/7001/aaaaaaaaaaaaaaaa`, VIZ_A),
      nav(`${XB}/report/7001/bbbbbbbbbbbbbbbb`, VIZ_FLAT),
      nav(`${XB}/announcements`, shell('Announcements', ['- button "Post" [ref=e7]', '- paragraph "News" [ref=e8]'])),
      nav(`${XB}/help-center`, shell('Help Center', ['- textbox "Ask" [ref=e7]', '- button "Contact" [ref=e8]'])),
    ] as never);
    const labels = g.states.map((s) => s.label);
    // both collide on the clean base `report` (opaque `7001`+hash dropped); the resolver
    // distinguishes each by a UNIQUE TAB (no heading differs) → `report-table` + `report-flat`.
    expect(labels).toContain('report-table');
    expect(labels).toContain('report-flat');
    expect(labels.every((l) => l.startsWith('report') ? /^report(-\w+)?$/.test(l) : true)).toBe(true);
    expect(labels.join(',')).not.toMatch(/7001|aaaaaaaa|bbbbbbbb/);   // no raw id in any label
  });

  it('a folded per-chip name never anchors identity (report fp has no OS Remove / eCPM Remove)', () => {
    const core = (extra: string[]) => shell('Metric Report', [
      '- tab "Table" [ref=e7]', '- tab "Charts" [ref=e8]',
      '- button "OS Remove" [ref=e10]', '- button "Revenue Remove" [ref=e11]',
      '- button "eCPM Remove" [ref=e12]', '- button "Win Rate Remove" [ref=e13]', ...extra]);
    const g = draftFromEffects([
      nav(`${XB}/report/7001/aaaaaaaaaaaaaaaa`, core(['- textbox "Search rows" [ref=e14]'])),
      nav(`${XB}/report/7001/aaaaaaaaaaaaaaaa`, core(['- textbox "Search rows" [ref=e14]'])),   // 2 landings → confirmed core
      nav(`${XB}/announcements`, shell('Announcements', ['- button "Post" [ref=e7]', '- paragraph "News" [ref=e8]'])),
      nav(`${XB}/help-center`, shell('Help Center', ['- textbox "Ask" [ref=e7]', '- button "Contact" [ref=e8]'])),
    ] as never);
    const rep = g.states.find((s) => s.label === 'report')!;
    expect(rep.fingerprint.join()).not.toMatch(/Remove/);   // folded chips excluded from identity
    expect(rep.affordances.filter((a) => a.scope === 'row').some((a) => a.label === 'Remove')).toBe(true);  // one row fold
  });

  it('a bare date/number literal is never stored as an affordance or fingerprint token', () => {
    const DATED = shell('Widget', ['- button "09 Jul 2026" [ref=e7]', '- button "10 Jul 2026" [ref=e8]',
      '- button "Apply filter" [ref=e9]', '- paragraph "range" [ref=e10]']);
    const g = draftFromEffects([
      nav(`${XB}/widget/list`, DATED),
      nav(`${XB}/announcements`, shell('Announcements', ['- button "Post" [ref=e7]', '- paragraph "News" [ref=e8]'])),
      nav(`${XB}/help-center`, shell('Help Center', ['- textbox "Ask" [ref=e7]', '- button "Contact" [ref=e8]'])),
      nav(`${XB}/download/list`, shell('Downloads', ['- button "All" [ref=e7]', '- listitem "a.csv" [ref=e8]'])),
    ] as never);
    const w = g.states.find((s) => s.label === 'widget-list')!;
    const all = g.states.flatMap((s) => s.affordances);
    expect(all.some((a) => /^\d{2} \w{3} \d{4}$/.test(a.label))).toBe(false);
    expect(w.fingerprint.join()).not.toMatch(/\d{2} \w{3} \d{4}/);
    expect(w.affordances.some((a) => a.label === 'Apply filter')).toBe(true);   // real control kept
  });

  it('a recorded interior action with a null-name elementFp is dropped (unreliable coordinate)', () => {
    // a personalized-widget combobox the recorder could not pin (fp.name null) → not stored.
    const PAGE = shell('Widget', ['- combobox "Country" [ref=e7]', '- button "Apply filter" [ref=e8]',
      '- paragraph "body" [ref=e9]', '- listitem "row" [ref=e10]']);
    const g = draftFromEffects([
      nav(`${XB}/widget/list`, PAGE),
      nav(`${XB}/announcements`, shell('Announcements', ['- button "Post" [ref=e7]', '- paragraph "News" [ref=e8]'])),
      nav(`${XB}/help-center`, shell('Help Center', ['- textbox "Ask" [ref=e7]', '- button "Contact" [ref=e8]'])),
      nav(`${XB}/download/list`, shell('Downloads', ['- button "All" [ref=e7]', '- listitem "a.csv" [ref=e8]'])),
      { seq: 0, capturedAt: 0, fromUrl: `${XB}/widget/list`, fromSnapshot: PAGE,
        action: { role: 'combobox', name: 'Country', ref: 'e7', elementFp: { role: 'combobox', name: null, near: null } },
        toUrl: `${XB}/widget/list`, toSnapshot: PAGE, navigated: false, diff: { added: [], removed: [] } as any },
    ] as never);
    const w = g.states.find((s) => s.label === 'widget-list')!;
    expect(w.affordances.some((a) => a.label === 'Country')).toBe(false);       // null-name fp → dropped
    expect(w.affordances.some((a) => a.label === 'Apply filter')).toBe(true);   // named control kept
  });

  it('a session that starts ON a page never navigated-to keeps that page + its recorded actions (per-session entry landings)', () => {
    // session boundary = seq reset in the concatenated stream. Session 2 enters DIRECTLY on
    // /builder/edit and only acts in-page — with the old i===0-only entry rule that page never
    // became a landing, so fromLabel was null and every recorded action was silently dropped
    // (the report-builder husk: 46 real actions lost).
    const BUILDER = shell('Builder', ['- button "Add widget" [ref=e7]', '- button "Save As" [ref=e8]', '- paragraph "canvas" [ref=e9]']);
    const inPage = (seq: number, name: string): StoredActionEffect => ({ seq, capturedAt: 0,
      fromUrl: `${XB}/builder/edit`, fromSnapshot: BUILDER,
      action: { role: 'button', name, ref: 'e7', elementFp: { role: 'button', name, near: null } },
      toUrl: `${XB}/builder/edit`, toSnapshot: BUILDER, navigated: false, diff: { added: [], removed: [] } as any });
    const g = draftFromEffects([
      // session 1 (seqs 0..1): enters on /home, navigates around — never touches /builder/edit.
      { ...nav(`${XB}/alpha/list`, shell('Alpha', ['- button "New alpha" [ref=e7]', '- paragraph "A" [ref=e8]'])), seq: 0 },
      { ...nav(`${XB}/beta/list`, shell('Beta', ['- button "New beta" [ref=e7]', '- paragraph "B" [ref=e8]'])), seq: 1 },
      // session 2 (seq RESETS to 0): starts on /builder/edit, acts in-page only.
      inPage(0, 'Add widget'),
      inPage(1, 'Save As'),
    ] as never);
    const b = g.states.find((s) => s.label === 'builder-edit')!;
    expect(b, 'the session-2 entry page must be a state').toBeDefined();
    expect(b.affordances.some((a) => a.label === 'Add widget')).toBe(true);
    expect(b.affordances.some((a) => a.label === 'Save As')).toBe(true);
  });

  it('a recorded action FROM a member URL of a merged {param} template attaches to the merged state', () => {
    // /item/1111/edit and /item/2222/edit merge under /item/{param}/edit; a recorded REVEAL from
    // the 2222 member URL must land on the merged state. (Latent bug: lookups used the raw key
    // while merged pages register under the canonical template key — the action was dropped.)
    // Asserted via a reveal-with-children, which interior synthesis cannot produce.
    const FACE = shell('Item Editor', ['- tab "Design" [ref=e7]', '- button "Publish it" [ref=e8]', '- paragraph "editor" [ref=e9]']);
    const g = draftFromEffects([
      nav(`${XB}/item/1111/edit`, FACE),
      nav(`${XB}/item/2222/edit`, FACE),
      { seq: 2, capturedAt: 0, fromUrl: `${XB}/item/2222/edit`, fromSnapshot: FACE,
        action: { role: 'button', name: 'Publish it', ref: 'e8', elementFp: { role: 'button', name: 'Publish it', near: null } },
        toUrl: `${XB}/item/2222/edit`, toSnapshot: FACE, navigated: false,
        diff: { added: [
          { role: 'menuitem', name: 'To staging', ref: 'e20', url: null, raw: '', depth: 2 },
          { role: 'menuitem', name: 'To prod', ref: 'e21', url: null, raw: '', depth: 2 },
        ], removed: [] } as any },
      nav(`${XB}/announcements`, shell('Announcements', ['- button "Post" [ref=e7]', '- paragraph "News" [ref=e8]'])),
      nav(`${XB}/help-center`, shell('Help Center', ['- textbox "Ask" [ref=e7]', '- button "Contact" [ref=e8]'])),
    ] as never);
    const merged = g.states.find((s) => s.urlPattern.includes('/item/1111/edit'))!;
    expect(merged, 'merged template state').toBeDefined();
    const reveal = merged.affordances.find((a) => a.kind === 'reveal' && a.label === 'Publish it');
    expect(reveal, 'recorded reveal from the member URL').toBeTruthy();
    expect((reveal!.children ?? []).map((c) => c.label).sort()).toEqual(['To prod', 'To staging']);
  });

  it('an overlay\'s enumerated value domain (≥3 same-role same-depth distinct names) never persists as reveal children', () => {
    // a picker overlay: 4 dimension checkboxes at one depth (the VALUE domain — read live at walk
    // time) + the overlay's own controls (Apply/Cancel at another depth) which must survive.
    const PAGE = shell('Editor', ['- button "Pick dimensions" [ref=e7]', '- paragraph "x" [ref=e8]', '- listitem "row" [ref=e9]']);
    const added = [
      { role: 'dialog', name: 'All Dimensions', ref: 'e19', url: null, raw: '', depth: 2 },
      { role: 'checkbox', name: 'Publisher', ref: 'e20', url: null, raw: '', depth: 6 },
      { role: 'checkbox', name: 'Country', ref: 'e21', url: null, raw: '', depth: 6 },
      { role: 'checkbox', name: 'Month', ref: 'e22', url: null, raw: '', depth: 6 },
      { role: 'checkbox', name: 'Device', ref: 'e23', url: null, raw: '', depth: 6 },
      { role: 'button', name: 'Apply', ref: 'e24', url: null, raw: '', depth: 4 },
      { role: 'button', name: 'Cancel', ref: 'e25', url: null, raw: '', depth: 4 },
    ];
    const g = draftFromEffects([
      { ...nav(`${XB}/editor/main`, PAGE), seq: 0 },
      { seq: 1, capturedAt: 0, fromUrl: `${XB}/editor/main`, fromSnapshot: PAGE,
        action: { role: 'button', name: 'Pick dimensions', ref: 'e7', elementFp: { role: 'button', name: 'Pick dimensions', near: null } },
        toUrl: `${XB}/editor/main`, toSnapshot: PAGE, navigated: false, diff: { added, removed: [] } as any },
    ] as never);
    const ed = g.states.find((s) => s.label === 'editor-main')!;
    const reveal = ed.affordances.find((a) => a.kind === 'reveal' && a.label === 'Pick dimensions')!;
    const childLabels = (reveal.children ?? []).map((c) => c.label).sort();
    expect(childLabels).toEqual(['Apply', 'Cancel']);   // controls kept; Publisher/Country/Month/Device dropped
  });

  it('a control clicked twice yields ONE affordance; reveal children are unioned', () => {
    const PAGE = shell('Catalog', ['- button "Filter" [ref=e7]', '- paragraph "x" [ref=e8]', '- listitem "row" [ref=e9]']);
    const click = (seq: number, added: any[]): StoredActionEffect => ({ seq, capturedAt: 0,
      fromUrl: `${XB}/catalog/list`, fromSnapshot: PAGE,
      action: { role: 'button', name: 'Filter', ref: 'e7', elementFp: { role: 'button', name: 'Filter', near: null } },
      toUrl: `${XB}/catalog/list`, toSnapshot: PAGE, navigated: false, diff: { added, removed: [] } as any });
    const g = draftFromEffects([
      { ...nav(`${XB}/catalog/list`, PAGE), seq: 0 },
      click(1, [{ role: 'menuitem', name: 'By price', ref: 'e20', url: null, raw: '', depth: 2 }]),
      click(2, [{ role: 'menuitem', name: 'By price', ref: 'e20', url: null, raw: '', depth: 2 },
                { role: 'menuitem', name: 'By size', ref: 'e21', url: null, raw: '', depth: 2 }]),
    ] as never);
    const cat = g.states.find((s) => s.label === 'catalog-list')!;
    const filters = cat.affordances.filter((a) => a.label === 'Filter');
    expect(filters.length).toBe(1);                       // deduped by control identity, not click id
    expect((filters[0].children ?? []).map((c) => c.label).sort()).toEqual(['By price', 'By size']);
  });

  it('a partial-render landing (strict-subset face) joins its full sibling — ONE state, core from the full face', () => {
    // live OrangeHRM finding: visit 2 of a list page was captured before its grid rendered —
    // 33-token face ⊂ 199-token face, jaccard 0.17 but containment 1.0. Jaccard-only clustering
    // split them, neither had a distinguishing heading → BOTH to needsFix → the page was LOST.
    // Fixture: full 18-node face; partial = an 8-node strict subset (ready, but pre-render).
    const EXTRAS = ['- textbox "Employee Name" [ref=e7]', '- button "Search people" [ref=e8]',
      '- button "Reset" [ref=e9]', '- button "Add employee" [ref=e10]', '- columnheader "First Name" [ref=e11]',
      '- columnheader "Last Name" [ref=e12]', '- button "Next page" [ref=e13]', '- listitem "row one" [ref=e14]',
      '- listitem "row two" [ref=e15]', '- paragraph "records" [ref=e16]', '- button "Prev page" [ref=e17]',
      '- checkbox "Select all rows" [ref=e18]'];
    const FULL = shell('Employees', EXTRAS);
    const PARTIAL = shell('Employees', EXTRAS.slice(0, 2));   // 8 nodes, strict subset of FULL
    const g = draftFromEffects([
      { ...nav(`${XB}/people/list`, FULL), seq: 0 },
      { ...nav(`${XB}/people/list`, PARTIAL), seq: 1 },
    ] as never);
    const states = g.states.filter((s) => s.label === 'people-list');
    expect(states.length, 'exactly one people-list state').toBe(1);
    expect((g.needsFix ?? []).some((n) => n.label === 'people-list')).toBe(false);
    // core comes from the FULL face (the partial is excluded from templateCore's input), so the
    // full page's controls synthesize; one full landing remains → honest seen-once provisional.
    expect(states[0].affordances.some((a) => a.label === 'Add employee')).toBe(true);
    expect(states[0].provisional ?? '').toMatch(/seen once/);
  });

  it('a core table\'s columns reach the declared shadow (unnamed containers preserved for extractShadow)', () => {
    // extractShadow anchors collections on the NAMELESS `table` node; feeding it named-core-only
    // nodes silently emptied every collection. shadowNodes keeps the structural containers.
    const GRID = [
      '- heading "Employees" [ref=e1]',
      '- table [ref=e2]:',
      '  - columnheader "Id" [ref=e3]',
      '  - columnheader "Full Name" [ref=e4]',
      '  - columnheader "Job Title" [ref=e5]',
      '- button "Add employee" [ref=e6]',
      '- paragraph "records" [ref=e7]',
      '- listitem "row" [ref=e8]',
    ].join('\n');
    const g = draftFromEffects([
      { ...nav(`${XB}/staff/list`, GRID), seq: 0 },
      { ...nav(`${XB}/staff/list`, GRID), seq: 1 },   // 2 identical landings → confirmed core
    ] as never);
    const s = g.states.find((x) => x.label === 'staff-list')!;
    expect(s.declaredShadow?.collections?.[0]?.columns).toEqual(['Id', 'Full Name', 'Job Title']);
  });

  it('two template instances with identical CONTROL faces merge even when instance data drags full-face jaccard under the bar', () => {
    // ae finding: /product_details/1 vs /product_details/3 — full faces jaccard 0.45-0.49 after
    // shell subtraction (product names/prices/related items differ) but CONTROL faces identical.
    // Controls are the template's skeleton; the pages must merge into ONE state labeled from the
    // template, no instance-heading qualifier, fingerprint free of both instance headings.
    const CONTROLS = ['- button "Add to cart" [ref=e7]', '- spinbutton "Quantity" [ref=e8]',
      '- tab "Reviews" [ref=e9]', '- tab "Details" [ref=e10]', '- button "Add to wishlist" [ref=e11]'];
    const P1 = shell('Blue Top', [...CONTROLS, '- paragraph "Rs. 500" [ref=e12]',
      '- paragraph "Blue cotton top" [ref=e13]', '- paragraph "In stock" [ref=e14]']);
    const P3 = shell('Sleeveless Dress', [...CONTROLS, '- paragraph "Rs. 900" [ref=e12]',
      '- paragraph "White summer dress" [ref=e13]', '- paragraph "Made to order" [ref=e14]']);
    const g = draftFromEffects([
      nav(`${XB}/product_details/1`, P1),
      nav(`${XB}/product_details/3`, P3),
      nav(`${XB}/announcements`, shell('Announcements', ['- button "Post" [ref=e7]', '- paragraph "News" [ref=e8]'])),
      nav(`${XB}/help-center`, shell('Help Center', ['- textbox "Ask" [ref=e7]', '- button "Contact" [ref=e8]'])),
    ] as never);
    const labels = g.states.map((s) => s.label);
    expect(labels.filter((l) => l.startsWith('product-details')).length).toBe(1);   // ONE merged state
    expect(labels).toContain('product-details');                                    // template label, no qualifier
    expect(labels.join(',')).not.toMatch(/blue-top|sleeveless/);                     // no instance data in labels
    const p = g.states.find((s) => s.label === 'product-details')!;
    expect(p.fingerprint.join()).not.toMatch(/Blue Top|Sleeveless Dress/);           // identity is structural
  });

  it('anti-merge: same-template-shaped keys with DISJOINT control sets still split', () => {
    // a real list page and a real viewer at /view/list vs /view/9001: each has ≥4 controls but
    // the sets are disjoint — the control arm must NOT merge them (wrong-merge is the worse error).
    const LIST = shell('Views', ['- button "New view" [ref=e7]', '- button "Refresh list" [ref=e8]',
      '- textbox "Search views" [ref=e9]', '- button "Next page" [ref=e10]', '- listitem "row" [ref=e11]']);
    const VIEWER = shell('Sales KPIs', ['- button "Setup panel" [ref=e7]', '- button "Customize it" [ref=e8]',
      '- combobox "Filter field" [ref=e9]', '- button "Full screen" [ref=e10]', '- img "chart" [ref=e11]']);
    const g = draftFromEffects([
      nav(`${XB}/view/list`, LIST),
      nav(`${XB}/view/9001`, VIEWER),
      nav(`${XB}/announcements`, shell('Announcements', ['- button "Post" [ref=e7]', '- paragraph "News" [ref=e8]'])),
      nav(`${XB}/help-center`, shell('Help Center', ['- textbox "Ask" [ref=e7]', '- button "Contact" [ref=e8]'])),
    ] as never);
    const labels = g.states.map((s) => s.label);
    expect(labels).toContain('view-list');
    expect(labels).toContain('view');        // /view/9001, opaque id dropped — SEPARATE state, no merge
  });

  it('a landing that settled on a FOREIGN host is a blocked door — never a state, one deduped needsFix entry', () => {
    // an SSO/CDN interstitial (e.g. a Cloudflare Access wall) settles on another host; it must
    // not mint states inside this site's map (doors posture: detect + escalate, never a state).
    const WALL = ['- heading "Sign in to continue" [ref=e1]', '- textbox "Email" [ref=e2]',
      '- button "Send code" [ref=e3]', '- paragraph "Protected by SSO" [ref=e4]',
      '- link "Help" [ref=e5]', '- paragraph "wall" [ref=e6]', '- img "logo" [ref=e7]', '- paragraph "x" [ref=e8]'].join('\n');
    const g = draftFromEffects([
      nav(`${XB}/report/list`, shell('Reports', ['- button "New report" [ref=e7]', '- textbox "Search" [ref=e8]'])),
      nav('https://sso.wall.test/cdn-cgi/access/login/a?kid=1', WALL),
      nav('https://sso.wall.test/cdn-cgi/access/login/b?kid=2', WALL),   // 2nd visit → still ONE entry
      nav(`${XB}/announcements`, shell('Announcements', ['- button "Post" [ref=e7]', '- paragraph "News" [ref=e8]'])),
    ] as never);
    expect(g.states.some((s) => s.urlPattern.includes('sso.wall.test'))).toBe(false);   // never a state
    const foreign = (g.needsFix ?? []).filter((n) => /foreign-host interstitial/.test(n.reason));
    expect(foreign.length).toBe(1);                                                     // deduped per host
    expect(foreign[0].reason).toContain('sso.wall.test');
    expect(g.receipt.requests.join()).not.toMatch(/sso\.wall\.test|sign-in/i);           // absent from requests
    expect(g.states.some((s) => s.label === 'report-list')).toBe(true);                 // from-page keeps working
  });

  it('fixpoint template proposal merges multi-param URLs (/r/{id}/{viz} instances → ONE state)', () => {
    // /r/1/aaaa… + /r/1/bbbb… merge in pass 1 (/r/1/{param}); /r/2/cccc… differs from that
    // template at TWO raw positions — only {param}-wildcard unification in a SECOND pass can
    // merge them (→ /r/{param}/{param}). Identical control faces, instance data differs.
    const CONTROLS = ['- button "Run query" [ref=e7]', '- spinbutton "Rows" [ref=e8]',
      '- tab "Grid" [ref=e9]', '- tab "Plot" [ref=e10]', '- button "Export data" [ref=e11]'];
    const inst = (h: string, p: string) => shell(h, [...CONTROLS,
      `- paragraph "${p} one" [ref=e12]`, `- paragraph "${p} two" [ref=e13]`, `- paragraph "${p} three" [ref=e14]`]);
    const g = draftFromEffects([
      nav(`${XB}/r/1/aaaaaaaaaaaaaaaaaaaa`, inst('OS and Device', 'alpha')),
      nav(`${XB}/r/1/bbbbbbbbbbbbbbbbbbbb`, inst('OS and Device', 'beta')),
      nav(`${XB}/r/2/cccccccccccccccccccc`, inst('Browser and Device', 'gamma')),
      // anti-merge: same URL shape but a different first WORD segment = a different SECTION with
      // its OWN controls (faithful: sibling sections differ in what you can do) — must stay split.
      nav(`${XB}/q/2/dddddddddddddddddddd`, shell('Other Section', ['- button "Setup panel" [ref=e7]',
        '- combobox "Filter field" [ref=e8]', '- button "Full screen" [ref=e9]', '- button "Customize it" [ref=e10]',
        '- paragraph "delta one" [ref=e11]', '- paragraph "delta two" [ref=e12]'])),
      // filler sections so the instance pages' controls stay under the 80% cross-page shell bar
      // (a real site has many pages; 4-of-5 pages sharing controls would legitimately read as shell).
      nav(`${XB}/announcements`, shell('Announcements', ['- button "Post" [ref=e7]', '- paragraph "News" [ref=e8]'])),
      nav(`${XB}/help-center`, shell('Help Center', ['- textbox "Ask" [ref=e7]', '- button "Contact" [ref=e8]'])),
    ] as never);
    const rStates = g.states.filter((s) => /\/r\//.test(s.urlPattern));
    expect(rStates.length, 'the three /r instances collapse to ONE state').toBe(1);
    expect(rStates[0].label).toBe('r');                                    // template label, no instance names
    expect(rStates[0].provisional ?? null).toBeNull();                     // ≥2 instances → confirmed
    expect(rStates[0].fingerprint.join()).not.toMatch(/OS and Device|Browser and Device/);
    expect(g.states.some((s) => /\/q\//.test(s.urlPattern))).toBe(true);   // other section stays split
  });

  it('needsFix carries no duplicate (label, reason) entries', () => {
    // two genuinely-different HEADING-LESS faces at one key (low jaccard AND low containment):
    // still split, neither nameable → both clusters report the same (label, reason) → ONE entry.
    const A = ['- button "Alpha one" [ref=e1]', '- button "Alpha two" [ref=e2]', '- paragraph "aaa" [ref=e3]',
      '- listitem "a1" [ref=e4]', '- listitem "a2" [ref=e5]', '- link "AlphaLink" [ref=e6]',
      '- paragraph "a3" [ref=e7]', '- button "Alpha three" [ref=e8]'].join('\n');
    const B = ['- button "Beta one" [ref=e1]', '- button "Beta two" [ref=e2]', '- paragraph "bbb" [ref=e3]',
      '- listitem "b1" [ref=e4]', '- listitem "b2" [ref=e5]', '- link "BetaLink" [ref=e6]',
      '- paragraph "b3" [ref=e7]', '- button "Beta three" [ref=e8]'].join('\n');
    const g = draftFromEffects([
      { ...nav(`${XB}/spa/thing`, A), seq: 0 },
      { ...nav(`${XB}/spa/thing`, B), seq: 1 },
    ] as never);
    const entries = (g.needsFix ?? []).filter((n) => n.label === 'spa-thing');
    expect(entries.length).toBe(1);   // deduped by (label, reason), not one row per lost cluster
  });

  it('single-instance param page with a heading-only fingerprint is held out (no instance-data identity)', () => {
    // one visit to /dashboard/8001 whose only non-shell token is heading:Demo User → needsFix,
    // NOT a state fingerprinted on the user name.
    const g = draftFromEffects([
      nav(`${XB}/dashboard/8001`, shell('Demo User', ['- img "avatar" [ref=e7]', '- paragraph "welcome" [ref=e8]'])),
      nav(`${XB}/announcements`, shell('Announcements', ['- button "Post" [ref=e7]', '- paragraph "News" [ref=e8]'])),
      nav(`${XB}/help-center`, shell('Help Center', ['- textbox "Ask" [ref=e7]', '- button "Contact" [ref=e8]'])),
      nav(`${XB}/download/list`, shell('Downloads', ['- button "All" [ref=e7]', '- listitem "a.csv" [ref=e8]'])),
    ] as never);
    expect(g.states.every((s) => !s.fingerprint.join().includes('Demo User'))).toBe(true);
    expect((g.needsFix ?? []).some((n) => /instance data/i.test(n.reason) && n.urlPattern.includes('/dashboard/8001'))).toBe(true);
  });
});

// ── Task 3: identity-face normalization (dispose predicate + SPA-split clustering ONLY). Two
// personalized dashboards are ONE template: their per-widget instance controls are DATA that
// drags full-face AND control-face jaccard apart, while the repeated widget SHAPE (fold sig) is
// the identity. normFace drops folded-member tokens + adds ONE `widget:<sig>` presence token, so
// same-sig pages MERGE and different-sig pages (list rows vs viewer widgets) STILL SPLIT. Both
// tests are MUTATION-PINNED (stub normFace → faceOf and they invert), verified in the Task-3 report.
describe('draftFromEffects — identity-face normalization (subtree widgets)', () => {
  const NB = 'https://n.test/v3/9999';
  const bar = (h: string, extra: string[] = []): string => [
    `- heading "${h}" [ref=e1]`,
    '- link "Home" [ref=e2]:\n    - /url: https://n.test/v3/9999/home',
    '- link "Reports" [ref=e3]:\n    - /url: https://n.test/v3/9999/report/list',
    '- link "Dashboards" [ref=e4]:\n    - /url: https://n.test/v3/9999/dashboard/list',
    '- link "Announcements" [ref=e5]:\n    - /url: https://n.test/v3/9999/announcements',
    '- link "Help Center" [ref=e6]:\n    - /url: https://n.test/v3/9999/help-center',
    ...extra,
  ].join('\n');
  const nnav = (url: string, snap: string): StoredActionEffect => ({ seq: 0, capturedAt: 0,
    fromUrl: `${NB}/home`, fromSnapshot: bar('Home'),
    action: { role: 'link', name: 'x', ref: 'e9b', elementFp: { role: 'link', name: 'x', near: null } },
    toUrl: url, toSnapshot: snap, navigated: true, diff: { added: [], removed: [] } as any });
  // a ≥2-node WIDGET whose title AND per-widget controls are per-INSTANCE data (they carry the
  // widget's own name) — so both the full face AND the control face differ dashboard-to-dashboard,
  // yet every widget has the SAME 4-node shape → the SAME abstracted fold sig.
  const widget = (t: string) => [
    '  - generic [ref=e]:', `    - heading "${t}" [ref=e]`,
    `    - button "${t} Remove" [ref=e]`, `    - button "${t} Configure" [ref=e]`];
  // dashboard = ONE shared page-level control (the structural id the merged fp rests on — too
  // sparse alone (size 1 < 4) to trip the sameControls arm, so normalization is the ONLY merge
  // path) + 3 per-instance widgets.
  const dashboard = (a: string, b: string, c: string) =>
    bar('Dashboard', ['- button "Add widget" [ref=e9]', '- generic [ref=e10]:', ...widget(a), ...widget(b), ...widget(c)]);

  it('MERGE: two /dashboard/{id} instances differing only by widget instances fold to ONE state', () => {
    const g = draftFromEffects([
      nnav(`${NB}/dashboard/8001`, dashboard('Sales', 'Traffic', 'Signups')),
      nnav(`${NB}/dashboard/8002`, dashboard('Revenue', 'Users', 'Churn')),
      // filler pages so a shell forms (≥4 pages) and the widget controls don't read as chrome.
      nnav(`${NB}/announcements`, bar('Announcements', ['- button "Post" [ref=e7]', '- paragraph "News" [ref=e8]'])),
      nnav(`${NB}/help-center`, bar('Help Center', ['- textbox "Ask" [ref=e7]', '- button "Contact" [ref=e8]'])),
    ] as never);
    const dash = g.states.filter((s) => /\/dashboard\/(12\d\d|\{param\})/.test(s.urlPattern));
    expect(dash.length, 'the two dashboards merge into ONE state').toBe(1);
    expect(dash[0].template).toBe('/dashboard/{param}');
    expect(dash[0].provisional ?? null, 'two instances → confirmed, NOT provisional').toBeNull();
    // identity is the shared structural control — never a per-instance widget name.
    expect(dash[0].fingerprint).toContain('button:Add widget');
    const fpj = dash[0].fingerprint.join();
    for (const nm of ['Sales', 'Traffic', 'Signups', 'Revenue', 'Users', 'Churn'])
      expect(fpj, nm).not.toContain(nm);
  });

  it('SPLIT: a list page (row-sig folds) and a viewer page (widget-sig folds) at same-shape URLs STAY split', () => {
    // both opaque-id params (so proposeTemplates proposes /grid/{param} and the sameControls arm
    // is active) — a real list page vs a real viewer: DISTINCT controls AND a DIFFERENT fold sig
    // (leaf rows `Expand drilldown` ×5 → row-sig vs ≥2-node widgets → widget-sig). They must NOT
    // collapse into one /grid/{param} template: the row-sig and widget-sig `widget:*` tokens differ,
    // so the normalized faces stay apart (a count-based or sig-blind normalization would merge them).
    const rowList = bar('Grid List', ['- button "New view" [ref=e7]', '- textbox "Search views" [ref=e8]',
      '- generic [ref=e10]:', ...Array.from({ length: 5 }, (_, i) => `  - button "Expand drilldown" [ref=e${20 + i}]`)]);
    const widgetViewer = bar('Grid Viewer', ['- button "Full screen" [ref=e7]', '- combobox "Auto refresh" [ref=e8]',
      '- generic [ref=e10]:', ...widget('Alpha'), ...widget('Beta'), ...widget('Gamma')]);
    const g = draftFromEffects([
      nnav(`${NB}/grid/9001`, rowList),
      nnav(`${NB}/grid/9002`, widgetViewer),
      nnav(`${NB}/announcements`, bar('Announcements', ['- button "Post" [ref=e7]', '- paragraph "News" [ref=e8]'])),
      nnav(`${NB}/help-center`, bar('Help Center', ['- textbox "Ask" [ref=e7]', '- button "Contact" [ref=e8]'])),
    ] as never);
    const grids = g.states.filter((s) => /\/grid\//.test(s.urlPattern));
    expect(grids.length, 'row-sig list and widget-sig viewer must NOT merge').toBe(2);
    expect(g.states.some((s) => s.template === '/grid/{param}'), 'no false /grid/{param} merge').toBe(false);
  });
});
