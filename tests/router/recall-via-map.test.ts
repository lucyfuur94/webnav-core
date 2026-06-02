import { describe, it, expect, vi } from 'vitest';
import { recallViaMap } from '../../src/router/recall-via-map.js';
import { MapStore } from '../../src/mapstore/store.js';
import { FIND_BATTLE_TESTED_REPOS } from '../../src/goals/find-battle-tested-repos.js';
import * as skeleton from '../../src/explorer/github-skeleton.js';

function fakeBrowser(snaps: string[]) {
  let i = 0; let calls = 0;
  return { callCount: () => calls, nextSnapshot: () => { calls++; return snaps[Math.min(i++, snaps.length - 1)]; } };
}
const RESULTS = `
- link "tenacity" [ref=e10]:
    - /url: https://github.com/jd/tenacity`;
const DETAIL = '- heading "tenacity" [ref=e1]';

describe('recallViaMap (memory loop)', () => {
  it('does NOT build the skeleton; an empty store has no route', () => {
    const store = new MapStore(':memory:');
    const spy = vi.spyOn(skeleton, 'exploreGitHub');
    const r = recallViaMap({ query: 'retry', goal: FIND_BATTLE_TESTED_REPOS, store,
      browser: fakeBrowser([RESULTS, DETAIL]), extractSignals: () => ({ stars: 1 }) });
    expect(spy).not.toHaveBeenCalled();
    expect(r.status).toBe('failed');
    spy.mockRestore();
  });

  it('does NOT re-explore when the skeleton already exists (criterion #3)', () => {
    const store = new MapStore(':memory:');
    skeleton.exploreGitHub(store); // pre-populate
    const spy = vi.spyOn(skeleton, 'exploreGitHub');
    const r = recallViaMap({ query: 'retry', goal: FIND_BATTLE_TESTED_REPOS, store,
      browser: fakeBrowser([RESULTS, DETAIL]), extractSignals: () => ({ stars: 1 }) });
    expect(spy).not.toHaveBeenCalled();
    expect(r.status).toBe('done');
    spy.mockRestore();
  });

  it('returns the same evidence bundle recall() would (delegation)', () => {
    const store = new MapStore(':memory:');
    skeleton.exploreGitHub(store);
    const r = recallViaMap({ query: 'retry', goal: FIND_BATTLE_TESTED_REPOS, store,
      browser: fakeBrowser([RESULTS, DETAIL]), extractSignals: () => ({ stars: 12000 }) });
    if (r.status !== 'done') throw new Error('expected done');
    expect(r.evidence.candidates[0].id).toBe('jd/tenacity');
    expect(r.evidence.candidates[0].signals).toHaveProperty('stars');
  });
});
