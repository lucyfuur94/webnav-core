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
