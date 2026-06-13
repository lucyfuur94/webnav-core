import { describe, it, expect } from 'vitest';
import { MapStore } from '../../src/mapstore/store.js';
import { makeState } from '../../src/mapstore/types.js';

describe('states.node_id', () => {
  it('round-trips nodeId through upsert/get', () => {
    const store = new MapStore(':memory:');
    store.upsertState(makeState({ id: 'github:repo-detail', nodeId: 'github.com',
      semanticName: 'github:repo-detail', urlPattern: 'https://github.com/*/*',
      role: 'detail', availableSignals: ['stars'], fingerprint: ['heading'] }));
    const got = store.getState('github:repo-detail');
    expect(got?.nodeId).toBe('github.com');
  });

  it('round-trips declaredShadow (Layer 2) through upsert/get', () => {
    const store = new MapStore(':memory:');
    store.upsertState(makeState({ id: 'x:list', nodeId: 'x.com', semanticName: 'list',
      urlPattern: 'https://x.com/list', role: 'result-list',
      declaredShadow: { collections: [{ heading: 'Employees', columns: ['Id', 'Name'], recordCount: 132 }],
        filters: [{ field: 'Name', control: 'text' }], createsEntity: 'Employees', subTabs: ['List', 'Add'] } }));
    const got = store.getState('x:list');
    expect(got?.declaredShadow?.collections?.[0].columns).toEqual(['Id', 'Name']);
    expect(got?.declaredShadow?.collections?.[0].recordCount).toBe(132);
    expect(got?.declaredShadow?.filters?.[0]).toEqual({ field: 'Name', control: 'text' });
    expect(got?.declaredShadow?.createsEntity).toBe('Employees');
  });

  it('declaredShadow defaults to null when not provided', () => {
    const store = new MapStore(':memory:');
    store.upsertState(makeState({ id: 'x:home', nodeId: 'x.com', semanticName: 'home',
      urlPattern: 'https://x.com', role: 'detail' }));
    expect(store.getState('x:home')?.declaredShadow).toBeNull();
  });
});
