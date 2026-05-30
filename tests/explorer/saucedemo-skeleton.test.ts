import { describe, it, expect } from 'vitest';
import { MapStore } from '../../src/mapstore/store.js';
import { SAUCEDEMO_SKELETON, exploreSaucedemo } from '../../src/explorer/saucedemo-skeleton.js';

describe('SAUCEDEMO_SKELETON (structure only — principle #6)', () => {
  it('has the five recognized states plus the post-commit target', () => {
    const ids = SAUCEDEMO_SKELETON.states.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining([
      'sd:login', 'sd:inventory', 'sd:cart', 'sd:checkout-info', 'sd:checkout-overview',
    ]));
    // 5 fingerprinted states authored in the skeleton (purchase-complete is the
    // goal target reached only via the Finish edge; it is not a recognized state).
    expect(SAUCEDEMO_SKELETON.states.length).toBe(5);
  });

  it('the login route is a linear chain of edges to checkout-overview, then Finish', () => {
    const fromIds = SAUCEDEMO_SKELETON.edges.map((e) => e.fromState);
    expect(fromIds).toEqual(expect.arrayContaining([
      'sd:login', 'sd:inventory', 'sd:cart', 'sd:checkout-info', 'sd:checkout-overview',
    ]));
    // Each non-goal state has exactly one outgoing edge (linear route).
    for (const from of ['sd:login', 'sd:inventory', 'sd:cart', 'sd:checkout-info', 'sd:checkout-overview']) {
      expect(SAUCEDEMO_SKELETON.edges.filter((e) => e.fromState === from).length).toBe(1);
    }
  });

  it('the Finish edge is the unclassified commit point webnav must never fire', () => {
    const finish = SAUCEDEMO_SKELETON.edges.find((e) => e.fromState === 'sd:checkout-overview');
    expect(finish?.toState).toBe('sd:purchase-complete');
    expect(finish?.kind).toBe('unclassified');
    expect(finish?.semanticStep).toMatch(/Finish/i);
  });

  it('declares which steps accept runtime input slots (no values stored)', () => {
    const login = SAUCEDEMO_SKELETON.edges.find((e) => e.fromState === 'sd:login');
    expect(login?.acceptsInput).toBe('credentials');
    const shipping = SAUCEDEMO_SKELETON.edges.find((e) => e.fromState === 'sd:checkout-info');
    expect(shipping?.acceptsInput).toBe('shipping');
  });

  it('is structure-only: no credentials, names, zips, or other runtime values', () => {
    const blob = JSON.stringify(SAUCEDEMO_SKELETON);
    expect(blob).not.toMatch(/standard_user|secret_sauce|password/i);
    expect(blob).not.toMatch(/\b\d{5}\b/); // no zip codes
  });
});

describe('exploreSaucedemo persists the skeleton to MapStore', () => {
  it('writes states and edges that can be read back', () => {
    const store = new MapStore(':memory:');
    exploreSaucedemo(store);
    expect(store.getState('sd:login')?.role).toBe('search-entry');
    expect(store.getState('sd:checkout-overview')?.availableSignals).toEqual(['total']);
    expect(store.edgesFrom('sd:login')[0].toState).toBe('sd:inventory');
    expect(store.edgesFrom('sd:checkout-overview')[0].kind).toBe('unclassified');
  });

  it('is idempotent (re-exploring does not duplicate)', () => {
    const store = new MapStore(':memory:');
    exploreSaucedemo(store);
    exploreSaucedemo(store);
    expect(store.edgesFrom('sd:login').length).toBe(1);
    expect(store.edgesFrom('sd:checkout-overview').length).toBe(1);
  });
});
