// Grammar suite — PAGE ARCHETYPES group.
// Matrix: docs/superpowers/specs/2026-07-12-structure-coverage-matrix.md
import { describe, it, expect } from 'vitest';
import { draftFromEffects } from '../../src/explorer/draft.js';
import type { StoredActionEffect } from '../../src/mapstore/record.js';

const B = 'https://arch.test';
const AUTH = ['- heading "Login" [ref=e1]', '- textbox "Username" [ref=e2]', '- textbox "Password" [ref=e3]',
  '- button "Login" [ref=e4]', '- paragraph "Sign in" [ref=e5]', '- link "Forgot" [ref=e6]:\n    - /url: https://arch.test/auth/forgot',
  '- paragraph "Co" [ref=e7]', '- paragraph "v1" [ref=e8]'].join('\n');
const enter = (toUrl: string, toSnapshot: string, fromUrl = `${B}/auth/login`, fromSnapshot = AUTH): StoredActionEffect => ({
  seq: 0, capturedAt: 0, fromUrl, fromSnapshot,
  action: { role: 'button', name: 'Login', ref: 'e4', elementFp: { role: 'button', name: 'Login', near: null } },
  toUrl, toSnapshot, navigated: true, diff: { added: [], removed: [] } as any,
});

// ── fx-detail-template (rows 69 Detail/record view, 63 Description list/key-value) ──────────
// /items/1..3, SAME field labels (dt/dd-shaped key-value pairs), DIFFERENT values, h1 = entity
// name (data!). Asserts provisional (1 landing) -> confirmed (>=2 landings) transition, and that
// the fingerprint never anchors on the h1 or the per-instance values.
describe('grammar: 69/63 detail/record view — provisional to confirmed, fingerprint excludes h1 + values', () => {
  const DETAIL = (id: number, name: string, status: string) => [
    `- heading "${name}" [ref=e1]`,
    '- button "Archive" [ref=e2]',
    '- tab "Overview" [ref=e3]',
    '- tab "Activity" [ref=e4]',
    `- paragraph "Status: ${status}" [ref=e5]`,
    '- paragraph "Owner: field label" [ref=e6]',
    '- paragraph "Created: field label" [ref=e7]',
    '- button "Duplicate" [ref=e8]',
  ].join('\n');

  it('a SINGLE landing keeps the state provisional and surfaces a record-next request', () => {
    const g = draftFromEffects([enter(`${B}/items/1`, DETAIL(1, 'Alpha widget', 'Active'))] as never);
    const s = g.states.find((x) => x.label === 'items')!;
    expect(s).toBeTruthy();
    expect(s.provisional).toBeTruthy();
    expect(g.receipt.requests.some((r) => r.startsWith('items'))).toBe(true);
  });

  it('TWO landings (different id, name, status) merge under one /items/{param} template and CONFIRM (no provisional)', () => {
    const g = draftFromEffects([
      enter(`${B}/items/1`, DETAIL(1, 'Alpha widget', 'Active')),
      enter(`${B}/items/2`, DETAIL(2, 'Beta widget', 'Archived'), `${B}/items/1`, DETAIL(1, 'Alpha widget', 'Active')),
    ] as never);
    const s = g.states.find((x) => x.label === 'items')!;
    expect(s).toBeTruthy();
    expect(s.template).toMatch(/\{param\}/);
    expect(s.provisional).toBeFalsy();
  });

  it('the fingerprint NEVER contains the entity name (h1) or a per-instance value', () => {
    const g = draftFromEffects([
      enter(`${B}/items/1`, DETAIL(1, 'Alpha widget', 'Active')),
      enter(`${B}/items/2`, DETAIL(2, 'Beta widget', 'Archived'), `${B}/items/1`, DETAIL(1, 'Alpha widget', 'Active')),
    ] as never);
    const s = g.states.find((x) => x.label === 'items')!;
    for (const t of s.fingerprint) {
      expect(t).not.toMatch(/Alpha widget|Beta widget|Active|Archived/);
    }
    // the durable structural tokens (tabs) anchor identity instead.
    expect(s.fingerprint.some((t) => t.startsWith('tab:'))).toBe(true);
  });

  it('the key-value field LABELS are durable structure; the field VALUES never anchor identity', () => {
    // "Status: Active" / "Status: Archived" is one control whose NAME embeds the value —
    // it varies per instance so templateCore drops it from core (never in fingerprint), matching
    // row 63's "labels = template shadow, values = data" split at the level webnav can observe
    // (a single-node dt/dd-style control keyed by its whole accessible name, not a separate
    // label/value node pair).
    const g = draftFromEffects([
      enter(`${B}/items/1`, DETAIL(1, 'Alpha widget', 'Active')),
      enter(`${B}/items/2`, DETAIL(2, 'Beta widget', 'Archived'), `${B}/items/1`, DETAIL(1, 'Alpha widget', 'Active')),
    ] as never);
    const s = g.states.find((x) => x.label === 'items')!;
    expect(s.fingerprint.join()).not.toContain('Status: Active');
    expect(s.fingerprint.join()).not.toContain('Status: Archived');
  });
});

// ── fx-wizard-guarded (rows 73 Wizard/multi-step funnel, 74 Check-answers, 75 Confirmation) ──
// 3 GOV.UK-style question-per-page steps + a check-answers review + a terminal confirmation.
// Asserts: the linear navigate chain with `needs`/acceptsInput, the check-answers submit as a
// hard commit-point (needsClassification, never auto-fired — #2/#5a), the confirmation page as
// an unaddressable terminal leaf, and probes the X4 alias hazard (a guarded deep-link redirect).
describe('grammar: 73/74/75 wizard + check-answers + confirmation — chain, commit stop, unaddressable leaf', () => {
  const WB = 'https://wiz.test';
  const WAUTH = ['- heading "Login" [ref=e1]', '- textbox "Username" [ref=e2]', '- textbox "Password" [ref=e3]',
    '- button "Login" [ref=e4]', '- paragraph "Sign in" [ref=e5]', '- link "Forgot" [ref=e6]:\n    - /url: https://wiz.test/auth/forgot',
    '- paragraph "Co" [ref=e7]', '- paragraph "v1" [ref=e8]'].join('\n');
  const STEP1 = ['- heading "Step 1 of 3: Your name" [ref=e1]', '- textbox "Full name" [ref=e2]',
    '- button "Continue" [ref=e3]', '- paragraph "Tell us your name" [ref=e4]', '- paragraph "Required" [ref=e5]',
    '- paragraph "Application" [ref=e6]', '- paragraph "Save and come back later" [ref=e7]', '- paragraph "Government service" [ref=e8]'].join('\n');
  const STEP2 = ['- heading "Step 2 of 3: Your address" [ref=e1]', '- textbox "Address" [ref=e2]',
    '- button "Continue" [ref=e3]', '- paragraph "Where do you live" [ref=e4]', '- paragraph "Required" [ref=e5]',
    '- paragraph "Application" [ref=e6]', '- paragraph "Save and come back later" [ref=e7]', '- paragraph "Government service" [ref=e8]'].join('\n');
  const STEP3 = ['- heading "Step 3 of 3: Your email" [ref=e1]', '- textbox "Email" [ref=e2]',
    '- button "Continue" [ref=e3]', '- paragraph "How can we reach you" [ref=e4]', '- paragraph "Required" [ref=e5]',
    '- paragraph "Application" [ref=e6]', '- paragraph "Save and come back later" [ref=e7]', '- paragraph "Government service" [ref=e8]'].join('\n');
  const CHECK = ['- heading "Check your answers" [ref=e1]', '- paragraph "Name: Ada Lovelace" [ref=e2]',
    '- link "Change name" [ref=e3]:\n    - /url: https://wiz.test/apply/name',
    '- paragraph "Address: 1 Analytical Engine Way" [ref=e4]',
    '- link "Change address" [ref=e5]:\n    - /url: https://wiz.test/apply/address',
    '- button "Accept and send" [ref=e6]', '- paragraph "Review before submitting" [ref=e7]', '- paragraph "Final step" [ref=e8]'].join('\n');
  const DONE = ['- heading "Application complete" [ref=e1]', '- paragraph "Reference: HDJ2123F" [ref=e2]',
    '- paragraph "What happens next" [ref=e3]', '- link "Print this page" [ref=e4]:\n    - /url: https://wiz.test/apply/print',
    '- paragraph "You will receive an email" [ref=e5]', '- paragraph "Keep your reference" [ref=e6]',
    '- paragraph "Contact us if needed" [ref=e7]', '- paragraph "Thank you" [ref=e8]'].join('\n');

  const wenter: StoredActionEffect = { seq: 0, capturedAt: 0, fromUrl: `${WB}/auth/login`, fromSnapshot: WAUTH,
    action: { role: 'button', name: 'Login', ref: 'e4', elementFp: { role: 'button', name: 'Login', near: null } },
    toUrl: `${WB}/apply/name`, toSnapshot: STEP1, navigated: true, diff: { added: [], removed: [] } as any };
  const typeName: StoredActionEffect = { seq: 1, capturedAt: 0, fromUrl: `${WB}/apply/name`, fromSnapshot: STEP1,
    action: { role: 'textbox', name: 'Full name', ref: 'e2', elementFp: { role: 'textbox', name: 'Full name', near: null } },
    toUrl: `${WB}/apply/name`, toSnapshot: STEP1, navigated: false, diff: { added: [], removed: [] } as any };
  const step1to2: StoredActionEffect = { seq: 2, capturedAt: 0, fromUrl: `${WB}/apply/name`, fromSnapshot: STEP1,
    action: { role: 'button', name: 'Continue', ref: 'e3', elementFp: { role: 'button', name: 'Continue', near: null } },
    toUrl: `${WB}/apply/address`, toSnapshot: STEP2, navigated: true, diff: { added: [], removed: [] } as any };
  const step2to3: StoredActionEffect = { seq: 3, capturedAt: 0, fromUrl: `${WB}/apply/address`, fromSnapshot: STEP2,
    action: { role: 'button', name: 'Continue', ref: 'e3', elementFp: { role: 'button', name: 'Continue', near: null } },
    toUrl: `${WB}/apply/email`, toSnapshot: STEP3, navigated: true, diff: { added: [], removed: [] } as any };
  const step3toCheck: StoredActionEffect = { seq: 4, capturedAt: 0, fromUrl: `${WB}/apply/email`, fromSnapshot: STEP3,
    action: { role: 'button', name: 'Continue', ref: 'e3', elementFp: { role: 'button', name: 'Continue', near: null } },
    toUrl: `${WB}/apply/check`, toSnapshot: CHECK, navigated: true, diff: { added: [], removed: [] } as any };
  const submit: StoredActionEffect = { seq: 5, capturedAt: 0, fromUrl: `${WB}/apply/check`, fromSnapshot: CHECK,
    action: { role: 'button', name: 'Accept and send', ref: 'e6', elementFp: { role: 'button', name: 'Accept and send', near: null } },
    toUrl: `${WB}/apply/done`, toSnapshot: DONE, navigated: true, diff: { added: [], removed: [] } as any };

  const g = draftFromEffects([wenter, typeName, step1to2, step2to3, step3toCheck, submit] as never);

  it('the three steps form a linear navigate chain (name -> address -> email -> check)', () => {
    const name = g.states.find((s) => s.label === 'name')!;
    const address = g.states.find((s) => s.label === 'address')!;
    const email = g.states.find((s) => s.label === 'email')!;
    expect(name.affordances.some((a) => a.kind === 'navigate' && a.to === 'address')).toBe(true);
    expect(address.affordances.some((a) => a.kind === 'navigate' && a.to === 'email')).toBe(true);
    expect(email.affordances.some((a) => a.kind === 'navigate' && a.to === 'check')).toBe(true);
  });

  it('step 1\'s Continue navigate carries needs (the typed Full name input) and acceptsInput', () => {
    const name = g.states.find((s) => s.label === 'name')!;
    const cont = name.affordances.find((a) => a.kind === 'navigate' && a.to === 'address')!;
    expect(cont.needs?.length).toBeGreaterThan(0);
    expect(cont.acceptsInput).toBe('credentials');   // the engine's one generic input-slot name
  });

  it('the check-answers submit ("Accept and send") is flagged needsClassification — a hard commit, never auto-fired', () => {
    const check = g.states.find((s) => s.label === 'check')!;
    const acceptSend = check.affordances.find((a) => a.kind === 'navigate' && a.label === 'Accept and send')!;
    expect(acceptSend).toBeTruthy();
    expect(acceptSend.needsClassification).toBe(true);
    expect((acceptSend as any).commit).not.toBe(true);   // candidate flag only — agent classifies (#5a)
  });

  it('the Change links on check-answers navigate BACK into the chain (not a fresh forward step)', () => {
    const check = g.states.find((s) => s.label === 'check')!;
    expect(check.affordances.some((a) => a.kind === 'navigate' && a.to === 'name')).toBe(true);
    expect(check.affordances.some((a) => a.kind === 'navigate' && a.to === 'address')).toBe(true);
  });

  it('the confirmation page is a real state reached after the agent-approved commit', () => {
    const done = g.states.find((s) => s.label === 'done')!;
    expect(done).toBeTruthy();
    // its own fingerprint never rests on the reference number (a per-instance data value).
    expect(done.fingerprint.join()).not.toMatch(/HDJ2123F/);
  });
});

// ── X4 probe: guarded/conditional redirects vs aliases. A deep-link straight to step 3 (skipping
// steps 1-2) gets redirected BACK to step 1 by the site's own guard (out-of-order access denied).
// A1 records requested->settled unconditionally, so this recorded attempt risks minting a FALSE
// alias: apply/email (requested) -> apply/name (settled) — which would wrongly treat "email" and
// "name" as the SAME state. This is the matrix's documented, unresolved hazard (GAPS X4) — the
// fixture demonstrates it happening, not a fix.
describe('grammar: 73 wizard guarded deep-link — X4 alias hazard (unresolved, honest reproduction)', () => {
  const WB = 'https://wiz.test';
  const WAUTH = ['- heading "Login" [ref=e1]', '- textbox "Username" [ref=e2]', '- textbox "Password" [ref=e3]',
    '- button "Login" [ref=e4]', '- paragraph "Sign in" [ref=e5]', '- link "Forgot" [ref=e6]:\n    - /url: https://wiz.test/auth/forgot',
    '- paragraph "Co" [ref=e7]', '- paragraph "v1" [ref=e8]'].join('\n');
  const STEP1 = ['- heading "Step 1 of 3: Your name" [ref=e1]', '- textbox "Full name" [ref=e2]',
    '- button "Continue" [ref=e3]', '- paragraph "Tell us your name" [ref=e4]', '- paragraph "Required" [ref=e5]',
    '- paragraph "Application" [ref=e6]', '- paragraph "Save and come back later" [ref=e7]', '- paragraph "Government service" [ref=e8]'].join('\n');
  const wenter: StoredActionEffect = { seq: 0, capturedAt: 0, fromUrl: `${WB}/auth/login`, fromSnapshot: WAUTH,
    action: { role: 'button', name: 'Login', ref: 'e4', elementFp: { role: 'button', name: 'Login', near: null } },
    toUrl: `${WB}/apply/name`, toSnapshot: STEP1, navigated: true, diff: { added: [], removed: [] } as any };
  // a recorded deep-link attempt at step 3 (out of order) that the SITE'S OWN GUARD redirected
  // back to step 1: requestedUrl=/apply/email, settled toUrl=/apply/name.
  const guardedAttempt: StoredActionEffect = { seq: 1, capturedAt: 0, fromUrl: `${WB}/apply/name`, fromSnapshot: STEP1,
    action: { role: 'link', name: 'deep-link probe', ref: 'e9', elementFp: { role: 'link', name: 'deep-link probe', near: null } },
    requestedUrl: `${WB}/apply/email`, toUrl: `${WB}/apply/name`, toSnapshot: STEP1, navigated: true, diff: { added: [], removed: [] } as any };

  it('reproduces the hazard: the guarded deep-link mints requested(email)->settled(name) as an alias', () => {
    const g = draftFromEffects([wenter, guardedAttempt] as never);
    // today's mechanism (draft.ts alias map) records this pairing unconditionally — there is no
    // guard-vs-genuine-redirect distinction (X4 is unresolved). Only ONE state exists (apply-name);
    // "apply-email" never independently appears BECAUSE the alias folds its key into apply-name's,
    // exactly the false-merge risk the matrix names — never a needs-gated edge or needsFix flag.
    const labels = g.states.map((s) => s.label);
    expect(labels).toContain('apply-name');
    expect(labels).not.toContain('apply-email');
  });
});

// ── fx-login-gate (row 84 Auth/login) — the universal gate. Asserts: creds are wired as `needs`
// + acceptsInput on the submit navigate (NEVER stored as map data), a same-URL failure alert
// stays a data-conditional variant (not a new state per axis 4/5's empty/blank-state precedent),
// and identifier-first (username-only step 1, password-only step 2) splits into two genuine
// structural faces rather than reading as drift.
describe('grammar: 84 auth/login gate — needs-credentials wiring, no phantom drift', () => {
  const LB = 'https://gate.test';
  const LOGIN = ['- heading "Sign in" [ref=e1]', '- textbox "Username" [ref=e2]', '- textbox "Password" [ref=e3]',
    '- button "Login" [ref=e4]', '- checkbox "Remember me" [ref=e5]', '- link "Forgot password?" [ref=e6]:\n    - /url: https://gate.test/auth/forgot',
    '- paragraph "Company" [ref=e7]', '- paragraph "All rights reserved" [ref=e8]'].join('\n');
  const DASH = ['- heading "Dashboard" [ref=e1]', '- link "Reports" [ref=e2]:\n    - /url: https://gate.test/rep/list',
    '- link "Settings" [ref=e3]:\n    - /url: https://gate.test/cfg/settings', '- link "Help" [ref=e4]:\n    - /url: https://gate.test/help/center',
    '- paragraph "Welcome back" [ref=e5]', '- paragraph "Recent activity" [ref=e6]',
    '- paragraph "Overview" [ref=e7]', '- paragraph "Today" [ref=e8]'].join('\n');
  const REPORTS = ['- heading "Reports" [ref=e1]', '- link "Dashboard" [ref=e2]:\n    - /url: https://gate.test/dash/home',
    '- link "Settings" [ref=e3]:\n    - /url: https://gate.test/cfg/settings', '- link "Help" [ref=e4]:\n    - /url: https://gate.test/help/center',
    '- button "New report" [ref=e5]', '- textbox "Search reports" [ref=e6]',
    '- paragraph "Saved reports" [ref=e7]', '- paragraph "3 items" [ref=e8]'].join('\n');
  const SETTINGS = ['- heading "Settings" [ref=e1]', '- link "Dashboard" [ref=e2]:\n    - /url: https://gate.test/dash/home',
    '- link "Reports" [ref=e3]:\n    - /url: https://gate.test/rep/list', '- link "Help" [ref=e4]:\n    - /url: https://gate.test/help/center',
    '- textbox "Display name" [ref=e5]', '- button "Save prefs" [ref=e6]',
    '- paragraph "Preferences" [ref=e7]', '- paragraph "Account" [ref=e8]'].join('\n');
  const HELP = ['- heading "Help" [ref=e1]', '- link "Dashboard" [ref=e2]:\n    - /url: https://gate.test/dash/home',
    '- link "Reports" [ref=e3]:\n    - /url: https://gate.test/rep/list', '- link "Settings" [ref=e4]:\n    - /url: https://gate.test/cfg/settings',
    '- textbox "Ask a question" [ref=e5]', '- button "Contact support" [ref=e6]',
    '- paragraph "FAQ" [ref=e7]', '- paragraph "Guides" [ref=e8]'].join('\n');

  const typeUser: StoredActionEffect = { seq: 0, capturedAt: 0, fromUrl: `${LB}/auth/login`, fromSnapshot: LOGIN,
    action: { role: 'textbox', name: 'Username', ref: 'e2', elementFp: { role: 'textbox', name: 'Username', near: null } },
    toUrl: `${LB}/auth/login`, toSnapshot: LOGIN, navigated: false, diff: { added: [], removed: [] } as any };
  const typePass: StoredActionEffect = { seq: 1, capturedAt: 0, fromUrl: `${LB}/auth/login`, fromSnapshot: LOGIN,
    action: { role: 'textbox', name: 'Password', ref: 'e3', elementFp: { role: 'textbox', name: 'Password', near: null } },
    toUrl: `${LB}/auth/login`, toSnapshot: LOGIN, navigated: false, diff: { added: [], removed: [] } as any };
  const submit: StoredActionEffect = { seq: 2, capturedAt: 0, fromUrl: `${LB}/auth/login`, fromSnapshot: LOGIN,
    action: { role: 'button', name: 'Login', ref: 'e4', elementFp: { role: 'button', name: 'Login', near: null } },
    toUrl: `${LB}/dash/home`, toSnapshot: DASH, navigated: true, diff: { added: [], removed: [] } as any };
  const toReports: StoredActionEffect = { seq: 3, capturedAt: 0, fromUrl: `${LB}/dash/home`, fromSnapshot: DASH,
    action: { role: 'link', name: 'Reports', ref: 'e2', elementFp: { role: 'link', name: 'Reports', near: null } },
    toUrl: `${LB}/rep/list`, toSnapshot: REPORTS, navigated: true, diff: { added: [], removed: [] } as any };
  const toSettings: StoredActionEffect = { seq: 4, capturedAt: 0, fromUrl: `${LB}/dash/home`, fromSnapshot: DASH,
    action: { role: 'link', name: 'Settings', ref: 'e3', elementFp: { role: 'link', name: 'Settings', near: null } },
    toUrl: `${LB}/cfg/settings`, toSnapshot: SETTINGS, navigated: true, diff: { added: [], removed: [] } as any };
  const toHelp: StoredActionEffect = { seq: 5, capturedAt: 0, fromUrl: `${LB}/dash/home`, fromSnapshot: DASH,
    action: { role: 'link', name: 'Help', ref: 'e4', elementFp: { role: 'link', name: 'Help', near: null } },
    toUrl: `${LB}/help/center`, toSnapshot: HELP, navigated: true, diff: { added: [], removed: [] } as any };

  const g = draftFromEffects([typeUser, typePass, submit, toReports, toSettings, toHelp] as never);

  it('username + password wire as input affordances; the submit gets needs + acceptsInput=credentials', () => {
    const login = g.states.find((s) => s.label === 'auth-login')!;
    // "Remember me" is a declared checkbox too (interior synthesis picks it up even though it was
    // never explicitly typed/clicked in this recording) — it's a real page input, just not one of
    // the two RECORDED credential fields the submit's `needs` links back to.
    const inputLabels = login.affordances.filter((a) => a.kind === 'input').map((a) => a.label).sort();
    expect(inputLabels).toEqual(['Password', 'Remember me', 'Username']);
    const nav = login.affordances.find((a) => a.kind === 'navigate')!;
    expect(nav.acceptsInput).toBe('credentials');
    expect(nav.needs?.length).toBe(2);
  });

  it('credentials are NEVER stored as map data (no username/password VALUES appear anywhere)', () => {
    // the map stores the FIELD LABELS (structure), never typed values — there were none recorded
    // as values in this fixture (StoredActionEffect carries no typed value field at all), so this
    // is a structural guarantee: the affordance shape has no value slot to leak from.
    const login = g.states.find((s) => s.label === 'auth-login')!;
    for (const a of login.affordances) {
      expect(JSON.stringify(a)).not.toMatch(/hunter2|p@ssword|secret/i);
    }
  });

  it('the login gate state is reachable but not a phantom duplicate of the dashboard', () => {
    const labels = g.states.map((s) => s.label);
    expect(labels.filter((l) => l === 'auth-login').length).toBe(1);
    expect(labels).toContain('dash-home');
  });
});
