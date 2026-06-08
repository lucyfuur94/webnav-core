import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MapStore } from '../../src/mapstore/store.js';
import { makeState, makeEdge } from '../../src/mapstore/types.js';

function store(): MapStore { return MapStore.fromDatabase(new Database(':memory:')); }

describe('Edge.requiresAffordances', () => {
  it('round-trips a non-empty requiresAffordances list', () => {
    const s = store();
    s.upsertState(makeState({ id: 'n:a', nodeId: 'n', semanticName: 'a', urlPattern: '', role: 'detail' }));
    s.upsertState(makeState({ id: 'n:b', nodeId: 'n', semanticName: 'b', urlPattern: '', role: 'detail' }));
    s.upsertEdge(makeEdge({ fromState: 'n:a', toState: 'n:b', semanticStep: 'go', kind: 'navigate',
      requiresAffordances: ['add an item to the cart'] }));
    expect(s.edgesFrom('n:a')[0].requiresAffordances).toEqual(['add an item to the cart']);
  });

  it('defaults to an empty array when absent', () => {
    const s = store();
    s.upsertState(makeState({ id: 'n:a', nodeId: 'n', semanticName: 'a', urlPattern: '', role: 'detail' }));
    s.upsertState(makeState({ id: 'n:b', nodeId: 'n', semanticName: 'b', urlPattern: '', role: 'detail' }));
    s.upsertEdge(makeEdge({ fromState: 'n:a', toState: 'n:b', semanticStep: 'go', kind: 'navigate' }));
    expect(s.edgesFrom('n:a')[0].requiresAffordances).toEqual([]);
  });
});
