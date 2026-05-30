import { describe, it, expect } from 'vitest';
import { extractRepoSignals } from '../../src/router/extract.js';

describe('extractRepoSignals', () => {
  it('pulls a star count from a repo-detail snapshot', () => {
    const yml = `- heading "tenacity" [ref=e1]\n- link "12.3k stars" [ref=e2]\n- generic "MIT License" [ref=e3]`;
    const sig = extractRepoSignals(yml, ['stars', 'license']);
    expect(sig.stars).toBe(12300);
    expect(sig.license).toBe('MIT License');
  });
  it('omits signals not present (never fabricates)', () => {
    const sig = extractRepoSignals('- heading "x" [ref=e1]', ['stars', 'license']);
    expect(sig).not.toHaveProperty('stars');
  });
});
