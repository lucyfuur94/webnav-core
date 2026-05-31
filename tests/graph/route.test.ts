import { describe, it, expect } from 'vitest';
import { MapStore } from '../../src/mapstore/store.js';
import { seedGraph } from '../../src/graph/seed.js';
import { route } from '../../src/graph/route.js';

function freshSeeded() {
  const s = new MapStore(':memory:');
  seedGraph(s);
  return s;
}

describe('route', () => {
  it('explicit capability returns that cluster', () => {
    const store = freshSeeded();
    const r = route(store, 'anything', 'web-search');
    expect(r.candidates.map((c) => c.node).sort()).toEqual(['duckduckgo', 'marginalia']);
    expect(r.capability).toBe('web-search');
    for (const c of r.candidates) {
      expect(c.cluster).toBe('web-search');
      expect(c.why).toBe('serves web-search');
    }
  });

  it('keyword match: "python" matches pypi topics', () => {
    const store = freshSeeded();
    const r2 = route(store, 'find a python package for retries');
    expect(r2.candidates.some((c) => c.node === 'pypi.org')).toBe(true);
    expect(r2.capability).toBeNull();
    const pypi = r2.candidates.find((c) => c.node === 'pypi.org')!;
    expect(pypi.why).toMatch(/mentions "python"/);
  });

  it('no match -> all nodes offered', () => {
    const store = freshSeeded();
    const r3 = route(store, 'zzzz nonsense');
    expect(r3.candidates.length).toBe(store.allNodes().length);
    for (const c of r3.candidates) {
      expect(c.why).toMatch(/no capability match/);
    }
  });

  it('note disclaims judgment', () => {
    const store = freshSeeded();
    const r = route(store, 'anything', 'web-search');
    expect(r.note).toMatch(/agent decides|does not judge/i);
  });

  it('candidates are stably ordered by node id (convenience only)', () => {
    const store = freshSeeded();
    const r = route(store, 'anything', 'web-search');
    expect(r.candidates.map((c) => c.node)).toEqual(['duckduckgo', 'marginalia']);
  });

  it('returns the request verbatim', () => {
    const store = freshSeeded();
    expect(route(store, 'hello world').request).toBe('hello world');
  });
});
