import { describe, it, expect } from 'vitest';
import { diffSnapshots, didNavigate } from '../../src/explorer/diff.js';
import type { SnapNode } from '../../src/playwright/snapshot.js';

function n(role: string, name: string | null = null, ref: string | null = null): SnapNode {
  return { role, name, ref, url: null, raw: '' };
}

describe('diffSnapshots', () => {
  it('reports added and removed nodes (identity = role|name|ref)', () => {
    const before = [n('button', 'Add to cart', 'e1'), n('heading', 'Products', 'e0')];
    const after = [n('button', 'Remove', 'e1b'), n('heading', 'Products', 'e0'), n('generic', '1', 'e2')];
    const d = diffSnapshots(before, after);
    expect(d.added.map((x) => x.name)).toEqual(expect.arrayContaining(['Remove', '1']));
    expect(d.removed.map((x) => x.name)).toEqual(['Add to cart']);
  });

  it('empty diff when snapshots are identical', () => {
    const a = [n('link', 'Home', 'e1')];
    const d = diffSnapshots(a, [n('link', 'Home', 'e1')]);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });
});

describe('didNavigate', () => {
  it('true when path or host changes', () => {
    expect(didNavigate('https://x.com/inventory.html', 'https://x.com/cart.html')).toBe(true);
    expect(didNavigate('https://x.com/a', 'https://y.com/a')).toBe(true);
  });
  it('false when only query/hash/nothing changes (same page)', () => {
    expect(didNavigate('https://x.com/inventory.html', 'https://x.com/inventory.html')).toBe(false);
    expect(didNavigate('https://x.com/inventory.html', 'https://x.com/inventory.html#x')).toBe(false);
  });
  it('treats an unparseable url change conservatively as navigation', () => {
    expect(didNavigate('https://x.com/a', 'not a url')).toBe(true);
  });
});
