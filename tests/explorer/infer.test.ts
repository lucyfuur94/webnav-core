import { describe, it, expect } from 'vitest';
import { inferUrlModel, proposeTemplates } from '../../src/explorer/infer.js';

describe('inferUrlModel', () => {
  it('infers a multi-segment base shared by ≥80% of urls and merges base-less redirect ghosts', () => {
    const urls = [
      'https://x.test/v3/9999/report/list', 'https://x.test/v3/9999/report/7001/aa11',
      'https://x.test/v3/9999/dashboard/list', 'https://x.test/v3/9999/dashboard/8001',
      'https://x.test/v3/9999/announcements', 'https://x.test/v3/9999/help-center',
      'https://x.test/v3/report/list',           // pre-redirect ghost: missing tenant
    ];
    const m = inferUrlModel(urls);
    expect(m.base).toEqual(['v3', '9999']);
    expect(m.keyOf('https://x.test/v3/report/list')).toBe('/report/list');       // ghost merges
    expect(m.keyOf('https://x.test/v3/9999/report/list?tab=1#x')).toBe('/report/list'); // query/hash dropped
  });
  it('no base when paths share no constant prefix (github-style)', () => {
    const m = inferUrlModel(['https://g.test/facebook/react', 'https://g.test/trending', 'https://g.test/vuejs/vue']);
    expect(m.base).toEqual([]);
    expect(m.keyOf('https://g.test/facebook/react')).toBe('/facebook/react');
  });
});

describe('proposeTemplates', () => {
  it('groups keys equal in all but one position (slug ids too — no digit/hex regex)', () => {
    const groups = proposeTemplates(['/products/blue-widget', '/products/red-widget', '/cart']);
    expect(groups).toEqual([{ template: '/products/{param}', keys: ['/products/blue-widget', '/products/red-widget'], paramPos: 1 }]);
  });
  it('a group is only PROPOSED — /dashboard/list vs /dashboard/8001 still groups here (disposal is structural, draft-side)', () => {
    const groups = proposeTemplates(['/dashboard/list', '/dashboard/8001']);
    expect(groups[0].template).toBe('/dashboard/{param}');
  });
});
