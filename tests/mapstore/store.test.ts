import { describe, it, expect } from 'vitest';
import { MapStore } from '../../src/mapstore/store.js';
import { makeEdge, makeNodeEdge, makeState } from '../../src/mapstore/types.js';

function freshStore() { return new MapStore(':memory:'); }

describe('MapStore', () => {
  it('upserts and retrieves a state', () => {
    const s = freshStore();
    s.upsertState({ id: 'a', semanticName: 'a', urlPattern: 'x', role: 'detail',
      availableSignals: ['stars'], fingerprint: ['heading'] });
    expect(s.getState('a')?.availableSignals).toEqual(['stars']);
  });

  it('upserts an edge and finds it by fromState', () => {
    const s = freshStore();
    s.upsertEdge(makeEdge({ fromState: 'a', toState: 'b', semanticStep: 'go', kind: 'navigate' }));
    expect(s.edgesFrom('a')).toHaveLength(1);
  });

  it('recordSelector writes back the self-heal name onto the edge', () => {
    const s = freshStore();
    s.upsertEdge(makeEdge({ fromState: 'a', toState: 'b', semanticStep: 'click "Open Cart"', kind: 'safe-reversible' }));
    expect(s.edgesFrom('a')[0].selectorCache).toBeNull();
    s.recordSelector('a', 'b', 'click "Open Cart"', 'Shopping cart');
    expect(s.edgesFrom('a')[0].selectorCache).toBe('Shopping cart');
  });

  it('recordSelector is a no-op for an unknown edge (no throw)', () => {
    const s = freshStore();
    expect(() => s.recordSelector('nope', 'x', 'y', 'z')).not.toThrow();
  });

  it('provisional persists through upsertState/getState round-trip', () => {
    const s = freshStore();
    s.upsertState(makeState({ id: 'a', nodeId: 'n', semanticName: 'a', urlPattern: 'x', role: 'detail',
      provisional: 'identity rests on a heading that may be instance data' }));
    expect(s.getState('a')?.provisional).toBe('identity rests on a heading that may be instance data');
  });

  it('provisional defaults to null when not set', () => {
    const s = freshStore();
    s.upsertState(makeState({ id: 'b', nodeId: 'n', semanticName: 'b', urlPattern: 'x', role: 'detail' }));
    expect(s.getState('b')?.provisional).toBeNull();
  });

  // ─── Internet graph (inter-site) ───────────────────────────────────────────
  it('upserts and retrieves a node', () => {
    const s = freshStore();
    s.upsertNode({ id: 'github.com', homeUrl: 'https://github.com' });
    const n = s.getNode('github.com');
    expect(n?.homeUrl).toBe('https://github.com');
  });

  it('upsert is idempotent on node id (updates, no dup)', () => {
    const s = freshStore();
    s.upsertNode({ id: 'x', homeUrl: 'https://a' });
    s.upsertNode({ id: 'x', homeUrl: 'https://b' });
    expect(s.allNodes().length).toBe(1);
    expect(s.getNode('x')?.homeUrl).toBe('https://b');
  });

  it('upserts a node edge and finds it by fromNode', () => {
    const s = freshStore();
    s.upsertNodeEdge(makeNodeEdge({ fromNode: 'a', toNode: 'b', kind: 'hyperlink' }));
    const edges = s.nodeEdgesFrom('a');
    expect(edges).toHaveLength(1);
    expect(edges[0].kind).toBe('hyperlink');
  });

  it('node edge upsert is idempotent on (from,to,kind)', () => {
    const s = freshStore();
    s.upsertNodeEdge(makeNodeEdge({ fromNode: 'a', toNode: 'b', kind: 'hyperlink' }));
    s.upsertNodeEdge(makeNodeEdge({ fromNode: 'a', toNode: 'b', kind: 'hyperlink' }));
    const edges = s.nodeEdgesFrom('a');
    expect(edges).toHaveLength(1);
  });

  it('allNodeEdges returns every edge', () => {
    const s = freshStore();
    s.upsertNodeEdge(makeNodeEdge({ fromNode: 'a.com', toNode: 'b.com', kind: 'hyperlink' }));
    s.upsertNodeEdge(makeNodeEdge({ fromNode: 'b.com', toNode: 'a.com', kind: 'capability' }));
    expect(s.allNodeEdges()).toHaveLength(2);
  });
});
