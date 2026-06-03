import { describe, it, expect } from 'vitest';
import { resolveEntry } from '../../src/router/live.js';

describe('resolveEntry', () => {
  it('fills the {query} slot, url-encoded', () => {
    const url = resolveEntry('https://github.com/search?q={query}&type=repositories', 'python retry');
    expect(url).toBe('https://github.com/search?q=python%20retry&type=repositories');
  });

  it('returns the template unchanged when there is no {query} slot', () => {
    expect(resolveEntry('https://example.com/feed', 'ignored')).toBe('https://example.com/feed');
  });
});
