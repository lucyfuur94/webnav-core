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

// the snapshot a given drafted state was built from (test helper)
function snapFor(label: string): string {
  return { 'auth-login': LOGIN, 'dashboard-index': DASHBOARD, 'admin-viewadminmodule': ADMIN, 'pim-viewpimmodule': PIM }[label] ?? '';
}
