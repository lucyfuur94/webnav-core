import { describe, it, expect } from 'vitest';
import { MapStore } from '../../src/mapstore/store.js';
import { makeEdge, makeNodeEdge } from '../../src/mapstore/types.js';
import { seedGraph, INTERNET_GRAPH_SEED } from '../../src/graph/seed.js';

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

  it('record_outcome updates reliability', () => {
    const s = freshStore();
    s.upsertEdge(makeEdge({ fromState: 'a', toState: 'b', semanticStep: 'go', kind: 'navigate' }));
    s.recordOutcome('a', 'b', 'go', true);
    s.recordOutcome('a', 'b', 'go', false);
    const e = s.edgesFrom('a')[0];
    expect(e.successCount).toBe(1);
    expect(e.failCount).toBe(1);
    expect(e.reliability).toBeCloseTo(0.5);
    expect(e.lastVerified).not.toBeNull();
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

  it('decayConfidence lowers confidence for old edges', () => {
    const s = freshStore();
    s.upsertEdge(makeEdge({ fromState: 'a', toState: 'b', semanticStep: 'go', kind: 'navigate',
      lastVerified: 1, confidence: 1 }));
    s.decayConfidence(1000 * 60 * 60 * 24 * 30); // 30 days later, halfLife default
    expect(s.edgesFrom('a')[0].confidence).toBeLessThan(1);
  });

  it('stores and retrieves a goal', () => {
    const s = freshStore();
    s.upsertGoal({ name: 'g', site: null, entry: null, extractor: null, visit: ['detail'], surface: { detail: ['stars'] }, candidateLimit: 5 });
    expect(s.getGoal('g')?.candidateLimit).toBe(5);
  });

  // ─── Internet graph (inter-site) ───────────────────────────────────────────
  it('upserts and retrieves a node', () => {
    const s = freshStore();
    s.upsertNode({ id: 'github.com', homeUrl: 'https://github.com',
      capabilities: ['code-search'], topics: ['code'] });
    const n = s.getNode('github.com');
    expect(n?.homeUrl).toBe('https://github.com');
    expect(n?.capabilities).toEqual(['code-search']);
    expect(n?.topics).toEqual(['code']);
  });

  it('upsert is idempotent on node id (updates, no dup)', () => {
    const s = freshStore();
    s.upsertNode({ id: 'x', homeUrl: 'https://a', capabilities: ['c'], topics: [] });
    s.upsertNode({ id: 'x', homeUrl: 'https://b', capabilities: ['d'], topics: [] });
    expect(s.allNodes().length).toBe(1);
    expect(s.getNode('x')?.homeUrl).toBe('https://b');
  });

  it('nodesByCapability tests array membership, not substring', () => {
    const s = freshStore();
    s.upsertNode({ id: 'a', homeUrl: 'https://a', capabilities: ['web-search'], topics: [] });
    s.upsertNode({ id: 'b', homeUrl: 'https://b', capabilities: ['code-search'], topics: [] });
    expect(s.nodesByCapability('web-search').map((n) => n.id)).toEqual(['a']);
    // 'search' is a substring of both capabilities but a member of neither.
    expect(s.nodesByCapability('search')).toEqual([]);
  });

  it('upserts a node edge and finds it by fromNode', () => {
    const s = freshStore();
    s.upsertNodeEdge(makeNodeEdge({ fromNode: 'a', toNode: 'b', kind: 'hyperlink' }));
    const edges = s.nodeEdgesFrom('a');
    expect(edges).toHaveLength(1);
    expect(edges[0].kind).toBe('hyperlink');
    expect(edges[0].weight).toBe(1);
  });

  it('node edge upsert is idempotent on (from,to,kind)', () => {
    const s = freshStore();
    s.upsertNodeEdge(makeNodeEdge({ fromNode: 'a', toNode: 'b', kind: 'hyperlink' }));
    s.upsertNodeEdge(makeNodeEdge({ fromNode: 'a', toNode: 'b', kind: 'hyperlink', weight: 2 }));
    const edges = s.nodeEdgesFrom('a');
    expect(edges).toHaveLength(1);
    expect(edges[0].weight).toBe(2);
  });

  it('allNodeEdges returns every edge', () => {
    const s = freshStore();
    seedGraph(s);
    expect(s.allNodeEdges()).toHaveLength(INTERNET_GRAPH_SEED.edges.length);
  });
});
