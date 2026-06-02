import { describe, it, expect } from 'vitest';
import { MapStore } from '../../src/mapstore/store.js';
import { makeState, makeEdge } from '../../src/mapstore/types.js';

function seed(store: MapStore) {
  store.upsertState(makeState({ id: 'github:a', nodeId: 'github.com',
    semanticName: 'github:a', urlPattern: 'u', role: 'search-entry' }));
  store.upsertState(makeState({ id: 'github:b', nodeId: 'github.com',
    semanticName: 'github:b', urlPattern: 'u', role: 'result-list' }));
  store.upsertState(makeState({ id: 'sd:login', nodeId: 'saucedemo',
    semanticName: 'sd:login', urlPattern: 'u', role: 'search-entry' }));
  store.upsertEdge(makeEdge({ fromState: 'github:a', toState: 'github:b',
    semanticStep: 'go', kind: 'navigate' }));
}

describe('store interior reads', () => {
  it('allStates returns every state', () => {
    const store = new MapStore(':memory:'); seed(store);
    expect(store.allStates().map((s) => s.id).sort()).toEqual(['github:a', 'github:b', 'sd:login']);
  });
  it('allEdges returns every edge', () => {
    const store = new MapStore(':memory:'); seed(store);
    expect(store.allEdges()).toHaveLength(1);
    expect(store.allEdges()[0].fromState).toBe('github:a');
  });
  it('statesForNode filters by node_id', () => {
    const store = new MapStore(':memory:'); seed(store);
    expect(store.statesForNode('github.com').map((s) => s.id).sort()).toEqual(['github:a', 'github:b']);
    expect(store.statesForNode('saucedemo').map((s) => s.id)).toEqual(['sd:login']);
  });
});
