import { describe, it, expect } from 'vitest';
import { coverage, landingStructure } from '../../src/recorder/coverage.js';

const ev = (seq: number, disposition: string | null, descriptor: Record<string, unknown> = {}) =>
  ({ seq, source: 'human' as const, kind: 'click', descriptor, disposition });

describe('coverage', () => {
  it('splits events into captured vs dropped with human-readable labels', () => {
    const c = coverage([
      ev(0, 'step:0', { leafText: 'Login' }),
      ev(1, 'dropped:unresolved-same-page', { ariaLabel: 'Chart type' }),
      ev(2, null, { name: 'q' }),                       // session ended mid-pair
    ]);
    expect(c.total).toBe(3);
    expect(c.captured).toBe(1);
    expect(c.dropped).toEqual([
      { seq: 1, kind: 'click', label: 'Chart type', reason: 'unresolved-same-page' },
      { seq: 2, kind: 'click', label: 'q', reason: 'unprocessed' },
    ]);
  });
  it('empty ledger → zero coverage, no drops', () => {
    expect(coverage([])).toEqual({ total: 0, captured: 0, dropped: [] });
  });
  it('skips empty-string label candidates, falls through to the next non-empty one', () => {
    const c = coverage([ev(0, 'dropped:unresolved-same-page', { ariaLabel: '', leafText: 'X' })]);
    expect(c.dropped[0].label).toBe('X');
  });
});

describe('landingStructure', () => {
  const eff = (toUrl: string, toSnapshot: string) => ({ toUrl, toSnapshot });

  it('counts named vs nameless interactive nodes per landing', () => {
    const snap = [
      'button "Save" [ref=e1]',
      'button [ref=e2]',
      'link [ref=e3]',
      'heading "Title" [level=1]',   // not in PROBE_ROLES — ignored
    ].join('\n');
    const s = landingStructure([eff('https://x.com/a', snap)]);
    expect(s).toEqual([{ url: 'https://x.com/a', named: 1, nameless: 2 }]);
  });

  it('dedupes landings that share host+pathname (query/hash differ)', () => {
    const snapA = 'button "A" [ref=e1]';
    const snapB = ['button "A" [ref=e1]', 'button [ref=e2]'].join('\n');
    const s = landingStructure([
      eff('https://x.com/list?page=1', snapA),
      eff('https://x.com/list?page=2#frag', snapB),
    ]);
    // same host+pathname → one landing; counts + reported url come from the LAST-seen snapshot for that key
    expect(s).toEqual([{ url: 'https://x.com/list?page=2#frag', named: 1, nameless: 1 }]);
  });

  it('distinct pathnames stay distinct landings', () => {
    const s = landingStructure([
      eff('https://x.com/a', 'button "A" [ref=e1]'),
      eff('https://x.com/b', 'button [ref=e2]'),
    ]);
    expect(s).toEqual([
      { url: 'https://x.com/a', named: 1, nameless: 0 },
      { url: 'https://x.com/b', named: 0, nameless: 1 },
    ]);
  });

  it('empty effects → empty structure', () => {
    expect(landingStructure([])).toEqual([]);
  });
});
