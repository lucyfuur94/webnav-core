import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MapStore } from '../../src/mapstore/store.js';
import { makeState, makeEdge, makeAffordance } from '../../src/mapstore/types.js';

function store(): MapStore { return MapStore.fromDatabase(new Database(':memory:')); }

describe('State.affordances + Edge.core', () => {
  it('round-trips State.affordances (typed)', () => {
    const s = store();
    s.upsertState(makeState({ id: 'n:a', nodeId: 'n', semanticName: 'a', urlPattern: '', role: 'detail',
      affordances: [
        makeAffordance({ id: 'aff_add', label: 'add to cart', kind: 'mutate' }),
        makeAffordance({ id: 'aff_menu', label: 'open menu', kind: 'reveal',
          children: [makeAffordance({ id: 'aff_logout', label: 'Logout', kind: 'navigate', toState: 'n:login' })] }),
      ] }));
    const got = s.getState('n:a')!.affordances;
    expect(got.map((a) => a.label)).toEqual(['add to cart', 'open menu']);
    expect(got[1].kind).toBe('reveal');
    expect(got[1].children!.map((c) => c.label)).toEqual(['Logout']);
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
