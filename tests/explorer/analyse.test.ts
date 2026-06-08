import { describe, it, expect } from 'vitest';
import { analyseActionEffects } from '../../src/explorer/analyse.js';
import type { StoredActionEffect } from '../../src/mapstore/record.js';

function fx(p: Partial<StoredActionEffect>): StoredActionEffect {
  return {
    fromUrl: 'https://x.com/a', fromSnapshot: '', action: null,
    toUrl: 'https://x.com/a', toSnapshot: '', navigated: false,
    diff: { added: [], removed: [] }, seq: 0, capturedAt: 0, ...p,
  };
}

describe('analyseActionEffects (structure-neutral)', () => {
  it('groups observations by host, imposes NO structure', () => {
    const r = analyseActionEffects([
      fx({ fromUrl: 'https://github.com/x', toUrl: 'https://github.com/x', navigated: false, seq: 0 }),
      fx({ fromUrl: 'https://github.com/x', toUrl: 'https://pypi.org/p', navigated: true, seq: 1 }),
      fx({ fromUrl: 'https://pypi.org/p', toUrl: 'https://pypi.org/p', navigated: false, seq: 2 }),
    ]);
    expect(r.sites.map((s) => s.node).sort()).toEqual(['github.com', 'pypi.org']);
    const gh = r.sites.find((s) => s.node === 'github.com')!;
    expect(gh.observations).toHaveLength(2);
    expect(gh).not.toHaveProperty('states');
    expect(gh).not.toHaveProperty('clusters');
    expect((gh.observations[0] as any)).not.toHaveProperty('stateType');
  });

  it('carries navigated + diff through unchanged', () => {
    const r = analyseActionEffects([
      fx({ fromUrl: 'https://x.com/i', toUrl: 'https://x.com/i', navigated: false,
        action: { role: 'button', name: 'Add to cart', ref: 'e1' },
        diff: { added: [{ role: 'button', name: 'Remove', ref: 'e1b', url: null, raw: '' }], removed: [] } }),
    ]);
    const o = r.sites[0].observations[0];
    expect(o.navigated).toBe(false);
    expect(o.action!.name).toBe('Add to cart');
    expect(o.addedSummary).toContain('button "Remove"');
  });
});
