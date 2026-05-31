import { describe, it, expect } from 'vitest';
import { SEARCH_PROVIDERS } from '../../src/router/search-providers.js';

describe('SEARCH_PROVIDERS', () => {
  it('registers marginalia and wiby with working search-url builders', () => {
    const ids = SEARCH_PROVIDERS.map((p) => p.id);
    expect(ids).toContain('marginalia');
    expect(ids).toContain('wiby');
    const m = SEARCH_PROVIDERS.find((p) => p.id === 'marginalia')!;
    expect(m.searchUrl('a b')).toContain('search.marginalia.nu');
    expect(m.searchUrl('a b')).toContain('a%20b');
    const w = SEARCH_PROVIDERS.find((p) => p.id === 'wiby')!;
    expect(w.searchUrl('x')).toBe('https://wiby.me/?q=x');
  });
  it('lists marginalia first (broader index)', () => {
    expect(SEARCH_PROVIDERS[0].id).toBe('marginalia');
  });
});
