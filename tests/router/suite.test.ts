import { describe, it, expect } from 'vitest';
import { MapStore } from '../../src/mapstore/store.js';
import { makeState, makeEdge, makeAffordance } from '../../src/mapstore/types.js';
import type { WalkBrowser } from '../../src/router/walk.js';
import { parseSuite, runSuite, SuiteConfigError, type SuiteDeps, type Suite } from '../../src/router/suite.js';

// A tiny fixture map: login --> inventory --> cart. The inventory->cart edge is
// GATED (requiresAffordances) so a walk to cart escalates needs-navigation — the
// lever a maxInteractions test pulls. cart carries a commit-point edge for the
// commit-fails test.
const N = 'n';
const STATES = [
  makeState({ id: `${N}:login`, nodeId: N, semanticName: 'login', urlPattern: 'http://x/login',
    role: 'detail', fingerprint: ['textbox:Username', 'button:Login'],
    affordances: [makeAffordance({ id: 'a_login', label: 'log in', kind: 'navigate', toState: `${N}:inventory` })] }),
  makeState({ id: `${N}:inventory`, nodeId: N, semanticName: 'inventory', urlPattern: 'http://x/inv',
    role: 'detail', fingerprint: ['button:Add to cart'],
    affordances: [
      makeAffordance({ id: 'a_cart', label: 'open the shopping cart', kind: 'navigate', toState: `${N}:cart`,
        requiresAffordances: ['add an item'] }),
      makeAffordance({ id: 'a_add', label: 'add an item', kind: 'mutate' }),
      makeAffordance({ id: 'a_new', label: 'New Report', kind: 'mutate' }),
    ] }),
  makeState({ id: `${N}:cart`, nodeId: N, semanticName: 'cart', urlPattern: 'http://x/cart',
    role: 'detail', fingerprint: ['button:Checkout'],
    affordances: [makeAffordance({ id: 'a_finish', label: 'Finish', kind: 'navigate', toState: `${N}:done`, commit: true })] }),
  makeState({ id: `${N}:done`, nodeId: N, semanticName: 'done', urlPattern: 'http://x/done',
    role: 'detail', fingerprint: ['heading:Thanks'] }),
];
const EDGES = [
  makeEdge({ fromState: `${N}:login`, toState: `${N}:inventory`, semanticStep: 'click "Login"', kind: 'safe-reversible' }),
  makeEdge({ fromState: `${N}:inventory`, toState: `${N}:cart`, semanticStep: 'click "Checkout"',
    kind: 'safe-reversible', requiresAffordances: ['add an item'] }),
  makeEdge({ fromState: `${N}:cart`, toState: `${N}:done`, semanticStep: 'click "Finish"', kind: 'unclassified' }),
];
const SNAP: Record<string, string> = {
  [`${N}:login`]: '- textbox "Username" [ref=e1]\n- button "Login" [ref=e2]',
  [`${N}:inventory`]: '- button "Add to cart" [ref=e10]',
  [`${N}:cart`]: '- button "Checkout" [ref=e20]',
  [`${N}:done`]: '- heading "Thanks" [ref=e30]',
};

function freshStore(): MapStore {
  const s = new MapStore(':memory:');
  s.transaction(() => { for (const st of STATES) s.upsertState(st); for (const e of EDGES) s.upsertEdge(e); });
  return s;
}

// A scripted browser that advances through an ordered state sequence on each act().
function scriptedBrowser(seq: string[]): WalkBrowser {
  let i = 0; let calls = 0;
  return {
    snapshot: async () => { calls++; return SNAP[seq[Math.min(i, seq.length - 1)]]; },
    act: async () => { i = Math.min(i + 1, seq.length - 1); },
    callCount: () => calls,
  };
}

function deps(store: MapStore, seq: string[], extra?: Partial<SuiteDeps>): SuiteDeps {
  return { store, states: store.statesForNode(N),
    openCase: async () => ({ browser: scriptedBrowser(seq), close: async () => {} }), ...extra };
}

describe('parseSuite (validation → exit 2 hints)', () => {
  it('accepts a well-formed suite', () => {
    const s = parseSuite({ site: 'x', cases: [{ name: 'c', start: 'login', goal: 'inventory' }] });
    expect(s.site).toBe('x');
    expect(s.cases[0].expect).toBeDefined();
  });
  it('rejects a non-object', () => { expect(() => parseSuite('nope')).toThrow(SuiteConfigError); });
  it('rejects a missing site', () => { expect(() => parseSuite({ cases: [] })).toThrow(/site/); });
  it('rejects empty cases', () => { expect(() => parseSuite({ site: 'x', cases: [] })).toThrow(/cases/); });
  it('rejects a case missing start/goal', () => {
    expect(() => parseSuite({ site: 'x', cases: [{ name: 'c', goal: 'g' }] })).toThrow(/start/);
    expect(() => parseSuite({ site: 'x', cases: [{ name: 'c', start: 's' }] })).toThrow(/goal/);
  });
  it('rejects a negative maxInteractions', () => {
    expect(() => parseSuite({ site: 'x', cases: [{ name: 'c', start: 's', goal: 'g', expect: { maxInteractions: -1 } }] }))
      .toThrow(/maxInteractions/);
  });
});

describe('runSuite', () => {
  it('passes a pure-autopilot case (login -> inventory, maxInteractions 0)', async () => {
    const store = freshStore();
    const suite: Suite = { site: N, cases: [
      { name: 'reach inventory', start: 'login', goal: 'inventory', expect: { status: 'done', maxInteractions: 0 } }] };
    const r = await runSuite(suite, deps(store, [`${N}:login`, `${N}:inventory`]));
    expect(r.status).toBe('ok');
    expect(r.passed).toBe(1);
    expect(r.cases[0].verdict).toBe('pass');
  });

  it('asserts a checkpoint repertoire (pass)', async () => {
    const store = freshStore();
    const suite: Suite = { site: N, cases: [
      { name: 'inv repertoire', start: 'inventory', goal: 'inventory', observe: ['inventory'],
        expect: { maxInteractions: 0,
          checkpoint: { inventory: { repertoireContains: ['New Report', 'open the shopping cart'], kinds: { 'New Report': 'mutate' } } } } }] };
    const r = await runSuite(suite, deps(store, [`${N}:inventory`]));
    expect(r.cases[0].verdict).toBe('pass');
  });

  it('fails a checkpoint whose assertion is wrong', async () => {
    const store = freshStore();
    const suite: Suite = { site: N, cases: [
      { name: 'bad assert', start: 'inventory', goal: 'inventory', observe: ['inventory'],
        expect: { checkpoint: { inventory: { repertoireContains: ['Nonexistent'] } } } }] };
    const r = await runSuite(suite, deps(store, [`${N}:inventory`]));
    expect(r.cases[0].verdict).toBe('fail');
    expect(r.cases[0].failure?.at).toContain('inventory');
    expect(String(r.cases[0].failure?.payload)).toMatch(/Nonexistent/);
  });

  it('fails when a gated step forces a needs-navigation beyond the budget (with payload)', async () => {
    const store = freshStore();
    const suite: Suite = { site: N, cases: [
      { name: 'gated to cart', start: 'inventory', goal: 'cart', expect: { maxInteractions: 0 } }] };
    const r = await runSuite(suite, deps(store, [`${N}:inventory`, `${N}:cart`]));
    expect(r.cases[0].verdict).toBe('fail');
    expect(r.cases[0].failure?.at).toBe('interaction-budget');
    expect((r.cases[0].failure?.payload as any).pause.status).toBe('needs-navigation');
  });

  it('fails at a commit point (needs-classification, never classified safe)', async () => {
    const store = freshStore();
    // Reach cart via a non-gated path is impossible here (gate), so start AT cart and
    // walk to done — the Finish edge is a commit point → walk halts needs-classification.
    const suite: Suite = { site: N, cases: [
      { name: 'never place order', start: 'cart', goal: 'done', expect: { maxInteractions: 0 } }] };
    const r = await runSuite(suite, deps(store, [`${N}:cart`, `${N}:done`]));
    expect(r.cases[0].verdict).toBe('fail');
    expect((r.cases[0].failure?.payload as any).pause.status).toBe('needs-classification');
  });

  it('fails the whole run fast when auth pre-flight is needs-login', async () => {
    const store = freshStore();
    const suite: Suite = { site: N, cases: [
      { name: 'a', start: 'login', goal: 'inventory' },
      { name: 'b', start: 'login', goal: 'inventory' }] };
    const r = await runSuite(suite, deps(store, [`${N}:login`, `${N}:inventory`],
      { preflight: async () => ({ auth: 'needs-login', loginUrl: 'http://x/sso' }) }));
    expect(r.status).toBe('failed');
    expect(r.failed).toBe(2);
    expect(r.cases.every((c) => c.failure?.at === 'preflight')).toBe(true);
    expect(r.preflight?.auth).toBe('needs-login');
  });

  it('runs cases serially and reports mixed pass/fail', async () => {
    const store = freshStore();
    const suite: Suite = { site: N, cases: [
      { name: 'ok', start: 'login', goal: 'inventory', expect: { maxInteractions: 0 } },
      { name: 'unknown state', start: 'nope', goal: 'inventory' }] };
    const r = await runSuite(suite, deps(store, [`${N}:login`, `${N}:inventory`]));
    expect(r.passed).toBe(1);
    expect(r.failed).toBe(1);
    expect(r.cases[1].failure?.at).toBe('resolve');
  });
});
