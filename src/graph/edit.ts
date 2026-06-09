import type { MapStore } from '../mapstore/store.js';
import { makeState, makeEdge, makeAffordance, type Affordance, type AffordanceKind } from '../mapstore/types.js';

// Teach API accepts an affordance either as a bare label string (→ mutate, the
// safe default for an in-page action with no declared transition) or as the full
// typed object. `id`/`to` are AUTHOR-FRIENDLY: `to` is the destination state's
// LABEL (resolved to `node:label`); `needs` are affordance ids; `children` nest
// for a `reveal`. This lets an agent author the complete affordance model via
// `graph-edit` — the same shape the walk fixture uses.
export interface EditAffordanceObj {
  id?: string;                // stable id; auto-generated from the label if omitted
  label: string;
  kind?: AffordanceKind;      // default 'mutate'
  to?: string;                // navigate/reveal destination STATE LABEL (→ node:label)
  commit?: boolean;
  needs?: string[];           // precondition affordance ids
  addressableUrl?: string;    // tier-1 jump URL
  acceptsInput?: string;      // runtime input slot
  core?: boolean;             // on the main spine
  children?: EditAffordance[];// reveal overlay's affordances
}
export type EditAffordance = string | EditAffordanceObj;
export interface EditState { label: string; urlPattern?: string; fingerprint?: string[]; affordances?: EditAffordance[]; }
export interface EditEdge { from: string; to: string; via: string; needsInput?: boolean; why?: string; requiresAffordances?: string[]; core?: boolean; }
export interface EditGraph { states: EditState[]; edges: EditEdge[]; node?: { capabilities?: string[]; topics?: string[] }; }
export interface EditResult { node: string; statesWritten: number; edgesWritten: number; }

let _affSeq = 0;
const slug = (s: string) => s.replace(/\W+/g, '_').slice(0, 24);
// `stateId` maps an author's state LABEL to its full id (`node:label`); `to` in a
// teach affordance is a label, so we resolve it here.
function toAffordance(a: EditAffordance, stateId: (label: string) => string): Affordance {
  if (typeof a === 'string') {
    return makeAffordance({ id: 'aff_' + (_affSeq++) + '_' + slug(a), label: a, kind: 'mutate' });
  }
  return makeAffordance({
    id: a.id ?? 'aff_' + (_affSeq++) + '_' + slug(a.label),
    label: a.label,
    kind: a.kind ?? 'mutate',
    toState: a.to ? stateId(a.to) : null,
    commit: a.commit ?? false,
    needs: a.needs ?? [],
    addressableUrl: a.addressableUrl ?? null,
    acceptsInput: a.acceptsInput ?? null,
    core: a.core ?? false,
    children: a.children ? a.children.map((c) => toAffordance(c, stateId)) : null,
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
        affordances: (s.affordances ?? []).map((a) => toAffordance(a, stateId)),
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
