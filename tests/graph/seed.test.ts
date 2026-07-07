import { describe, it, expect } from 'vitest';
import { MapStore } from '../../src/mapstore/store.js';
import { seedGraph, ensureSeeded } from '../../src/graph/seed.js';

// The seed is deliberately MINIMAL: only the saucedemo walk map. A new user builds
// every other site themselves (record -> graph-analyse --draft -> graph-edit).

describe('seedGraph (default — saucedemo only)', () => {
  it('seeds the full saucedemo walk map', () => {
    const s = new MapStore(':memory:');
    seedGraph(s);
    expect(s.getState('www.saucedemo.com:checkout-complete')).not.toBeNull();
    expect(s.statesForNode('www.saucedemo.com').length).toBeGreaterThan(0);
  });

  it('seeds the saucedemo NODE row too (getNode works — needed by dashboard + hosted pack)', () => {
    const s = new MapStore(':memory:');
    seedGraph(s);
    const n = s.getNode('www.saucedemo.com');
    expect(n).not.toBeNull();
    expect(n!.homeUrl).toBe('https://www.saucedemo.com/');
  });

  it('seeds ONLY saucedemo — no other sites, no node-edges', () => {
    const s = new MapStore(':memory:');
    seedGraph(s);
    expect(s.allNodes().map((n) => n.id)).toEqual(['www.saucedemo.com']);
    expect(s.allNodeEdges()).toEqual([]);
  });

  it('is idempotent (re-seeding does not duplicate saucedemo states)', () => {
    const s = new MapStore(':memory:');
    seedGraph(s);
    const before = s.statesForNode('www.saucedemo.com').length;
    seedGraph(s);
    seedGraph(s);
    expect(s.statesForNode('www.saucedemo.com').length).toBe(before);
  });
});

describe('ensureSeeded (guards on saucedemo)', () => {
  it('seeds saucedemo on a fresh store', () => {
    const s = new MapStore(':memory:');
    ensureSeeded(s);
    expect(s.getState('www.saucedemo.com:checkout-complete')).not.toBeNull();
  });

  it('is a no-op cost-wise when already seeded (idempotent)', () => {
    const s = new MapStore(':memory:');
    seedGraph(s);
    const before = s.statesForNode('www.saucedemo.com').length;
    ensureSeeded(s);
    expect(s.statesForNode('www.saucedemo.com').length).toBe(before);
  });

  it('respects a user-touched node: a cleared/re-authored saucedemo is NOT re-seeded', () => {
    // node-clear is the documented re-learn flow; the old state-keyed guard
    // resurrected the seed on every open, colliding with the user's own map
    // (live finding: walk observed 'ambiguous' — seeded inventory + drafted
    // inventory-html both matched the landing page).
    const s = new MapStore(':memory:');
    seedGraph(s);
    s.clearNode('www.saucedemo.com');                      // user re-learns
    ensureSeeded(s);                                       // next process open
    expect(s.statesForNode('www.saucedemo.com').length).toBe(0);   // seed stays gone
    expect(s.getState('www.saucedemo.com:checkout-complete')).toBeNull();
  });
});
