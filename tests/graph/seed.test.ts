import { describe, it, expect } from 'vitest';
import { MapStore } from '../../src/mapstore/store.js';
import { seedGraph, seedGitHubAndGraph, ensureSeeded, INTERNET_GRAPH_SEED } from '../../src/graph/seed.js';

// The DEFAULT seed (seedGraph / ensureSeeded) is deliberately MINIMAL: only the
// saucedemo walk map. GitHub + the internet graph are opt-in via seedGitHubAndGraph.

describe('seedGraph (default — saucedemo only)', () => {
  it('seeds the full saucedemo walk map', () => {
    const s = new MapStore(':memory:');
    seedGraph(s);
    expect(s.getState('www.saucedemo.com:checkout-complete')).not.toBeNull();
    expect(s.statesForNode('www.saucedemo.com').length).toBeGreaterThan(0);
  });

  it('seeds the saucedemo NODE row too (getNode works — needed by dashboard + hosted pack)', () => {
    const s = new MapStore(':memory:');
    seedGraph(s);
    const n = s.getNode('www.saucedemo.com');
    expect(n).not.toBeNull();
    expect(n!.homeUrl).toBe('https://www.saucedemo.com/');
  });

  it('does NOT seed GitHub or the internet-graph nodes by default', () => {
    const s = new MapStore(':memory:');
    seedGraph(s);
    expect(s.getNode('github.com')).toBeNull();
    expect(s.getState('github:repo-detail')).toBeNull();
    expect(s.allNodeEdges()).toEqual([]);
  });

  it('is idempotent (re-seeding does not duplicate saucedemo states)', () => {
    const s = new MapStore(':memory:');
    seedGraph(s);
    const before = s.statesForNode('www.saucedemo.com').length;
    seedGraph(s);
    seedGraph(s);
    expect(s.statesForNode('www.saucedemo.com').length).toBe(before);
  });
});

describe('ensureSeeded (guards on saucedemo)', () => {
  it('seeds saucedemo on a fresh store', () => {
    const s = new MapStore(':memory:');
    ensureSeeded(s);
    expect(s.getState('www.saucedemo.com:checkout-complete')).not.toBeNull();
  });

  it('is a no-op cost-wise when already seeded (idempotent)', () => {
    const s = new MapStore(':memory:');
    seedGraph(s);
    const before = s.statesForNode('www.saucedemo.com').length;
    ensureSeeded(s);
    expect(s.statesForNode('www.saucedemo.com').length).toBe(before);
  });
});

describe('seedGitHubAndGraph (opt-in — GitHub recall + internet graph)', () => {
  function ghSeeded() {
    const s = new MapStore(':memory:');
    seedGitHubAndGraph(s);
    return s;
  }

  it('seeds the github.com node', () => {
    const gh = ghSeeded().getNode('github.com');
    expect(gh).not.toBeNull();
    expect(gh!.homeUrl).toBe('https://github.com');
  });

  it('seeds the GitHub interior (recall skeleton), not just the node', () => {
    const s = ghSeeded();
    expect(s.statesForNode('github.com').length).toBeGreaterThan(0);
    expect(s.getState('github:repo-detail')).not.toBeNull();
  });

  it('seeds the github-repos goal', () => {
    expect(ghSeeded().getGoal('github-repos')).not.toBeNull();
  });

  it('puts marginalia and duckduckgo in the web-search cluster', () => {
    const ids = ghSeeded().nodesByCapability('web-search').map((n) => n.id).sort();
    expect(ids).toEqual(['duckduckgo', 'marginalia']);
  });

  it('does not false-match capability substrings (membership, not LIKE)', () => {
    expect(ghSeeded().nodesByCapability('search')).toEqual([]);
  });

  it('seeds the github.com -> pypi.org hyperlink edge', () => {
    const edge = ghSeeded().nodeEdgesFrom('github.com').find((e) => e.toNode === 'pypi.org');
    expect(edge).toBeDefined();
    expect(edge!.kind).toBe('hyperlink');
  });

  it('seeds bidirectional capability edges between the web-search nodes', () => {
    const s = ghSeeded();
    expect(s.nodeEdgesFrom('marginalia').some((e) => e.toNode === 'duckduckgo' && e.kind === 'capability')).toBe(true);
    expect(s.nodeEdgesFrom('duckduckgo').some((e) => e.toNode === 'marginalia' && e.kind === 'capability')).toBe(true);
  });

  it('is structure-only — every edge weight is 1 (no learned judgment yet)', () => {
    for (const e of INTERNET_GRAPH_SEED.edges) expect(e.weight).toBe(1);
  });

  it('is idempotent (re-seeding does not duplicate nodes/edges)', () => {
    const s = ghSeeded();
    const nodesBefore = s.allNodes().length;
    const edgesBefore = s.nodeEdgesFrom('marginalia').length;
    seedGitHubAndGraph(s);
    expect(s.allNodes().length).toBe(nodesBefore);
    expect(s.nodeEdgesFrom('marginalia').length).toBe(edgesBefore);
  });
});
