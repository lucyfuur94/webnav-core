import { describe, it, expect } from 'vitest';
import { listCoverage, describePlace } from '../../src/router/catalog.js';

describe('listCoverage (the map table of contents)', () => {
  it('lists known sites, locatable places, and runnable goals', () => {
    const c = listCoverage();
    expect(c.sites).toContain('github.com');
    expect(c.places.length).toBeGreaterThan(0);
    expect(c.places.some((p) => p.place === 'trending repositories')).toBe(true);
    expect(c.goals.some((g) => g.name === 'find-battle-tested-repos')).toBe(true);
  });

  it('reports the signals each goal surfaces', () => {
    const c = listCoverage();
    const goal = c.goals.find((g) => g.name === 'find-battle-tested-repos');
    expect(goal?.surfaces).toEqual(expect.arrayContaining(['stars', 'license']));
  });

  it('every listed place carries its site and url', () => {
    const c = listCoverage();
    for (const p of c.places) {
      expect(p.site).toBeTruthy();
      expect(p.url).toContain('github.com');
    }
  });
});

describe('describePlace (what is at A / what can I do here)', () => {
  it('returns affordances and address for a known place', () => {
    const d = describePlace('trending repositories');
    expect(d.status).toBe('found');
    if (d.status !== 'found') throw new Error('expected found');
    expect(d.url).toBe('https://github.com/trending');
    expect(d.affordances.length).toBeGreaterThan(0);
  });

  it('matches by alias', () => {
    const d = describePlace('repo overview');
    expect(d.status).toBe('found');
    if (d.status !== 'found') throw new Error('expected found');
    expect(d.affordances.join(' ')).toMatch(/stars/i);
  });

  it('returns unknown for an unmapped place', () => {
    expect(describePlace('private billing settings').status).toBe('unknown');
  });
});
