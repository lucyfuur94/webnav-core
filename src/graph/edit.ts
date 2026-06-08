import type { MapStore } from '../mapstore/store.js';
import { makeState, makeEdge } from '../mapstore/types.js';

export interface EditState { label: string; urlPattern?: string; fingerprint?: string[]; }
export interface EditEdge { from: string; to: string; via: string; needsInput?: boolean; why?: string; requiresAffordances?: string[]; }
export interface EditGraph { states: EditState[]; edges: EditEdge[]; }
export interface EditResult { node: string; statesWritten: number; edgesWritten: number; }

export function editGraph(store: MapStore, node: string, graph: EditGraph): EditResult {
  const stateId = (label: string) => `${node}:${label}`;
  // Labels that will exist after this edit: payload states + already-stored states.
  const payloadLabels = new Set(graph.states.map((s) => s.label));
  const knownLabel = (label: string) =>
    payloadLabels.has(label) || store.getState(stateId(label)) !== null;

  // Validate edge endpoints BEFORE any write (fail fast, atomic).
  for (const e of graph.edges) {
    for (const ep of [e.from, e.to]) {
      if (!knownLabel(ep)) {
        throw new Error(`editGraph: edge endpoint "${ep}" is not a declared or stored state for node "${node}"`);
      }
    }
  }

  let statesWritten = 0, edgesWritten = 0;
  store.transaction(() => {
    if (!store.getNode(node)) {
      store.upsertNode({ id: node, homeUrl: `https://${node}`, capabilities: [], topics: [] });
    }
    for (const s of graph.states) {
      store.upsertState(makeState({
        id: stateId(s.label), nodeId: node, semanticName: s.label,
        urlPattern: s.urlPattern ?? '', role: 'detail',
        fingerprint: s.fingerprint ?? [],
      }));
      statesWritten++;
    }
    for (const e of graph.edges) {
      const step = e.needsInput ? `${e.via} [needs-input: ${e.why ?? 'unspecified'}]` : e.via;
      store.upsertEdge(makeEdge({
        fromState: stateId(e.from), toState: stateId(e.to),
        semanticStep: step, kind: e.needsInput ? 'unclassified' : 'navigate',
        requiresAffordances: e.requiresAffordances ?? [],
      }));
      edgesWritten++;
    }
  });
  return { node, statesWritten, edgesWritten };
}
