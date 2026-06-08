import type { State, Edge } from '../mapstore/types.js';
import { makeEdge } from '../mapstore/types.js';
import type { MapStore } from '../mapstore/store.js';

/**
 * The known GitHub navigation skeleton as pure DATA (principle #6).
 *
 * STRUCTURE ONLY: states + edges between them. It must never contain specific
 * repos, search terms, or stars — that runtime data is filled in at replay time
 * (search-entry feeds the query in via the edge's `acceptsInput` slot, the
 * result page surfaces repo links, and the detail page declares signals).
 */
export const GITHUB_SKELETON: { states: State[]; edges: Edge[] } = {
  states: [
    {
      id: 'github:search-entry',
      nodeId: 'github.com',
      semanticName: 'github:search-entry',
      urlPattern: 'https://github.com/search*',
      role: 'search-entry',
      availableSignals: [],
      fingerprint: ['searchbox'],
      affordances: [],
    },
    {
      id: 'github:result-list',
      nodeId: 'github.com',
      semanticName: 'github:result-list',
      urlPattern: 'https://github.com/search?*type=repositories*',
      role: 'result-list',
      availableSignals: [],
      fingerprint: ['link'],
      affordances: [],
    },
    {
      id: 'github:repo-detail',
      nodeId: 'github.com',
      semanticName: 'github:repo-detail',
      urlPattern: 'https://github.com/*/*',
      role: 'detail',
      availableSignals: ['stars', 'license', 'last_commit'],
      fingerprint: ['heading'],
      affordances: [],
    },
  ],
  edges: [
    makeEdge({
      fromState: 'github:search-entry',
      toState: 'github:result-list',
      semanticStep: 'enter query in search and submit',
      kind: 'safe-reversible',
      acceptsInput: 'query',
    }),
    makeEdge({
      fromState: 'github:result-list',
      toState: 'github:repo-detail',
      semanticStep: 'follow a repository result link',
      kind: 'navigate',
    }),
  ],
};

/**
 * Persist the known GitHub skeleton into MapStore. Synchronous, no browser —
 * this writes the inspectable structure so the Router (M2) can read the route
 * from MapStore instead of a hard-coded path.
 *
 * Idempotent: `upsertState` (ON CONFLICT id) and `upsertEdge`
 * (UNIQUE from_state,to_state,semantic_step) update rather than duplicate, so
 * re-exploring leaves exactly one row per state/edge.
 */
export function exploreGitHub(store: MapStore): void {
  // Atomic: states + edges commit together, so a crash can never leave a torn,
  // partially-written skeleton that the recall guard would mistake for complete.
  store.transaction(() => {
    for (const state of GITHUB_SKELETON.states) {
      store.upsertState(state);
    }
    for (const edge of GITHUB_SKELETON.edges) {
      store.upsertEdge(edge);
    }
  });
}
