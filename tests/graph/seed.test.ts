import { describe, it, expect } from 'vitest';
import { MapStore } from '../../src/mapstore/store.js';
import { seedGraph, INTERNET_GRAPH_SEED } from '../../src/graph/seed.js';

function freshSeeded() {
  const s = new MapStore(':memory:');
  seedGraph(s);
  return s;
}

describe('seedGraph', () => {
  it('seeds the github.com node', () => {
    const s = freshSeeded();
    const gh = s.getNode('github.com');
    expect(gh).not.toBeNull();
    expect(gh!.homeUrl).toBe('https://github.com');
  });

  it('puts marginalia and duckduckgo in the web-search cluster', () => {
    const s = freshSeeded();
    const ids = s.nodesByCapability('web-search').map((n) => n.id).sort();
    expect(ids).toEqual(['duckduckgo', 'marginalia']);
  });

  it('does not false-match capability substrings (membership, not LIKE)', () => {
    const s = freshSeeded();
    // 'search' is a substring of web-search/code-search/repo-search/package-search
    // but is NOT a declared capability of any node → no matches.
    expect(s.nodesByCapability('search')).toEqual([]);
  });

  it('seeds the github.com -> pypi.org hyperlink edge', () => {
    const s = freshSeeded();
    const edge = s.nodeEdgesFrom('github.com').find((e) => e.toNode === 'pypi.org');
    expect(edge).toBeDefined();
    expect(edge!.kind).toBe('hyperlink');
  });

  it('seeds bidirectional capability edges between the web-search nodes', () => {
    const s = freshSeeded();
    expect(s.nodeEdgesFrom('marginalia').some((e) => e.toNode === 'duckduckgo' && e.kind === 'capability')).toBe(true);
    expect(s.nodeEdgesFrom('duckduckgo').some((e) => e.toNode === 'marginalia' && e.kind === 'capability')).toBe(true);
  });

  it('is structure-only — every edge weight is 1 (no learned judgment yet)', () => {
    for (const e of INTERNET_GRAPH_SEED.edges) {
      expect(e.weight).toBe(1);
    }
  });

  it('is idempotent (re-seeding does not duplicate nodes/edges)', () => {
    const s = freshSeeded();
    const nodesBefore = s.allNodes().length;
    const edgesBefore = s.nodeEdgesFrom('marginalia').length;
    seedGraph(s);
    seedGraph(s);
    expect(s.allNodes().length).toBe(nodesBefore);
    expect(s.nodeEdgesFrom('marginalia').length).toBe(edgesBefore);
  });
});
