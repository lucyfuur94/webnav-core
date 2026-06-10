import { describe, it, expect } from 'vitest';
import { walkRoute, type WalkBrowser } from '../../src/router/walk.js';
import { MapStore } from '../../src/mapstore/store.js';
import { makeState, makeEdge, makeAffordance } from '../../src/mapstore/types.js';

// Self-contained inline fixture (no external skeleton): a small checkout-shaped
// chain of states+edges that mirrors the affordance-gated multi-step walk. The
// `t:*` ids are local to this test; nothing here depends on a seeded site.
const STATES = [
  makeState({ id: 't:login', nodeId: 'n', semanticName: 't:login', urlPattern: '',
    role: 'search-entry', fingerprint: ['textbox:Username', 'button:Login'] }),
  makeState({ id: 't:inventory', nodeId: 'n', semanticName: 't:inventory', urlPattern: '',
    role: 'detail', fingerprint: ['button:Add to cart'],
    affordances: [makeAffordance({ id: 'aff_add', label: 'add an item to the cart', kind: 'mutate' })] }),
  makeState({ id: 't:cart', nodeId: 'n', semanticName: 't:cart', urlPattern: '',
    role: 'detail', fingerprint: ['button:Checkout'] }),
  makeState({ id: 't:checkout-info', nodeId: 'n', semanticName: 't:checkout-info', urlPattern: '',
    role: 'detail', fingerprint: ['textbox:First Name', 'button:Continue'] }),
  makeState({ id: 't:checkout-overview', nodeId: 'n', semanticName: 't:checkout-overview', urlPattern: '',
    role: 'detail', fingerprint: ['button:Finish'] }),
];
const EDGES = [
  makeEdge({ fromState: 't:login', toState: 't:inventory',
    semanticStep: 'log in by clicking "Login"', kind: 'safe-reversible', acceptsInput: 'credentials' }),
  // The affordance gate: opening the cart requires first adding an item.
  makeEdge({ fromState: 't:inventory', toState: 't:cart',
    semanticStep: 'open the shopping cart', kind: 'safe-reversible',
    requiresAffordances: ['add an item to the cart'] }),
  makeEdge({ fromState: 't:cart', toState: 't:checkout-info',
    semanticStep: 'click "Checkout"', kind: 'safe-reversible' }),
  makeEdge({ fromState: 't:checkout-info', toState: 't:checkout-overview',
    semanticStep: 'click "Continue"', kind: 'safe-reversible',
    requiresAffordances: ['enter First Name', 'enter Last Name', 'enter Zip/Postal Code'] }),
  // The COMMIT POINT — tagged unclassified so the walk would HALT here (never fired).
  makeEdge({ fromState: 't:checkout-overview', toState: 't:purchase-complete',
    semanticStep: 'click "Finish"', kind: 'unclassified' }),
];

// Snapshots that match each state's fingerprint, keyed by the state we're "on".
const SNAP: Record<string, string> = {
  't:login': '- textbox "Username" [ref=e1]\n- button "Login" [ref=e2]',
  // Inventory: a unique product link (resolveStep targets it) + the add button
  // (the fingerprint). The product link makes the inventory->cart step resolvable.
  't:inventory': '- link "Sauce Labs Backpack" [ref=e9]:\n    - /url: "#"\n- button "Add to cart" [ref=e10]',
  't:cart': '- button "Checkout" [ref=e20]',
  't:checkout-info': '- textbox "First Name" [ref=e30]\n- button "Continue" [ref=e31]',
  't:checkout-overview': '- button "Finish" [ref=e40]',
};
// A scripted browser: walks through a given ordered list of states, advancing on each act().
// ASYNC to match the real PlaywrightAdapter; act() ignores (ref, inputSlot) and just advances.
function scriptedBrowser(stateSeq: string[]): WalkBrowser {
  let i = 0; let calls = 0;
  return {
    snapshot: async () => { calls++; return SNAP[stateSeq[Math.min(i, stateSeq.length - 1)]]; },
    act: async (_ref: string, _inputSlot: string | null) => { i = Math.min(i + 1, stateSeq.length - 1); },
    callCount: () => calls,
  };
}
const states = STATES;
function freshStore() {
  const s = new MapStore(':memory:');
  s.transaction(() => {
    for (const st of STATES) s.upsertState(st);
    for (const e of EDGES) s.upsertEdge(e);
  });
  return s;
}

describe('walkRoute (interactive multi-step walk)', () => {
  // Under the affordance model the `inventory -> cart` edge declares
  // `requiresAffordances: ['add an item ...']`, so a walk from login PAUSES at the
  // inventory page for the agent to add an item before opening the cart. (Full
  // resume-through-gates completion is covered by walk-affordance.test.ts and the
  // gated live e2e.)
  it('walks login -> inventory then PAUSES at the add-to-cart affordance gate', async () => {
    const store = freshStore();
    const seq = ['t:login', 't:inventory', 't:cart', 't:checkout-info', 't:checkout-overview', 't:checkout-overview'];
    const r = await walkRoute({
      goalName: 'complete-checkout-dryrun', startStateId: 't:login',
      goalStateId: 't:checkout-overview', store, states, browser: scriptedBrowser(seq),
    });
    expect(r.status).toBe('needs-navigation');
    if (r.status === 'needs-navigation') expect(r.question).toMatch(/add/i);
  });

  it('does not reach the Finish commit point without first clearing the affordance gate', async () => {
    const store = freshStore();
    // Goal is the post-commit state; before any Finish classification the walk must
    // first pause at the add-to-cart affordance gate.
    const seq = ['t:login', 't:inventory', 't:cart', 't:checkout-info', 't:checkout-overview', 't:checkout-overview'];
    const r = await walkRoute({
      goalName: 'buy', startStateId: 't:login',
      goalStateId: 't:purchase-complete', store, states, browser: scriptedBrowser(seq),
    });
    expect(r.status).toBe('needs-navigation');
    if (r.status === 'needs-navigation') expect(r.question).toMatch(/add/i);
  });

  it('uses goto() for an addressableUrl edge instead of resolving a ref', async () => {
    const store = new MapStore(':memory:');
    store.upsertState(makeState({ id: 'x:b', nodeId: 'x', semanticName: 'x:b', urlPattern: '', role: 'detail', fingerprint: ['link:on-b'] }));
    // 'a' has an icon-only navigate to 'b' that is URL-addressable: the semanticStep
    // has no quoted name (resolveStep would fail), so the walk MUST jump via goto.
    store.upsertState(makeState({ id: 'x:a', nodeId: 'x', semanticName: 'x:a', urlPattern: '', role: 'detail', fingerprint: ['link:on-a'],
      affordances: [makeAffordance({ id: 'aff_go', label: 'open the cart', kind: 'navigate', toState: 'x:b',
        addressableUrl: 'https://example.test/b' })] }));
    let gotoUrl: string | null = null;
    const seq = ['- link "on-a" [ref=e1]', '- link "on-b" [ref=e2]'];
    let i = 0;
    const browser: WalkBrowser = {
      snapshot: async () => seq[Math.min(i, 1)],
      act: async () => { throw new Error('act() must NOT be called for an addressable jump'); },
      goto: async (url: string) => { gotoUrl = url; i = 1; },
      callCount: () => 0,
    };
    const r = await walkRoute({ goalName: 'g', startStateId: 'x:a', goalStateId: 'x:b', store, states: store.allStates(), browser });
    expect(r.status).toBe('done');
    expect(gotoUrl).toBe('https://example.test/b');
  });

  it('escalates needs-navigation when a step lands on an unexpected state', async () => {
    const store = freshStore();
    // After login, jump straight to checkout-overview (skipping inventory) — observed != toState.
    const seq = ['t:login', 't:checkout-overview', 't:checkout-overview'];
    const r = await walkRoute({
      goalName: 'x', startStateId: 't:login',
      goalStateId: 't:checkout-overview', store, states, browser: scriptedBrowser(seq),
    });
    expect(r.status).toBe('needs-navigation');
  });

  // SELF-HEAL end-to-end (principle #3): a step whose quoted name no longer
  // matches the live page escalates; the agent supplies a ref; webnav writes the
  // chosen element's NAME back to the edge; a SECOND walk then resolves the step
  // deterministically from that cached name — no second escalation.
  it('writes back the agent ref name on resume, then re-resolves it deterministically', async () => {
    const store = new MapStore(':memory:');
    // Two-state route a->b. The step says click "Open Cart", but the live page's
    // button is named "Shopping cart" (drift), so resolveStep MISSES first.
    store.upsertState(makeState({ id: 'h:a', nodeId: 'h', semanticName: 'h:a', urlPattern: '', role: 'detail', fingerprint: ['button:Shopping cart'] }));
    store.upsertState(makeState({ id: 'h:b', nodeId: 'h', semanticName: 'h:b', urlPattern: '', role: 'detail', fingerprint: ['heading:Cart'] }));
    store.upsertEdge(makeEdge({ fromState: 'h:a', toState: 'h:b', semanticStep: 'click "Open Cart"', kind: 'safe-reversible' }));
    const st = store.allStates();

    const PAGE_A = '- button "Shopping cart" [ref=e7]';
    const PAGE_B = '- heading "Cart" [ref=e8]';

    // First walk: on page A, step name "Open Cart" doesn't match -> escalate.
    let onB = false;
    const browser1: WalkBrowser = {
      snapshot: async () => (onB ? PAGE_B : PAGE_A),
      act: async () => { throw new Error('should not act — first walk escalates before acting'); },
      callCount: () => 0,
    };
    const r1 = await walkRoute({ goalName: 'g', startStateId: 'h:a', goalStateId: 'h:b', store, states: st, browser: browser1 });
    expect(r1.status).toBe('needs-navigation');

    // RESUME: the agent picks the real button ref e7. webnav should act + write
    // back the chosen element's NAME ("Shopping cart") as the edge selectorCache.
    const browser2: WalkBrowser = {
      snapshot: async () => (onB ? PAGE_B : PAGE_A),
      act: async () => { onB = true; },
      callCount: () => 0,
    };
    const r2 = await walkRoute({ goalName: 'g', startStateId: 'h:a', goalStateId: 'h:b', store, states: st,
      browser: browser2, answer: { kind: 'ref', ref: 'e7' } });
    expect(r2.status).toBe('done');
    expect(store.edgesFrom('h:a')[0].selectorCache).toBe('Shopping cart');

    // SECOND walk: no answer supplied. The cached name now resolves the step
    // deterministically — it must reach the goal WITHOUT escalating.
    onB = false;
    const browser3: WalkBrowser = {
      snapshot: async () => (onB ? PAGE_B : PAGE_A),
      act: async () => { onB = true; },
      callCount: () => 0,
    };
    const r3 = await walkRoute({ goalName: 'g', startStateId: 'h:a', goalStateId: 'h:b', store, states: st, browser: browser3 });
    expect(r3.status).toBe('done');
  });
});
