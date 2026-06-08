import type { IMapStore } from '../mapstore/store.js';
import type { Affordance, InteriorEdge } from '../mapstore/types.js';

// A viz-ready view of ONE node's interior (its intra-site skeleton): the states
// that belong to the node and the edges among them. Pure read, deterministic
// ordering (states by id; edges by from,to,semanticStep) so the UI/tests are stable.
//
// `states[].affordances` is the full typed repertoire (so the UI can render
// per-kind groups + reveal children). `edges` are PROJECTED from those affordances
// (store.interiorEdges) and each carries `viaAffordance` so the UI anchors the arrow
// to the specific affordance row; unexplored navigate/reveal come back `dangling`.
export interface NodeInteriorView {
  nodeId: string;
  states: { id: string; semanticName: string; role: string; availableSignals: string[]; urlPattern: string; affordances: Affordance[] }[];
  edges: InteriorEdge[];
}

export function buildNodeInterior(store: IMapStore, nodeId: string): NodeInteriorView {
  const states = store.statesForNode(nodeId)
    .map((s) => ({ id: s.id, semanticName: s.semanticName, role: s.role,
      availableSignals: s.availableSignals, urlPattern: s.urlPattern, affordances: s.affordances }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const owned = new Set(states.map((s) => s.id));
  // Projected edges that stay within this node (a dangling edge has to===null and
  // is kept — it represents an unexplored exit the UI should still show).
  const edges = store.interiorEdges(nodeId)
    .filter((e) => owned.has(e.from) && (e.to === null || owned.has(e.to)))
    .sort((a, b) => a.from.localeCompare(b.from) || (a.to ?? '').localeCompare(b.to ?? '')
      || a.semanticStep.localeCompare(b.semanticStep));

  return { nodeId, states, edges };
}
