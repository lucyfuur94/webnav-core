import type { IMapStore } from '../mapstore/store.js';

// A viz-ready view of ONE node's interior (its intra-site skeleton): the states
// that belong to the node and the edges among them. Pure read, deterministic
// ordering (states by id; edges by from,to,semanticStep) so the UI/tests are stable.
export interface NodeInteriorView {
  nodeId: string;
  states: { id: string; semanticName: string; role: string; availableSignals: string[]; urlPattern: string }[];
  edges: { from: string; to: string; semanticStep: string; kind: string }[];
}

export function buildNodeInterior(store: IMapStore, nodeId: string): NodeInteriorView {
  const states = store.statesForNode(nodeId)
    .map((s) => ({ id: s.id, semanticName: s.semanticName, role: s.role,
      availableSignals: s.availableSignals, urlPattern: s.urlPattern }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const owned = new Set(states.map((s) => s.id));
  const edges = store.allEdges()
    .filter((e) => owned.has(e.fromState) && owned.has(e.toState))
    .map((e) => ({ from: e.fromState, to: e.toState, semanticStep: e.semanticStep, kind: e.kind }))
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)
      || a.semanticStep.localeCompare(b.semanticStep));

  return { nodeId, states, edges };
}
