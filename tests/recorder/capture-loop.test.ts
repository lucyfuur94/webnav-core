import { describe, it, expect } from 'vitest';
import { runCaptureLoop } from '../../src/recorder/capture-loop.js';
import { parseGaps, buildReviewPrompt } from '../../src/recorder/review.js';

describe('parseGaps', () => {
  it('extracts the gap array from clean JSON, JSON-in-prose, and returns [] on garbage', () => {
    expect(parseGaps('{"gaps":[{"kind":"click"}],"verdict":"x"}')).toHaveLength(1);
    expect(parseGaps('reasoning...\n{"gaps":[],"verdict":"complete"}')).toEqual([]);
    expect(parseGaps('here it is:\n{"gaps":[{"kind":"hover-menu"},{"kind":"scroll"}]}')).toHaveLength(2);
    expect(parseGaps('no json at all')).toEqual([]);
    expect(parseGaps('{broken')).toEqual([]);
  });
});

describe('buildReviewPrompt structured mode', () => {
  it('appends the strict JSON instruction only when structured', () => {
    const plain = buildReviewPrompt('s', [], [], []);
    const struct = buildReviewPrompt('s', [], [], [], undefined, true);
    expect(plain).not.toContain('OUTPUT FORMAT (STRICT)');
    expect(struct).toContain('OUTPUT FORMAT (STRICT)');
    expect(struct).toContain('"gaps"');
  });
});

describe('runCaptureLoop', () => {
  const log = () => {};
  it('stops CLEAN when a round returns zero gaps', async () => {
    let r = 0;
    const res = await runCaptureLoop({
      objective: 'explore', log,
      explore: async () => 's' + (++r),
      review: async () => (r >= 2 ? [] : [{ kind: 'hover-menu' }]),   // round 2 is clean
    });
    expect(res.status).toBe('clean');
    expect(res.rounds).toHaveLength(2);
    expect(res.gaps).toEqual([]);
  });

  it('stops NEEDS-FIX when no NEW gap type appears for 2 rounds', async () => {
    const res = await runCaptureLoop({
      objective: 'explore', log, maxRounds: 5,
      explore: async (n) => 's' + n,
      review: async () => [{ kind: 'canvas', shouldHaveCaptured: 'canvas click' }],  // same gap forever
    });
    expect(res.status).toBe('needs-fix');
    expect(res.gaps.length).toBeGreaterThanOrEqual(1);          // hands over the actionable gaps
  });

  it('stops MAX-ROUNDS if gaps keep changing but never clear', async () => {
    let r = 0;
    const res = await runCaptureLoop({
      objective: 'explore', log, maxRounds: 3,
      explore: async (n) => 's' + n,
      review: async () => [{ kind: 'k' + (++r), shouldHaveCaptured: 'x' + r }],  // a NEW gap type each round
    });
    expect(res.status).toBe('max-rounds');
    expect(res.rounds).toHaveLength(3);
  });

  it('exploration failure → needs-fix, records the null-session round', async () => {
    const res = await runCaptureLoop({
      objective: 'explore', log,
      explore: async () => null, review: async () => [],
    });
    expect(res.status).toBe('needs-fix');
    expect(res.rounds[0].session).toBe(null);
  });
});
