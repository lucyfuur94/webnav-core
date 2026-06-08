import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MapStore } from '../../src/mapstore/store.js';
import { editGraph } from '../../src/graph/edit.js';

function freshStore(): MapStore {
  return MapStore.fromDatabase(new Database(':memory:'));
}

describe('editGraph', () => {
  it('creates the node if new and upserts states + edges', () => {
    const store = freshStore();
    const r = editGraph(store, 'example.com', {
      states: [{ label: 'home', fingerprint: ['link'] }, { label: 'detail', urlPattern: 'example.com/*' }],
      edges: [{ from: 'home', to: 'detail', via: 'follow a result link' }],
    });
    expect(r).toMatchObject({ node: 'example.com', statesWritten: 2, edgesWritten: 1 });
    expect(store.getNode('example.com')).not.toBeNull();
    expect(store.getState('example.com:detail')!.nodeId).toBe('example.com');
    const edges = store.edgesFrom('example.com:home');
    expect(edges[0]).toMatchObject({ toState: 'example.com:detail', kind: 'navigate' });
  });

  it('marks a needsInput edge unclassified and records why in the step', () => {
    const store = freshStore();
    editGraph(store, 'example.com', {
      states: [{ label: 'detail' }, { label: 'login' }],
      edges: [{ from: 'detail', to: 'login', via: 'click Sign in', needsInput: true, why: 'requires credentials' }],
    });
    const e = store.edgesFrom('example.com:detail')[0];
    expect(e.kind).toBe('unclassified');
    expect(e.semanticStep).toContain('needs-input: requires credentials');
  });

  it('links to an already-stored state without re-declaring it', () => {
    const store = freshStore();
    editGraph(store, 'example.com', { states: [{ label: 'a' }], edges: [] });
    const r = editGraph(store, 'example.com', {
      states: [{ label: 'b' }], edges: [{ from: 'b', to: 'a', via: 'go' }],
    });
    expect(r.edgesWritten).toBe(1);
    expect(store.edgesFrom('example.com:b')[0].toState).toBe('example.com:a');
  });

  it('persists requiresAffordances on an edge', () => {
    const store = MapStore.fromDatabase(new Database(':memory:'));
    editGraph(store, 'example.com', {
      states: [{ label: 'inventory' }, { label: 'cart' }],
      edges: [{ from: 'inventory', to: 'cart', via: 'open cart', requiresAffordances: ['add an item'] }],
    });
    const e = store.edgesFrom('example.com:inventory')[0];
    expect(e.requiresAffordances).toEqual(['add an item']);
  });

  it('throws on an edge endpoint that is neither in the payload nor stored', () => {
    const store = freshStore();
    expect(() => editGraph(store, 'example.com', {
      states: [{ label: 'a' }], edges: [{ from: 'a', to: 'ghost', via: 'go' }],
    })).toThrow(/ghost/);
  });
});
