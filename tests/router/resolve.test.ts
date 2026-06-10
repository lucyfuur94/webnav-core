import { describe, it, expect } from 'vitest';
import { resolveStep } from '../../src/router/resolve.js';
import { parseSnapshot } from '../../src/playwright/snapshot.js';

describe('resolveStep (deterministic)', () => {
  it('matches a step to an element by role+name parsed from the semantic step', () => {
    const nodes = parseSnapshot('- button "Insights" [ref=e42]');
    expect(resolveStep('click "Insights"', nodes)).toBe('e42');
  });
  it('matches a follow-link step by link name', () => {
    const nodes = parseSnapshot('- link "tenacity" [ref=e10]:\n    - /url: https://github.com/jd/tenacity');
    expect(resolveStep('follow link "tenacity"', nodes)).toBe('e10');
  });
  it('returns null when no element matches (caller escalates to agent)', () => {
    const nodes = parseSnapshot('- paragraph "nothing"');
    expect(resolveStep('click "Insights"', nodes)).toBeNull();
  });

  it('falls back to the cached selector NAME when the step name does not match', () => {
    // step name "Open Cart" is absent; the cached healed name "Shopping cart" hits.
    const nodes = parseSnapshot('- button "Shopping cart" [ref=e3]');
    expect(resolveStep('click "Open Cart"', nodes, 'Shopping cart')).toBe('e3');
  });

  it('prefers the step name over the cache when BOTH match', () => {
    const nodes = parseSnapshot('- button "Go" [ref=e1]\n- button "Cached" [ref=e2]');
    expect(resolveStep('click "Go"', nodes, 'Cached')).toBe('e1');
  });

  it('ignores the cache when it is null/empty', () => {
    const nodes = parseSnapshot('- button "Shopping cart" [ref=e3]');
    expect(resolveStep('click "Open Cart"', nodes, null)).toBeNull();
  });
});
