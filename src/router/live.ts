import { PlaywrightAdapter } from '../playwright/adapter.js';
import { repoUrl } from './router.js';
import { recallViaMap } from './recall-via-map.js';
import { MapStore } from '../mapstore/store.js';
import type { RecallResponse } from '../protocol.js';
import { extractRepoSignals } from './extract.js';
import { FIND_BATTLE_TESTED_REPOS } from '../goals/find-battle-tested-repos.js';
import { parseSnapshot } from '../playwright/snapshot.js';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// NOTE (v1 status): the live path now goes Router -> MapStore -> Explorer via
// recallViaMap(). The navigation skeleton is built ONCE and PERSISTS across
// separate runs through a FILE-backed MapStore (default `webnav.db` in cwd), so
// run-2 reads the skeleton from disk and never re-explores it (success criterion
// #3). The remaining real-world risk here is GitHub DOM drift / rate-limits, NOT
// the memory loop.
//
// Honest cost caveat (criterion #2): in THIS wiring the browser still navigates
// search + each detail page every run, so playwright call counts are similar
// run-to-run. The architectural win M2 encodes is "skeleton built once, never
// re-explored" — a dramatic per-run call-count DROP on run-2 will only land once
// replay can SKIP navigation for addressable steps (future increment). This code
// does not fake a cost drop.
export async function runRecallLive(query: string, top: number, dbPath = 'webnav.db'): Promise<RecallResponse> {
  const adapter = new PlaywrightAdapter(`webnav-${Date.now()}`);
  // Inject the query directly via GitHub's search URL (accepts_input="query").
  // First navigation must `open` (playwright-cli requires the browser opened
  // before `goto`); subsequent navigations reuse it via `goto`.
  await adapter.open(`https://github.com/search?q=${encodeURIComponent(query)}&type=repositories`);

  // GitHub search renders results asynchronously: an immediate snapshot can
  // catch the page before results load (just the nav shell). Re-snapshot until
  // repo links appear, bounded, so slow queries don't yield an empty result set.
  let resultsYaml = await adapter.snapshot();
  for (let attempt = 0; attempt < 5 && !parseSnapshot(resultsYaml).some(repoUrl); attempt++) {
    await sleep(1000);
    resultsYaml = await adapter.snapshot();
  }
  const snapshots: string[] = [resultsYaml];

  // Pre-read candidate repo URLs using the SAME helper recall() uses (resolves
  // relative /owner/repo links to absolute, dedupes), so the prefetched detail
  // snapshots line up positionally with recall's candidates.
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const n of parseSnapshot(snapshots[0])) {
    const u = repoUrl(n);
    if (u && !seen.has(u)) { seen.add(u); urls.push(u); }
    if (urls.length >= top) break;
  }
  for (const u of urls) { await adapter.goto(u); snapshots.push(await adapter.snapshot()); }
  await adapter.close();

  let idx = 0;
  const browser = { callCount: () => adapter.callCount, nextSnapshot: () => snapshots[Math.min(idx++, snapshots.length - 1)] };

  // FILE-backed MapStore so the skeleton survives across separate runs. recallViaMap
  // builds the skeleton once if absent, confirms the route, then delegates evidence
  // gathering to recall(). The calling AGENT ranks. No LLM here.
  const store = new MapStore(dbPath);
  return recallViaMap({
    query, goal: { ...FIND_BATTLE_TESTED_REPOS, candidateLimit: top }, store, browser,
    extractSignals: (yml) => extractRepoSignals(yml, FIND_BATTLE_TESTED_REPOS.surface.detail),
  });
}
