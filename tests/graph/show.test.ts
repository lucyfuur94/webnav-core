import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MapStore } from '../../src/mapstore/store.js';
import { editGraph } from '../../src/graph/edit.js';
import { showInterior } from '../../src/graph/show.js';

describe('showInterior', () => {
  it('returns the states + edges stored for a node', () => {
    const store = MapStore.fromDatabase(new Database(':memory:'));
    editGraph(store, 'example.com', {
      states: [{ label: 'home' }, { label: 'detail' }],
      edges: [{ from: 'home', to: 'detail', via: 'go' }],
    });
    const r = showInterior(store, 'example.com');
    expect(r.node).toBe('example.com');
    expect(r.states.map((s) => s.semanticName).sort()).toEqual(['detail', 'home']);
    expect(r.edges).toHaveLength(1);
    expect(r.edges[0]).toMatchObject({ fromState: 'example.com:home', toState: 'example.com:detail' });
  });

  it('returns empty arrays for an unknown node', () => {
    const store = MapStore.fromDatabase(new Database(':memory:'));
    const r = showInterior(store, 'nope.com');
    expect(r.states).toEqual([]);
    expect(r.edges).toEqual([]);
  });
});
