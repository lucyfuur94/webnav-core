import { describe, it, expect } from 'vitest';
import { recall } from '../../src/router/router.js';
import { FIND_BATTLE_TESTED_REPOS } from '../../src/goals/find-battle-tested-repos.js';

// A fake browser: returns scripted snapshots per step and counts calls.
function fakeBrowser(snapshots: string[]) {
  let i = 0; let calls = 0;
  return {
    callCount: () => calls,
    nextSnapshot: () => { calls++; return snapshots[Math.min(i++, snapshots.length - 1)]; },
  };
}

describe('recall (evidence only, no ranking)', () => {
  it('returns a done response with an evidence bundle and cost', () => {
    const searchResults = `
- link "tenacity" [ref=e10]:
    - /url: https://github.com/jd/tenacity
- link "urllib3" [ref=e11]:
    - /url: https://github.com/urllib3/urllib3`;
    const repoDetail = `- heading "tenacity" [ref=e1]\n- generic "12,000 stars" [ref=e2]`;
    const browser = fakeBrowser([searchResults, repoDetail, repoDetail]);

    const r = recall({
      query: 'python retry lib',
      goal: FIND_BATTLE_TESTED_REPOS,
      browser,
      extractSignals: () => ({ stars: 12000, license: 'MIT' }),
    });

    expect(r.status).toBe('done');
    if (r.status !== 'done') throw new Error('expected done');
    expect(r.evidence.goal).toBe('find-battle-tested-repos');
    expect(r.evidence.query).toBe('python retry lib');
    expect(r.evidence.candidates.length).toBeGreaterThan(0);
    expect(r.evidence.candidates[0].signals).toHaveProperty('stars');
    // No ranking, no 'why' — that's the agent's job.
    expect(r.evidence.candidates[0]).not.toHaveProperty('why');
    expect(r.evidence.cost.playwright_calls).toBeGreaterThan(0);
  });

  it('respects candidateLimit', () => {
    const many = Array.from({ length: 50 }, (_, k) =>
      `- link "repo${k}" [ref=e${k}]:\n    - /url: https://github.com/o/repo${k}`).join('\n');
    const browser = fakeBrowser([many, '- heading "r" [ref=e1]']);
    const r = recall({
      query: 'x', goal: { ...FIND_BATTLE_TESTED_REPOS, candidateLimit: 5 },
      browser, extractSignals: () => ({ stars: 1 }),
    });
    if (r.status !== 'done') throw new Error('expected done');
    expect(r.evidence.candidates.length).toBe(5);
  });

  it('fails cleanly when the result list has no repo links', () => {
    const browser = fakeBrowser(['- paragraph "no results"']);
    const r = recall({
      query: 'x', goal: FIND_BATTLE_TESTED_REPOS, browser, extractSignals: () => ({}),
    });
    expect(r.status).toBe('failed');
  });

  it('preserves result-list order and excludes non-owner/repo links', () => {
    const results = `
- link "Home" [ref=e1]:
    - /url: https://github.com
- link "beta" [ref=e10]:
    - /url: https://github.com/o/beta
- link "alpha" [ref=e11]:
    - /url: https://github.com/o/alpha`;
    const detail = '- heading "x" [ref=e1]';
    const browser = fakeBrowser([results, detail, detail]);
    const r = recall({
      query: 'x', goal: FIND_BATTLE_TESTED_REPOS, browser, extractSignals: () => ({ stars: 1 }),
    });
    if (r.status !== 'done') throw new Error('expected done');
    // bare github.com link excluded; order is list order (beta before alpha)
    expect(r.evidence.candidates.map((c) => c.id)).toEqual(['o/beta', 'o/alpha']);
  });
});
