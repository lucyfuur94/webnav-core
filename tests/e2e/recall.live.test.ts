import { describe, it, expect } from 'vitest';

const live = process.env.WEBNAV_LIVE === '1';

describe.skipIf(!live)('live recall against GitHub', () => {
  it('returns an evidence bundle of repos with signals', async () => {
    const { runRecallLive } = await import('../../src/router/live.js');
    // Isolated file-backed MapStore so the live run doesn't touch the repo's
    // default webnav.db (the skeleton persists here across runs of this test).
    const dbPath = `tests/tmp/live-${Date.now()}.db`;
    const r = await runRecallLive('python library for retrying flaky HTTP', 5, dbPath);
    expect(r.status).toBe('done');
    if (r.status !== 'done') throw new Error(`expected done, got ${r.status}`);
    expect(r.evidence.candidates.length).toBeGreaterThan(0);
    for (const c of r.evidence.candidates) {
      expect(c.id).toMatch(/.+\/.+/);
      expect(c.url).toContain('github.com');
    }
    expect(r.evidence.cost.playwright_calls).toBeGreaterThan(0);
  }, 120000);
});
