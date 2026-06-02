import type { Goal } from '../mapstore/types.js';
import type { RecallResponse } from '../protocol.js';
import type { MapStore } from '../mapstore/store.js';
import { recall, type RecallBrowser } from './router.js';

export interface RecallViaMapArgs {
  query: string;
  goal: Goal;
  store: MapStore;
  browser: RecallBrowser;                  // same shim recall() uses (pull-based snapshots)
  extractSignals: (detailYaml: string) => Record<string, unknown>;
}

/**
 * recall() + the MEMORY layer. Reads the GitHub navigation skeleton FROM the
 * MapStore (the DB is the single source of truth — run seedGraph first). Confirms
 * the structural route search-entry -> result-list -> repo-detail exists, then
 * delegates the result-list -> candidates -> evidence gathering to recall().
 * Returns `failed` if the map has not been seeded (no lazy build).
 */
/** Is the full search-entry -> result-list -> repo-detail route present in the map? */
function routePresent(store: MapStore): boolean {
  const searchEdge = store.edgesFrom('github:search-entry')
    .find(e => e.toState === 'github:result-list' && e.acceptsInput === 'query');
  const navigateEdge = store.edgesFrom('github:result-list')
    .find(e => e.toState === 'github:repo-detail' && e.kind === 'navigate');
  return store.getState('github:repo-detail') !== null && !!searchEdge && !!navigateEdge;
}

export function recallViaMap(args: RecallViaMapArgs): RecallResponse {
  const { query, goal, store, browser, extractSignals } = args;

  // 1. The DB is the single source of truth. We do NOT lazily build the skeleton;
  //    an unseeded map simply has no route (run the seed step first).
  if (!routePresent(store)) {
    return { status: 'failed', reason: 'no route to repo-detail in map (seed the map first)' };
  }

  // 2. Route confirmed — delegate candidate/evidence gathering to recall().
  return recall({ query, goal, browser, extractSignals });
}
