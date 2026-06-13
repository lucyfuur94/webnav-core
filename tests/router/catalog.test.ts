import { describe, it, expect } from 'vitest';
import { listCoverage } from '../../src/router/catalog.js';
import { MapStore } from '../../src/mapstore/store.js';
import { makeState } from '../../src/mapstore/types.js';
import type { SiteNode } from '../../src/mapstore/types.js';

const node = (id: string, homeUrl: string): SiteNode => ({ id, homeUrl, capabilities: [], topics: [] });

// `list` is the table of contents: the sites webnav has a map for + their state counts.
// It reads the LIVE store (the old gazetteer/goals version always returned empty — a bug).
describe('listCoverage — sites in the map', () => {
  it('returns empty when the store has no sites', () => {
    expect(listCoverage(new MapStore(':memory:'))).toEqual({ sites: [] });
  });

  it('lists each site with its state count, sorted by id', () => {
    const store = new MapStore(':memory:');
    store.upsertNode(node('www.saucedemo.com', 'https://www.saucedemo.com'));
    store.upsertNode(node('a.example.com', 'https://a.example.com'));
    store.upsertState(makeState({ id: 'www.saucedemo.com:login', nodeId: 'www.saucedemo.com', semanticName: 'login', urlPattern: 'https://www.saucedemo.com', role: 'detail' }));
    store.upsertState(makeState({ id: 'www.saucedemo.com:inventory', nodeId: 'www.saucedemo.com', semanticName: 'inventory', urlPattern: 'https://www.saucedemo.com/inventory.html', role: 'result-list' }));
    const c = listCoverage(store);
    expect(c.sites.map((s) => s.site)).toEqual(['a.example.com', 'www.saucedemo.com']);  // sorted
    expect(c.sites.find((s) => s.site === 'www.saucedemo.com')?.states).toBe(2);
    expect(c.sites.find((s) => s.site === 'a.example.com')?.states).toBe(0);
    expect(c.sites.find((s) => s.site === 'www.saucedemo.com')?.homeUrl).toBe('https://www.saucedemo.com');
  });
});
