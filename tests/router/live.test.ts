import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Replace the REAL PlaywrightAdapter (which spawns playwright-cli) with an
// offline fake that serves scripted snapshot YAML keyed by the current URL.
const h = vi.hoisted(() => {
  const state = {
    pages: {} as Record<string, string>,
    calls: [] as string[][],
    instances: 0,
  };
  class FakePlaywrightAdapter {
    callCount = 0;
    private url = '';
    constructor(_session: string) { state.instances++; }
    async open(u: string) { this.callCount++; this.url = u; state.calls.push(['open', u]); return ''; }
    async goto(u: string) { this.callCount++; this.url = u; state.calls.push(['goto', u]); return ''; }
    async close() { this.callCount++; state.calls.push(['close']); return ''; }
    async snapshot() {
      this.callCount++;
      state.calls.push(['snapshot', this.url]);
      const yml = state.pages[this.url];
      if (yml === undefined) throw new Error('no fixture page for ' + this.url);
      return yml;
    }
  }
  return { state, FakePlaywrightAdapter };
});
vi.mock('../../src/playwright/adapter.js', () => ({ PlaywrightAdapter: h.FakePlaywrightAdapter }));

import { runRecallLive, resolveEntry } from '../../src/router/live.js';
import { MapStore } from '../../src/mapstore/store.js';
import { seedGitHubAndGraph } from '../../src/graph/seed.js';

// GitHub search results: relative /owner/repo links (the form GitHub actually
// emits), a duplicate link to the same repo, and a non-repo top-level path.
const RESULTS_PAGE = [
  '- link "ownerA/repoA" [ref=e1]:',
  '    - /url: /ownerA/repoA',
  '- link "ownerA/repoA" [ref=e2]:',           // duplicate result-row link -> deduped
  '    - /url: /ownerA/repoA',
  '- link "ownerB/repoB" [ref=e3]:',
  '    - /url: /ownerB/repoB',
  '- link "sponsors/ownerA" [ref=e4]:',        // non-repo top-level path -> excluded
  '    - /url: /sponsors/ownerA',
  '- link "ownerC/repoC" [ref=e5]:',           // beyond top=2 -> never visited
  '    - /url: /ownerC/repoC',
].join('\n');

describe('runRecallLive', () => {
  let tmp: string;
  beforeAll(() => { tmp = mkdtempSync(join(tmpdir(), 'webnav-live-')); });
  afterAll(() => { rmSync(tmp, { recursive: true, force: true }); });
  beforeEach(() => {
    h.state.pages = {};
    h.state.calls = [];
    h.state.instances = 0;
  });

  it('returns failed for an unknown goal WITHOUT opening a browser', async () => {
    const r = await runRecallLive('python retry', 3, join(tmp, 'empty.db'), 'no-such-goal');
    expect(r.status).toBe('failed');
    if (r.status === 'failed') expect(r.reason).toContain('no-such-goal');
    expect(h.state.instances).toBe(0);   // failed BEFORE any playwright session
  });

  it('opens the goal entry with the query injected, visits top-N details, returns the evidence bundle', async () => {
    const dbFile = join(tmp, 'recall.db');
    seedGitHubAndGraph(new MapStore(dbFile));   // skeleton + github-repos goal on disk

    const entry = resolveEntry('https://github.com/search?q={query}&type=repositories', 'python retry');
    h.state.pages[entry] = RESULTS_PAGE;
    h.state.pages['https://github.com/ownerA/repoA'] =
      '- heading "repoA" [ref=e1]\n- link "12.3k stars" [ref=e2]\n- generic "MIT License" [ref=e3]';
    h.state.pages['https://github.com/ownerB/repoB'] =
      '- heading "repoB" [ref=e1]\n- link "456 stars" [ref=e2]';

    const r = await runRecallLive('python retry', 2, dbFile);
    expect(r.status).toBe('done');
    if (r.status !== 'done') return;

    // Candidates: deduped, non-repo paths excluded, capped to top=2, in result order.
    expect(r.evidence.candidates.map((c) => c.id)).toEqual(['ownerA/repoA', 'ownerB/repoB']);
    expect(r.evidence.candidates[0].url).toBe('https://github.com/ownerA/repoA');
    // Declared signals extracted per the goal's surface list — never fabricated.
    expect(r.evidence.candidates[0].signals.stars).toBe(12300);
    expect(r.evidence.candidates[0].signals.license).toBe('MIT License');
    expect(r.evidence.candidates[1].signals.stars).toBe(456);
    expect(r.evidence.candidates[1].signals).not.toHaveProperty('license');

    // Browser choreography: open(entry) first, goto each candidate, close at the end.
    expect(h.state.calls[0]).toEqual(['open', entry]);
    expect(h.state.calls.filter((c) => c[0] === 'goto').map((c) => c[1])).toEqual([
      'https://github.com/ownerA/repoA', 'https://github.com/ownerB/repoB',
    ]);
    expect(h.state.calls[h.state.calls.length - 1]).toEqual(['close']);

    // Cost block reports the agent-token saving (criterion #2) from real snapshot sizes.
    expect(r.evidence.cost.playwright_calls).toBe(7);   // open + snap + 2*(goto+snap) + close
    expect(r.evidence.cost.savings.raw_snapshot_tokens).toBeGreaterThan(0);
    expect(r.evidence.cost.savings.tokens_saved).toBeGreaterThanOrEqual(0);
  });

  it('retries the results snapshot while no repo links render, then fails honestly when none appear', async () => {
    vi.useFakeTimers();
    try {
      const dbFile = join(tmp, 'empty-results.db');
      seedGitHubAndGraph(new MapStore(dbFile));

      const entry = resolveEntry('https://github.com/search?q={query}&type=repositories', 'nothing here');
      h.state.pages[entry] = '- heading "Search" [ref=e1]';   // nav shell, never any repo links
      const pending = runRecallLive('nothing here', 2, dbFile);
      await vi.advanceTimersByTimeAsync(6000);   // drain the 5 bounded 1s retries
      const r = await pending;
      expect(r.status).toBe('failed');
      if (r.status === 'failed') expect(r.reason).toMatch(/no repository links/);
      // 1 open + 6 snapshots (initial + 5 retries) + 1 close
      expect(h.state.calls.filter((c) => c[0] === 'snapshot')).toHaveLength(6);
    } finally {
      vi.useRealTimers();
    }
  });
});
