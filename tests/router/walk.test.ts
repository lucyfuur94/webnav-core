import { describe, it, expect } from 'vitest';
import { walkRoute, type WalkBrowser } from '../../src/router/walk.js';
import { MapStore } from '../../src/mapstore/store.js';
import { SAUCEDEMO_SKELETON, exploreSaucedemo } from '../../src/explorer/saucedemo-skeleton.js';

// Snapshots that match each state's fingerprint, keyed by the state we're "on".
const SNAP: Record<string, string> = {
  'sd:login': '- textbox "Username" [ref=e1]\n- button "Login" [ref=e2]',
  // Inventory: a unique product link (resolveStep targets it) + the add button
  // (the fingerprint). The product link makes the inventory->cart step resolvable.
  'sd:inventory': '- link "Sauce Labs Backpack" [ref=e9]:\n    - /url: "#"\n- button "Add to cart" [ref=e10]',
  'sd:cart': '- button "Checkout" [ref=e20]',
  'sd:checkout-info': '- textbox "First Name" [ref=e30]\n- button "Continue" [ref=e31]',
  'sd:checkout-overview': '- button "Finish" [ref=e40]',
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
const states = SAUCEDEMO_SKELETON.states;
function freshStore() { const s = new MapStore(':memory:'); exploreSaucedemo(s); return s; }

describe('walkRoute (interactive multi-step walk)', () => {
  // Under the affordance model the saucedemo `inventory -> cart` edge declares
  // `requiresAffordances: ['add an item ...']`, so a walk from login PAUSES at the
  // inventory page for the agent to add an item before opening the cart. (Full
  // resume-through-gates completion is covered by walk-affordance.test.ts and the
  // gated live e2e.)
  it('walks login -> inventory then PAUSES at the add-to-cart affordance gate', async () => {
    const store = freshStore();
    const seq = ['sd:login', 'sd:inventory', 'sd:cart', 'sd:checkout-info', 'sd:checkout-overview', 'sd:checkout-overview'];
    const r = await walkRoute({
      goalName: 'complete-checkout-dryrun', startStateId: 'sd:login',
      goalStateId: 'sd:checkout-overview', store, states, browser: scriptedBrowser(seq),
    });
    expect(r.status).toBe('needs-navigation');
    if (r.status === 'needs-navigation') expect(r.question).toMatch(/add/i);
  });

  it('does not reach the Finish commit point without first clearing the affordance gate', async () => {
    const store = freshStore();
    // Goal is the post-commit state; before any Finish classification the walk must
    // first pause at the add-to-cart affordance gate.
    const seq = ['sd:login', 'sd:inventory', 'sd:cart', 'sd:checkout-info', 'sd:checkout-overview', 'sd:checkout-overview'];
    const r = await walkRoute({
      goalName: 'buy', startStateId: 'sd:login',
      goalStateId: 'sd:purchase-complete', store, states, browser: scriptedBrowser(seq),
    });
    expect(r.status).toBe('needs-navigation');
    if (r.status === 'needs-navigation') expect(r.question).toMatch(/add/i);
  });

  it('escalates needs-navigation when a step lands on an unexpected state', async () => {
    const store = freshStore();
    // After login, jump straight to checkout-overview (skipping inventory) — observed != toState.
    const seq = ['sd:login', 'sd:checkout-overview', 'sd:checkout-overview'];
    const r = await walkRoute({
      goalName: 'x', startStateId: 'sd:login',
      goalStateId: 'sd:checkout-overview', store, states, browser: scriptedBrowser(seq),
    });
    expect(r.status).toBe('needs-navigation');
  });
});
