import { describe, it, expect } from 'vitest';
import { estimateTokens, tokenSavings } from '../../src/router/tokens.js';

describe('estimateTokens', () => {
  it('estimates ~1 token per 4 chars', () => {
    expect(estimateTokens('a'.repeat(40))).toBe(10);
  });
  it('rounds up partial tokens', () => {
    expect(estimateTokens('abcde')).toBe(2); // 5/4 -> ceil 2
  });
});

describe('tokenSavings', () => {
  it('reports raw vs bundle tokens and a non-negative saving', () => {
    // 4000 chars of raw snapshots the agent avoided; a 200-char bundle it receives.
    const s = tokenSavings(4000, 'x'.repeat(200));
    expect(s.raw_snapshot_tokens).toBe(1000);
    expect(s.bundle_tokens).toBe(50);
    expect(s.tokens_saved).toBe(950);
    expect(s.chars_per_token).toBe(4);
  });

  it('never goes negative when the bundle is larger than the raw input', () => {
    const s = tokenSavings(40, 'x'.repeat(4000));
    expect(s.tokens_saved).toBe(0);
  });
});
