import { describe, it, expect } from 'vitest';
import { MapStore } from '../../src/mapstore/store.js';
import { GITHUB_SKELETON, exploreGitHub } from '../../src/explorer/github-skeleton.js';

describe('GITHUB_SKELETON (structure only — principle #6)', () => {
  it('has the three structural states and no repo/runtime data', () => {
    const ids = GITHUB_SKELETON.states.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['github:search-entry', 'github:result-list', 'github:repo-detail']));
    const blob = JSON.stringify(GITHUB_SKELETON);
    expect(blob).not.toMatch(/facebook|react|tenacity|python/i);
  });
  it('the search edge accepts the runtime query; the result edge navigates', () => {
    const searchEdge = GITHUB_SKELETON.edges.find((e) => e.fromState === 'github:search-entry');
    expect(searchEdge?.acceptsInput).toBe('query');
    const resultEdge = GITHUB_SKELETON.edges.find((e) => e.fromState === 'github:result-list');
    expect(resultEdge?.kind).toBe('navigate');
  });
});

describe('exploreGitHub persists the skeleton to MapStore', () => {
  it('writes states and edges that can be read back', () => {
    const store = new MapStore(':memory:');
    exploreGitHub(store);
    expect(store.getState('github:repo-detail')?.role).toBe('detail');
    expect(store.edgesFrom('github:search-entry').length).toBeGreaterThan(0);
    expect(store.edgesFrom('github:result-list')[0].kind).toBe('navigate');
  });
  it('is idempotent (re-exploring does not duplicate)', () => {
    const store = new MapStore(':memory:');
    exploreGitHub(store);
    exploreGitHub(store);
    expect(store.edgesFrom('github:search-entry').length).toBe(
      GITHUB_SKELETON.edges.filter((e) => e.fromState === 'github:search-entry').length);
  });
});
