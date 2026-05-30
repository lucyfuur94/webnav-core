import { describe, it, expect } from 'vitest';
import { locate } from '../../src/router/locate.js';

describe('locate (place lookup — where is A, no navigation)', () => {
  it('finds trending repositories by canonical name', () => {
    const r = locate('trending repositories');
    expect(r.status).toBe('found');
    if (r.status !== 'found') throw new Error('expected found');
    expect(r.coordinate).toEqual({ kind: 'url', url: 'https://github.com/trending' });
  });

  it('finds a place by alias and is case/whitespace insensitive', () => {
    const r = locate('  Trending  ');
    expect(r.status).toBe('found');
    if (r.status !== 'found') throw new Error('expected found');
    expect(r.coordinate).toEqual({ kind: 'url', url: 'https://github.com/trending' });
  });

  it('fills the {repo} slot from an owner/repo token in the query', () => {
    const r = locate('repo facebook/react');
    expect(r.status).toBe('found');
    if (r.status !== 'found') throw new Error('expected found');
    expect(r.coordinate).toEqual({ kind: 'url', url: 'https://github.com/facebook/react' });
  });

  it('returns the repository-search page address', () => {
    const r = locate('search repositories');
    if (r.status !== 'found') throw new Error('expected found');
    expect(r.coordinate).toEqual({ kind: 'url', url: 'https://github.com/search?type=repositories' });
  });

  it('returns unknown for a place not in the gazetteer', () => {
    const r = locate('my private dashboard settings');
    expect(r.status).toBe('unknown');
  });

  it('does not resolve a {repo} place without an owner/repo token', () => {
    // "repository" alone matches the repo entry by name, but has no owner/repo to fill the slot.
    const r = locate('repository');
    expect(r.status).toBe('unknown');
  });
});
