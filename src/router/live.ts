import { PlaywrightAdapter } from '../playwright/adapter.js';
import { recall, isRepoLink } from './router.js';
import type { RecallResponse } from '../protocol.js';
import { extractRepoSignals } from './extract.js';
import { FIND_BATTLE_TESTED_REPOS } from '../goals/find-battle-tested-repos.js';
import { parseSnapshot } from '../playwright/snapshot.js';

// NOTE (v1 limitation): this path navigates from a fresh search URL every run
// and does NOT yet replay a persisted MapStore skeleton, so recall() never
// returns needs-navigation/needs-classification here and cross-run cost savings
// (success criterion #2) are not yet realized. The skeleton/replay modules exist
// and are unit-tested; wiring them into this path is the next increment.
export async function runRecallLive(query: string, top: number): Promise<RecallResponse> {
  const adapter = new PlaywrightAdapter(`webnav-${Date.now()}`);
  // Inject the query directly via GitHub's search URL (accepts_input="query").
  await adapter.goto(`https://github.com/search?q=${encodeURIComponent(query)}&type=repositories`);
  const snapshots: string[] = [await adapter.snapshot()];

  // Pre-read candidate repo URLs using the SAME predicate recall() uses, so the
  // prefetched detail snapshots line up positionally with recall's candidates.
  const links = parseSnapshot(snapshots[0]).filter(isRepoLink).slice(0, top);
  for (const l of links) { await adapter.goto(l.url!); snapshots.push(await adapter.snapshot()); }
  await adapter.close();

  let idx = 0;
  const browser = { callCount: () => adapter.callCount, nextSnapshot: () => snapshots[Math.min(idx++, snapshots.length - 1)] };
  // recall returns an evidence bundle (RecallResponse). The calling AGENT ranks. No LLM here.
  return recall({
    query, goal: { ...FIND_BATTLE_TESTED_REPOS, candidateLimit: top }, browser,
    extractSignals: (yml) => extractRepoSignals(yml, FIND_BATTLE_TESTED_REPOS.surface.detail),
  });
}
