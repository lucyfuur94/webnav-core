import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MapStore } from '../../src/mapstore/store.js';
import { makeState, makeEdge } from '../../src/mapstore/types.js';

function store(): MapStore { return MapStore.fromDatabase(new Database(':memory:')); }

describe('State.affordances + Edge.core', () => {
  it('round-trips State.affordances', () => {
    const s = store();
    s.upsertState(makeState({ id: 'n:a', nodeId: 'n', semanticName: 'a', urlPattern: '', role: 'detail', affordances: ['add to cart', 'open menu'] }));
    expect(s.getState('n:a')!.affordances).toEqual(['add to cart', 'open menu']);
  });
  it('State.affordances defaults to [] when absent', () => {
    const s = store();
    s.upsertState(makeState({ id: 'n:b', nodeId: 'n', semanticName: 'b', urlPattern: '', role: 'detail' }));
    expect(s.getState('n:b')!.affordances).toEqual([]);
  });
  it('round-trips Edge.core true/false', () => {
    const s = store();
    s.upsertState(makeState({ id: 'n:a', nodeId: 'n', semanticName: 'a', urlPattern: '', role: 'detail' }));
    s.upsertState(makeState({ id: 'n:b', nodeId: 'n', semanticName: 'b', urlPattern: '', role: 'detail' }));
    s.upsertEdge(makeEdge({ fromState: 'n:a', toState: 'n:b', semanticStep: 'go', kind: 'navigate', core: true }));
    s.upsertEdge(makeEdge({ fromState: 'n:a', toState: 'n:b', semanticStep: 'go2', kind: 'navigate' }));
    const edges = s.edgesFrom('n:a');
    expect(edges.find((e) => e.semanticStep === 'go')!.core).toBe(true);
    expect(edges.find((e) => e.semanticStep === 'go2')!.core).toBe(false);
  });
});
