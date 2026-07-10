import type { MapStore } from '../mapstore/store.js';
import { makeState, makeEdge, makeAffordance, type Affordance, type AffordanceKind, type ElementFingerprint, type DeclaredShadow, type State } from '../mapstore/types.js';

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
export interface EditState { label: string; urlPattern?: string; fingerprint?: string[]; affordances?: EditAffordance[]; declaredShadow?: DeclaredShadow; role?: string; parentState?: string | null; }
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

// Dedup key = the affordance's SEMANTIC identity, NOT its id (toAffordance auto-generates a fresh
// id per call, so the same logical affordance from two edits would double under an id key). The
// identity is kind|label|toState PLUS the elementFp — critically the `near` content-anchor, which
// is what distinguishes same-(role,label) SIBLINGS (row-1 vs row-2 "Press Space to toggle", each
// with a different `near`). Omitting the fp collapsed 50 distinct row buttons into 1. True
// duplicates (identical role+name+near) still dedupe; genuinely-distinct siblings stay separate.
function affKey(a: Affordance): string {
  const fp = a.elementFp ? `${a.elementFp.role ?? ''}~${a.elementFp.name ?? ''}~${a.elementFp.near ?? ''}` : '';
  return `${a.kind}|${a.label}|${a.toState ?? ''}|${fp}`;
}

// The semantic tuple WITHOUT the fp — same role+label+dest but possibly differing fp. Used for
// the "fp upgrade" pass: a no-fp affordance that later gains an fp should be UPGRADED, not doubled.
function affSemanticKey(a: Affordance): string { return `${a.kind}|${a.label}|${a.toState ?? ''}`; }

/** Merge `incoming` affordances into `existing`, KEEPING existing (commons) and ADDING new ones.
 *  Distinct same-(role,label) siblings (different `near`) stay separate (affKey includes the fp).
 *  A no-fp entry that a later capture upgrades WITH an fp is replaced, not doubled. Recurses into
 *  reveal children. Pure. */
function mergeAffordances(existing: Affordance[], incoming: Affordance[]): Affordance[] {
  const byKey = new Map<string, Affordance>();
  const add = (a: Affordance) => {
    const k = affKey(a);
    const prev = byKey.get(k);
    if (prev && (prev.children || a.children)) prev.children = mergeAffordances(prev.children ?? [], a.children ?? []);
    if (!prev) byKey.set(k, a);
  };
  for (const a of existing) add(a);
  for (const a of incoming) add(a);
  // fp-upgrade pass: if a FP-carrying affordance shares the semantic tuple with a NO-FP one,
  // drop the no-fp one (the fp is the richer, healed coordinate — never keep both).
  const out = [...byKey.values()];
  const fpSemantics = new Set(out.filter((a) => a.elementFp).map(affSemanticKey));
  return out.filter((a) => a.elementFp || !fpSemantics.has(affSemanticKey(a)));
}

/** Merge two DeclaredShadows: union collections/filters/subTabs, keep an existing createsEntity. */
function mergeShadow(existing: DeclaredShadow | null | undefined, incoming: DeclaredShadow | null | undefined): DeclaredShadow | null {
  if (!existing) return incoming ?? null;
  if (!incoming) return existing;
  const uniq = <T>(arr: T[]) => { const seen = new Set<string>(); return arr.filter((x) => { const k = JSON.stringify(x); if (seen.has(k)) return false; seen.add(k); return true; }); };
  return {
    collections: uniq([...(existing.collections ?? []), ...(incoming.collections ?? [])]),
    filters: uniq([...(existing.filters ?? []), ...(incoming.filters ?? [])]),
    createsEntity: existing.createsEntity ?? incoming.createsEntity ?? null,
    subTabs: uniq([...(existing.subTabs ?? []), ...(incoming.subTabs ?? [])]),
  };
}

export function editGraph(store: MapStore, node: string, graph: EditGraph): EditResult {
  // Tolerate a graph missing `edges`/`states` (e.g. a `--draft` piped through `jq '{node,states}'`,
  // or a hand-authored spec with only states). The draft carries edges AS navigate affordances on
  // states, so `edges: []` is the common, valid case — never throw "edges is not iterable" on it.
  graph = { ...graph, states: graph.states ?? [], edges: graph.edges ?? [] };
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

  // Build payload states up front so the edge pass can author onto their affordances before
  // anything is written. RE-EDIT MERGES, never clobbers: when a state already exists, keep its
  // affordances (commons) + union the incoming ones, so extending a map with a new session that
  // shares some steps and adds new ones preserves both. (Without this, upsertState's
  // affordances=@aff replaces the whole blob — a partial re-edit would wipe prior captures.)
  const payloadStates = new Map(graph.states.map((s) => {
    const incomingAff = (s.affordances ?? []).map((a) => toAffordance(a, stateId));
    const prior = store.getState(stateId(s.label));
    // Always run through mergeAffordances — even first-time (prior=[]) — so the payload dedups
    // WITHIN itself too. Two sessions' fragments of one page can each carry the same "Help
    // Center" link with different auto-ids; without this self-merge, both survived as an exact
    // duplicate edge (live finding: report-list → help-center appeared twice).
    const affordances = mergeAffordances(prior?.affordances ?? [], incomingAff);
    const fingerprint = prior ? [...new Set([...(prior.fingerprint ?? []), ...(s.fingerprint ?? [])])] : (s.fingerprint ?? []);
    const declaredShadow = prior ? mergeShadow(prior.declaredShadow, s.declaredShadow) : (s.declaredShadow ?? null);
    // hierarchy: role + parentState. On RE-EDIT the PRIOR wins — it was computed from the full
    // (multi-session) build, whereas a partial single-session re-edit sees an incomplete nav
    // structure and would mis-derive (e.g. call a known 'detail' a 'section' because this session
    // never captured the parent edge). Only take the incoming when there's no prior (first write).
    const role = (prior?.role as State['role']) ?? (s.role as State['role']) ?? 'detail';
    const parentState = prior ? (prior.parentState ?? (s.parentState != null ? stateId(s.parentState) : null))
                              : (s.parentState != null ? stateId(s.parentState) : null);
    return [s.label, makeState({
      id: stateId(s.label), nodeId: node, semanticName: s.label,
      urlPattern: s.urlPattern ?? prior?.urlPattern ?? '', role,
      fingerprint, affordances, declaredShadow, parentState,
    })];
  }));

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
