import { describe, it, expect } from 'vitest';
import { MapStore } from '../../src/mapstore/store.js';
import { exploreGitHub } from '../../src/explorer/github-skeleton.js';
import { buildNodeInterior } from '../../src/graph/interior.js';

describe('buildNodeInterior', () => {
  it('returns the GitHub interior states + edges with durable fields', () => {
    const store = new MapStore(':memory:');
    exploreGitHub(store);
    const view = buildNodeInterior(store, 'github.com');
    expect(view.states.map((s) => s.id)).toEqual(
      ['github:repo-detail', 'github:result-list', 'github:search-entry']); // sorted by id
    const detail = view.states.find((s) => s.id === 'github:repo-detail')!;
    expect(detail.role).toBe('detail');
    expect(detail.availableSignals).toContain('stars');
    expect(view.edges).toHaveLength(2);
    expect(view.edges[0]).toHaveProperty('semanticStep');
    expect(view.edges[0]).toHaveProperty('kind');
  });

  it('only includes edges whose endpoints both belong to this node', () => {
    const store = new MapStore(':memory:');
    exploreGitHub(store);
    const view = buildNodeInterior(store, 'github.com');
    const ids = new Set(view.states.map((s) => s.id));
    for (const e of view.edges) { expect(ids.has(e.from)).toBe(true); expect(ids.has(e.to)).toBe(true); }
  });

  it('returns empty states+edges for a node with no interior', () => {
    const store = new MapStore(':memory:');
    expect(buildNodeInterior(store, 'pypi.org')).toEqual({ nodeId: 'pypi.org', states: [], edges: [] });
  });
});
