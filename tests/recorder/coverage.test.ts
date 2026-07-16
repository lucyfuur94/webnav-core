import { describe, it, expect } from 'vitest';
import { coverage } from '../../src/recorder/coverage.js';

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
