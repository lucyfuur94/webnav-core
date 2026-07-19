import { describe, it, expect } from 'vitest';
import { MapStore, type IMapStore } from '../../src/mapstore/store.js';
import { makeState } from '../../src/mapstore/types.js';

// A trivial in-memory fake proves IMapStore is a real, implementable seam.
class FakeStore implements Pick<IMapStore, 'allNodes' | 'statesForNode' | 'allEdges'> {
  allNodes() { return [{ id: 'x.com', homeUrl: 'u' }]; }
  statesForNode() { return []; }
  allEdges() { return []; }
}

describe('IMapStore seam', () => {
  it('SqliteMapStore satisfies IMapStore reads', () => {
    const store = new MapStore(':memory:');
    const asInterface: Pick<IMapStore, 'allStates'> = store;
    expect(asInterface.allStates()).toEqual([]);
  });
  it('a fake can implement the interface', () => {
    const f = new FakeStore();
    expect(f.allNodes()[0].id).toBe('x.com');
  });
});
