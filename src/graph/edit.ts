import type { MapStore } from '../mapstore/store.js';
import { makeState, makeEdge, makeAffordance, type Affordance, type AffordanceKind, type ElementFingerprint } from '../mapstore/types.js';

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
  elementFp?: ElementFingerprint;  // durable element key {role,name,near?} — disambiguates
                                   // heading-vs-button + identical siblings (e.g. table-row icon buttons)
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
const VALID_KINDS = new Set<AffordanceKind>(['navigate', 'reveal', 'mutate', 'input']);
function toAffordance(a: EditAffordance, stateId: (label: string) => string): Affordance {
  if (typeof a === 'string') {
    return makeAffordance({ id: 'aff_' + (_affSeq++) + '_' + slug(a), label: a, kind: 'mutate' });
  }
  // Validate LOUDLY — a teach payload using the wrong field names (e.g. `type`
  // instead of `kind`, `name` instead of `label`) must fail, not silently store
  // a `mutate:undefined` affordance. (Found via dogfooding: an agent invented its
  // own schema and editGraph happily stored garbage.)
  if (typeof a.label !== 'string' || !a.label) {
    throw new Error(`editGraph: affordance is missing a string "label" (got keys: ${Object.keys(a).join(',')})`);
  }
  if (a.kind !== undefined && !VALID_KINDS.has(a.kind)) {
    throw new Error(`editGraph: affordance "${a.label}" has invalid kind "${a.kind}" (expected navigate|reveal|mutate|input)`);
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
    elementFp: a.elementFp ?? null,
    children: a.children ? a.children.map((c) => toAffordance(c, stateId)) : null,
  });
}

// Find the ONE navigate/reveal affordance (recursing into reveal children) that
// carries the (toState, via) transition an edge declares. Prefers an exact
// label/semanticStep match on `via`; falls back to destination-only when it is
// unambiguous. Returns null when several candidates exist and none matches the
// label — we never guess among genuinely-equivalent targets (#5a).
function findNavTarget(affs: Affordance[], toId: string, via: string): Affordance | null {
  const flat: Affordance[] = [];
  const walk = (list: Affordance[]) => {
    for (const a of list) { flat.push(a); if (a.children) walk(a.children); }
  };
  walk(affs);
  const targets = flat.filter((a) => (a.kind === 'navigate' || a.kind === 'reveal') && a.toState === toId);
  const byLabel = targets.find((a) => a.label === via || a.semanticStep === via);
  if (byLabel) return byLabel;
  return targets.length === 1 ? targets[0] : null;
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

  // Build payload states up front so the edge pass can author onto their
  // affordances before anything is written.
  const payloadStates = new Map(graph.states.map((s) => [s.label, makeState({
    id: stateId(s.label), nodeId: node, semanticName: s.label,
    urlPattern: s.urlPattern ?? '', role: 'detail',
    fingerprint: s.fingerprint ?? [],
    affordances: (s.affordances ?? []).map((a) => toAffordance(a, stateId)),
  })]));

  let statesWritten = 0, edgesWritten = 0;
  store.transaction(() => {
    const existing = store.getNode(node);
    store.upsertNode({
      id: node,
      homeUrl: existing?.homeUrl ?? `https://${node}`,
      capabilities: graph.node?.capabilities ?? existing?.capabilities ?? [],
      topics: graph.node?.topics ?? existing?.topics ?? [],
    });
    // Edge pass FIRST (it may author onto payload/stored states, written after).
    // Affordances are the SOURCE OF TRUTH: when the from-state has a matching
    // navigate affordance, the edge's gate is authored as that affordance's
    // `needs` (and core merged) and NO edge row is written — a stored row would
    // shadow the gated projection on dedup. Edge rows remain only for edge-only
    // authoring (no backing affordance) and needsInput/unclassified forks.
    const patchedStored = new Map<string, ReturnType<typeof makeState>>();
    for (const e of graph.edges) {
      if (!e.needsInput) {
        const owner = payloadStates.get(e.from)
          ?? patchedStored.get(e.from)
          ?? store.getState(stateId(e.from)) ?? undefined;
        const aff = owner ? findNavTarget(owner.affordances ?? [], stateId(e.to), e.via) : null;
        if (owner && aff) {
          for (const id of e.requiresAffordances ?? []) {
            if (!aff.needs.includes(id)) aff.needs.push(id);
          }
          aff.core = aff.core || (e.core ?? false);
          if (!payloadStates.has(e.from)) patchedStored.set(e.from, owner);
          edgesWritten++;
          continue;
        }
      }
      const step = e.needsInput ? `${e.via} [needs-input: ${e.why ?? 'unspecified'}]` : e.via;
      store.upsertEdge(makeEdge({
        fromState: stateId(e.from), toState: stateId(e.to),
        semanticStep: step, kind: e.needsInput ? 'unclassified' : 'navigate',
        requiresAffordances: e.requiresAffordances ?? [],
        core: e.core ?? false,
      }));
      edgesWritten++;
    }
    for (const s of payloadStates.values()) {
      store.upsertState(s);
      statesWritten++;
    }
    for (const s of patchedStored.values()) store.upsertState(s);
  });
  return { node, statesWritten, edgesWritten };
}
