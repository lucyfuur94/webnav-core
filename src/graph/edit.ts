import type { MapStore } from '../mapstore/store.js';
import { makeState, makeEdge, makeAffordance, type Affordance, type AffordanceKind } from '../mapstore/types.js';

// Teach API accepts affordances either as bare label strings (→ mutate, the safe
// default for an in-page action with no declared transition) or as {label,kind,...}.
export type EditAffordance = string | { label: string; kind?: AffordanceKind; toState?: string; commit?: boolean };
export interface EditState { label: string; urlPattern?: string; fingerprint?: string[]; affordances?: EditAffordance[]; }
export interface EditEdge { from: string; to: string; via: string; needsInput?: boolean; why?: string; requiresAffordances?: string[]; core?: boolean; }
export interface EditGraph { states: EditState[]; edges: EditEdge[]; node?: { capabilities?: string[]; topics?: string[] }; }
export interface EditResult { node: string; statesWritten: number; edgesWritten: number; }

let _affSeq = 0;
function toAffordance(a: EditAffordance): Affordance {
  if (typeof a === 'string') {
    return makeAffordance({ id: 'aff_' + (_affSeq++) + '_' + a.replace(/\W+/g, '_').slice(0, 24), label: a, kind: 'mutate' });
  }
  return makeAffordance({
    id: 'aff_' + (_affSeq++) + '_' + a.label.replace(/\W+/g, '_').slice(0, 24),
    label: a.label, kind: a.kind ?? 'mutate', toState: a.toState ?? null, commit: a.commit ?? false,
  });
}

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
    const existing = store.getNode(node);
    store.upsertNode({
      id: node,
      homeUrl: existing?.homeUrl ?? `https://${node}`,
      capabilities: graph.node?.capabilities ?? existing?.capabilities ?? [],
      topics: graph.node?.topics ?? existing?.topics ?? [],
    });
    for (const s of graph.states) {
      store.upsertState(makeState({
        id: stateId(s.label), nodeId: node, semanticName: s.label,
        urlPattern: s.urlPattern ?? '', role: 'detail',
        fingerprint: s.fingerprint ?? [],
        affordances: (s.affordances ?? []).map(toAffordance),
      }));
      statesWritten++;
    }
    for (const e of graph.edges) {
      const step = e.needsInput ? `${e.via} [needs-input: ${e.why ?? 'unspecified'}]` : e.via;
      store.upsertEdge(makeEdge({
        fromState: stateId(e.from), toState: stateId(e.to),
        semanticStep: step, kind: e.needsInput ? 'unclassified' : 'navigate',
        requiresAffordances: e.requiresAffordances ?? [],
        core: e.core ?? false,
      }));
      edgesWritten++;
    }
  });
  return { node, statesWritten, edgesWritten };
}
