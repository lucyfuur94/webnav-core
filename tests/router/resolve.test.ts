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
});
