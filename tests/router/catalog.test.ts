import { describe, it, expect } from 'vitest';
import { listCoverage, describePlace } from '../../src/router/catalog.js';
import { GITHUB_GAZETTEER } from '../../src/router/locate.js';
import { FIND_BATTLE_TESTED_REPOS } from '../../src/goals/find-battle-tested-repos.js';

// catalog's gazetteer/goals are now INJECTED (defaults are empty — the GitHub
// gazetteer + github-repos goal are parked fixture data, not surfaced by the
// kept `dev list`/`describe` surface). These tests exercise the module logic by
// passing the fixture gazetteer/goal explicitly.

describe('listCoverage (the map table of contents)', () => {
  it('defaults to empty when no gazetteer/goals are injected', () => {
    const c = listCoverage();
    expect(c.sites).toEqual([]);
    expect(c.places).toEqual([]);
    expect(c.goals).toEqual([]);
  });

  it('lists known sites, locatable places, and runnable goals from injected data', () => {
    const c = listCoverage(GITHUB_GAZETTEER, [FIND_BATTLE_TESTED_REPOS]);
    expect(c.sites).toContain('github.com');
    expect(c.places.length).toBeGreaterThan(0);
    expect(c.places.some((p) => p.place === 'trending repositories')).toBe(true);
    expect(c.goals.some((g) => g.name === 'github-repos')).toBe(true);
  });

  it('reports the signals each goal surfaces', () => {
    const c = listCoverage(GITHUB_GAZETTEER, [FIND_BATTLE_TESTED_REPOS]);
    const goal = c.goals.find((g) => g.name === 'github-repos');
    expect(goal?.surfaces).toEqual(expect.arrayContaining(['stars', 'license']));
  });

  it('every listed place carries its site and url', () => {
    const c = listCoverage(GITHUB_GAZETTEER, [FIND_BATTLE_TESTED_REPOS]);
    for (const p of c.places) {
      expect(p.site).toBeTruthy();
      expect(p.url).toContain('github.com');
    }
  });
});

describe('describePlace (what is at A / what can I do here)', () => {
  it('returns affordances and address for a known place', () => {
    const d = describePlace('trending repositories', GITHUB_GAZETTEER);
    expect(d.status).toBe('found');
    if (d.status !== 'found') throw new Error('expected found');
    expect(d.url).toBe('https://github.com/trending');
    expect(d.affordances.length).toBeGreaterThan(0);
  });

  it('matches by alias', () => {
    const d = describePlace('repo overview', GITHUB_GAZETTEER);
    expect(d.status).toBe('found');
    if (d.status !== 'found') throw new Error('expected found');
    expect(d.affordances.join(' ')).toMatch(/stars/i);
  });

  it('returns unknown for an unmapped place', () => {
    expect(describePlace('private billing settings', GITHUB_GAZETTEER).status).toBe('unknown');
  });
});
