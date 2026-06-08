import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MapStore } from '../../src/mapstore/store.js';
import { makeState, makeEdge, makeAffordance } from '../../src/mapstore/types.js';
import { exploreGitHub } from '../../src/explorer/github-skeleton.js';
import { buildNodeInterior } from '../../src/graph/interior.js';

describe('buildNodeInterior', () => {
  it('returns the GitHub interior states + edges with durable fields', () => {
    const store = new MapStore(':memory:');
    exploreGitHub(store);
    const view = buildNodeInterior(store, 'github.com');
    expect(view.states.map((s) => s.id)).toEqual(
      ['github:repo-detail', 'github:result-list', 'github:search-entry']); // sorted by id
    const detail = view.states.find((s) => s.id === 'github:repo-detail')!;
    expect(detail.role).toBe('detail');
    expect(detail.availableSignals).toContain('stars');
    expect(view.edges).toHaveLength(2);
    expect(view.edges[0]).toHaveProperty('semanticStep');
    expect(view.edges[0]).toHaveProperty('kind');
  });

  it('only includes edges whose endpoints both belong to this node', () => {
    const store = new MapStore(':memory:');
    exploreGitHub(store);
    const view = buildNodeInterior(store, 'github.com');
    const ids = new Set(view.states.map((s) => s.id));
    for (const e of view.edges) { expect(ids.has(e.from)).toBe(true); expect(ids.has(e.to)).toBe(true); }
  });

  it('exposes affordances per state and core per edge', () => {
    const store = MapStore.fromDatabase(new Database(':memory:'));
    store.upsertNode({ id: 'shop.example', homeUrl: 'https://shop.example', capabilities: [], topics: [] });
    store.upsertState(makeState({ id: 'shop.example:inv', nodeId: 'shop.example', semanticName: 'inv', urlPattern: '', role: 'detail',
      affordances: [
        makeAffordance({ id: 'aff_add', label: 'add to cart', kind: 'mutate' }),
        makeAffordance({ id: 'aff_cart', label: 'open cart', kind: 'navigate', toState: 'shop.example:cart' }),
      ] }));
    store.upsertState(makeState({ id: 'shop.example:cart', nodeId: 'shop.example', semanticName: 'cart', urlPattern: '', role: 'detail' }));
    // core lives on the stored edge row; recordOutcome/explorer write it. Seed it.
    store.upsertEdge(makeEdge({ fromState: 'shop.example:inv', toState: 'shop.example:cart', semanticStep: 'open cart', kind: 'navigate', core: true }));
    const iv = buildNodeInterior(store, 'shop.example');
    const inv = iv.states.find((s) => s.semanticName === 'inv')!;
    expect(inv.affordances.map((a) => a.label)).toEqual(['add to cart', 'open cart']);
    expect(inv.affordances.find((a) => a.kind === 'mutate')!.label).toBe('add to cart');
    // The navigate affordance projects to an edge anchored to its row (viaAffordance);
    // the stored edge supplies core=true (matched by from,to,semanticStep).
    const cartEdge = iv.edges.find((e) => e.to === 'shop.example:cart')!;
    expect(cartEdge.viaAffordance).toBe('aff_cart');
    expect(cartEdge.core).toBe(true);
    // mutate affordance does NOT project to an edge.
    expect(iv.edges.every((e) => e.semanticStep !== 'add to cart')).toBe(true);
  });

  it('returns empty states+edges for a node with no interior', () => {
    const store = new MapStore(':memory:');
    expect(buildNodeInterior(store, 'pypi.org')).toEqual({ nodeId: 'pypi.org', states: [], edges: [] });
  });
});
