import { describe, it, expect } from 'vitest';
import { MapStore } from '../../src/mapstore/store.js';
import { seedGraph } from '../../src/graph/seed.js';
import { hop } from '../../src/graph/hop.js';

function freshSeeded() {
  const s = new MapStore(':memory:');
  seedGraph(s);
  return s;
}

describe('hop', () => {
  it('github -> package-search cluster (pypi) via the hyperlink edge', () => {
    const store = freshSeeded();
    const h = hop(store, 'https://github.com/jd/tenacity', { toCluster: 'package-search' });
    expect(h.status).toBe('hopped');
    expect(h.fromNode).toBe('github.com');
    expect(h.toNode).toBe('pypi.org');
    expect(h.via).toBe('hyperlink');
    expect(h.landingUrl).toBe('https://pypi.org');
  });

  it('hops to a specific node by id', () => {
    const store = freshSeeded();
    const h = hop(store, 'https://github.com/jd/tenacity', { toNode: 'pypi.org' });
    expect(h.status).toBe('hopped');
    expect(h.toNode).toBe('pypi.org');
  });

  it('derives the source node by homeUrl host, not by id (saucedemo)', () => {
    const store = freshSeeded();
    // www.saucedemo.com host matches node 'saucedemo' (id != host).
    const h = hop(store, 'https://www.saucedemo.com/inventory', { toCluster: 'web-search' });
    expect(h.fromNode).toBe('saucedemo');
  });

  it('unknown source -> unknown-source status', () => {
    const store = freshSeeded();
    expect(hop(store, 'https://nope.example/x', { toCluster: 'web-search' }).status)
      .toBe('unknown-source');
  });

  it('no edge toward the cluster -> no-edge', () => {
    const store = freshSeeded();
    const h = hop(store, 'https://www.saucedemo.com/inventory', { toCluster: 'web-search' });
    expect(h.status).toBe('no-edge');
    expect(h.fromNode).toBe('saucedemo');
    expect(h.toNode).toBeNull();
    expect(h.landingUrl).toBeNull();
    expect(h.via).toBeNull();
  });

  it('malformed source url -> unknown-source', () => {
    const store = freshSeeded();
    expect(hop(store, 'not a url', { toCluster: 'web-search' }).status).toBe('unknown-source');
  });
});
