import { describe, it, expect } from 'vitest';
import { MapStore } from '../../src/mapstore/store.js';
import { makeState, makeEdge } from '../../src/mapstore/types.js';
import type { SiteNode } from '../../src/mapstore/types.js';

const node = (id: string, homeUrl: string): SiteNode => ({ id, homeUrl, capabilities: [], topics: [] });

// clearNode wipes a single node's interior (its states + their projected/stored edges) so a
// site can be RE-LEARNED from scratch through webnav — never via raw sqlite. It must touch ONLY
// the target node; other nodes' states/edges survive.
describe('MapStore.clearNode', () => {
  function seed() {
    const store = new MapStore(':memory:');
    store.upsertNode(node('a.com', 'https://a.com'));
    store.upsertNode(node('b.com', 'https://b.com'));
    store.upsertState(makeState({ id: 'a.com:home', nodeId: 'a.com', semanticName: 'home', urlPattern: 'https://a.com', role: 'detail' }));
    store.upsertState(makeState({ id: 'a.com:list', nodeId: 'a.com', semanticName: 'list', urlPattern: 'https://a.com/list', role: 'result-list' }));
    store.upsertState(makeState({ id: 'b.com:home', nodeId: 'b.com', semanticName: 'home', urlPattern: 'https://b.com', role: 'detail' }));
    store.upsertEdge(makeEdge({ fromState: 'a.com:home', toState: 'a.com:list', semanticStep: 'go to list', kind: 'navigate' }));
    store.upsertEdge(makeEdge({ fromState: 'b.com:home', toState: 'b.com:home', semanticStep: 'self', kind: 'navigate' }));
    return store;
  }

  it('removes the target node\'s states', () => {
    const store = seed();
    store.clearNode('a.com');
    expect(store.statesForNode('a.com')).toEqual([]);
    expect(store.getState('a.com:home')).toBeNull();
    expect(store.getState('a.com:list')).toBeNull();
  });

  it('removes the target node\'s edges', () => {
    const store = seed();
    store.clearNode('a.com');
    expect(store.edgesFrom('a.com:home')).toEqual([]);
    expect(store.allEdges().some((e) => e.fromState.startsWith('a.com:'))).toBe(false);
  });

  it('leaves OTHER nodes untouched', () => {
    const store = seed();
    store.clearNode('a.com');
    expect(store.getState('b.com:home')).toBeTruthy();
    expect(store.edgesFrom('b.com:home').length).toBe(1);
    expect(store.getNode('b.com')).toBeTruthy();
  });

  it('keeps the node row itself (only the interior is cleared, ready to re-learn)', () => {
    const store = seed();
    store.clearNode('a.com');
    expect(store.getNode('a.com')).toBeTruthy();   // node stays; its graph is emptied
  });

  it('is a no-op for an unknown node', () => {
    const store = seed();
    expect(() => store.clearNode('nope.com')).not.toThrow();
    expect(store.allStates().length).toBe(3);
  });
});

// removeNode fully DELETES a node — its interior (states/edges) AND the node row itself AND its
// node_edges (both directions) — so a stale/empty site disappears from the dashboard. Touches
// ONLY the target.
describe('MapStore.removeNode', () => {
  function seed() {
    const store = new MapStore(':memory:');
    store.upsertNode(node('a.com', 'https://a.com'));
    store.upsertNode(node('b.com', 'https://b.com'));
    store.upsertState(makeState({ id: 'a.com:home', nodeId: 'a.com', semanticName: 'home', urlPattern: 'https://a.com', role: 'detail' }));
    store.upsertState(makeState({ id: 'b.com:home', nodeId: 'b.com', semanticName: 'home', urlPattern: 'https://b.com', role: 'detail' }));
    store.upsertEdge(makeEdge({ fromState: 'a.com:home', toState: 'a.com:home', semanticStep: 'self', kind: 'navigate' }));
    store.upsertNodeEdge({ fromNode: 'a.com', toNode: 'b.com', kind: 'hyperlink' });
    store.upsertNodeEdge({ fromNode: 'b.com', toNode: 'a.com', kind: 'hyperlink' });
    return store;
  }

  it('deletes the node row, its states, edges, and node_edges (both directions)', () => {
    const store = seed();
    store.removeNode('a.com');
    expect(store.getNode('a.com')).toBeNull();
    expect(store.statesForNode('a.com')).toEqual([]);
    expect(store.allEdges().some((e) => e.fromState.startsWith('a.com'))).toBe(false);
    expect(store.allNodeEdges().some((e) => e.fromNode === 'a.com' || e.toNode === 'a.com')).toBe(false);
  });

  it('leaves OTHER nodes fully intact', () => {
    const store = seed();
    store.removeNode('a.com');
    expect(store.getNode('b.com')).toBeTruthy();
    expect(store.getState('b.com:home')).toBeTruthy();
  });

  it('is a no-op for an unknown node', () => {
    const store = seed();
    expect(() => store.removeNode('nope.com')).not.toThrow();
    expect(store.allNodes().length).toBe(2);
  });

  it('removes an EMPTY node (0 states) — the dashboard-cruft case', () => {
    const store = seed();
    store.upsertNode(node('empty.com', 'https://empty.com'));   // no states
    expect(store.getNode('empty.com')).toBeTruthy();
    store.removeNode('empty.com');
    expect(store.getNode('empty.com')).toBeNull();
  });
});
