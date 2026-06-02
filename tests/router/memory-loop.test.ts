import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, unlinkSync } from 'node:fs';
import { recallViaMap } from '../../src/router/recall-via-map.js';
import { MapStore } from '../../src/mapstore/store.js';
import { FIND_BATTLE_TESTED_REPOS } from '../../src/goals/find-battle-tested-repos.js';
import { seedGraph } from '../../src/graph/seed.js';
import * as skeleton from '../../src/explorer/github-skeleton.js';

// Pull-based snapshot stream identical to recall()'s tests. Reset per run so the
// SAME fake browser script (results + one detail) feeds each recallViaMap call.
function fakeBrowser(snaps: string[]) {
  let i = 0; let calls = 0;
  return { callCount: () => calls, nextSnapshot: () => { calls++; return snaps[Math.min(i++, snaps.length - 1)]; } };
}
const RESULTS = `
- link "tenacity" [ref=e10]:
    - /url: https://github.com/jd/tenacity`;
const DETAIL = '- heading "tenacity" [ref=e1]';

// File-backed MapStore in a gitignored temp path so the skeleton PERSISTS between
// the two recallViaMap() calls below — this is the cross-run memory invariant.
const DB_PATH = `tests/tmp/memory-loop-${process.pid}.db`;

describe('memory loop (cross-run, file-backed MapStore, no browser)', () => {
  beforeEach(() => { mkdirSync('tests/tmp', { recursive: true }); });
  afterEach(() => {
    // Drop the temp db (and SQLite sidecars) so runs don't contaminate each other.
    for (const p of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
      try { unlinkSync(p); } catch { /* ignore: may not exist */ }
    }
  });

  it('seeds the skeleton once, persists it, and never re-explores on later runs (criterion #3)', () => {
    // The DB is the single source of truth: the skeleton is written by the SEED
    // step, not lazily by recall. seedGraph() persists it; both recall runs below
    // read it from disk and must NEVER call exploreGitHub again (criterion #3).
    const seedStore = new MapStore(DB_PATH);
    seedGraph(seedStore);
    expect(seedStore.getState('github:repo-detail')).not.toBeNull();
    expect(seedStore.edgesFrom('github:search-entry').length).toBeGreaterThan(0);

    const spy = vi.spyOn(skeleton, 'exploreGitHub');

    // RUN 1 — a fresh MapStore reopened from the SAME seeded file (simulating a
    // separate `webnav recall` invocation). The skeleton comes from DISK, so
    // exploreGitHub must NOT be called.
    const store = new MapStore(DB_PATH);
    expect(store.getState('github:repo-detail')).not.toBeNull(); // skeleton persisted to disk
    const r1 = recallViaMap({
      query: 'retry', goal: FIND_BATTLE_TESTED_REPOS, store,
      browser: fakeBrowser([RESULTS, DETAIL]), extractSignals: () => ({ stars: 1 }),
    });
    expect(spy).not.toHaveBeenCalled();
    expect(r1.status).toBe('done');
    if (r1.status !== 'done') throw new Error('run-1 expected done');
    expect(r1.evidence.candidates[0].id).toBe('jd/tenacity');

    // RUN 2 — another fresh reopen of the same file. Still no re-explore.
    spy.mockClear();
    const store2 = new MapStore(DB_PATH);
    expect(store2.getState('github:repo-detail')).not.toBeNull(); // skeleton persisted to disk
    const r2 = recallViaMap({
      query: 'retry', goal: FIND_BATTLE_TESTED_REPOS, store: store2,
      browser: fakeBrowser([RESULTS, DETAIL]), extractSignals: () => ({ stars: 1 }),
    });
    expect(spy).not.toHaveBeenCalled();
    expect(r2.status).toBe('done');
    if (r2.status !== 'done') throw new Error('run-2 expected done');
    expect(r2.evidence.candidates[0].id).toBe('jd/tenacity');

    spy.mockRestore();
  });
});
