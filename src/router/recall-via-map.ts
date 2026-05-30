import type { Goal } from '../mapstore/types.js';
import type { RecallResponse } from '../protocol.js';
import type { MapStore } from '../mapstore/store.js';
import { recall, type RecallBrowser } from './router.js';
// Namespace import so vi.spyOn(skeleton, 'exploreGitHub') observes the call
// (the spy patches the namespace binding we dereference at call time).
import * as skeleton from '../explorer/github-skeleton.js';

export interface RecallViaMapArgs {
  query: string;
  goal: Goal;
  store: MapStore;
  browser: RecallBrowser;                  // same shim recall() uses (pull-based snapshots)
  extractSignals: (detailYaml: string) => Record<string, unknown>;
}

/**
 * recall() + the MEMORY layer. Reads the GitHub navigation skeleton FROM the
 * MapStore; if it isn't there yet, builds it ONCE via exploreGitHub (never
 * re-explores a known skeleton — success criterion #3). Confirms the structural
 * route search-entry -> result-list -> repo-detail exists, then delegates the
 * result-list -> candidates -> evidence gathering to recall() unchanged.
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

  // 1. Ensure the FULL skeleton route is present; build it once if missing OR
  //    torn (partial). Checking the whole route — not just one node/edge — means
  //    a partially-written map self-repairs by rebuilding rather than failing.
  //    A complete, known skeleton is never rebuilt (criterion #3).
  if (!routePresent(store)) {
    skeleton.exploreGitHub(store);
  }

  // 2. Confirm the route now exists (exploreGitHub is atomic, so it should).
  if (!routePresent(store)) {
    return { status: 'failed', reason: 'no route to repo-detail in map' };
  }

  // 3. Route confirmed — delegate candidate/evidence gathering to recall().
  return recall({ query, goal, browser, extractSignals });
}
