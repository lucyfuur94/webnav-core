export type StateRole = 'search-entry' | 'result-list' | 'detail' | 'sub-detail';
// 'unclassified' = webnav read this action but does NOT decide if it's safe;
// the agent classifies it via needs-classification only if a route must traverse it.
export type EdgeKind = 'safe-reversible' | 'commit-point' | 'navigate' | 'unclassified';

// An affordance is one thing you can do at a state. KINDS:
//  - navigate: fires -> lands on a DIFFERENT state (toState set when explored).
//  - reveal:   opens an in-page overlay/disclosure exposing MORE affordances (children).
//  - mutate:   changes the CURRENT state in place (sort/filter/add-to-cart); never routes.
//  - input:    fills a field; never routes; usually named in some navigate's `needs`.
// Affordances are the node's REPERTOIRE and the SOURCE OF TRUTH; navigate/reveal
// affordances with a toState PROJECT into edges (store.edgesFrom). mutate/input never project.
export type AffordanceKind = 'navigate' | 'reveal' | 'mutate' | 'input';

export interface Affordance {
  id: string;                   // stable within its owning state, e.g. 'aff_cart'
  label: string;                // human/agent-readable, e.g. 'open the shopping cart'
  kind: AffordanceKind;
  commit: boolean;              // irreversible (Place Order/Pay/Delete) — NEVER auto-fired (#2)
  toState: string | null;       // navigate/reveal destination; null = unexplored or n/a
  addressableUrl: string | null;// tier-1 coordinate: if the destination has a stable
                                // canonical URL, the walk JUMPS there (goto) instead of
                                // resolving a ref — for icon-only/unstable links. null = resolve a ref.
  children: Affordance[] | null;// reveal: affordances the overlay exposes; else null
  needs: string[];              // affordance ids that should fire first (preconditions); [] = none
  acceptsInput: string | null;  // runtime input slot the live browser fills (e.g. 'credentials')
  core: boolean;                // on the site's MAIN path (drives the viewer's top-to-bottom spine); default false
  // — durable intent + disposable cache + usage stats (moved off the old Edge) —
  semanticStep: string;         // DURABLE intent (survives redesigns)
  selectorCache: string | null; // DISPOSABLE last-known ref/selector
  cost: number;
  reliability: number;
  successCount: number;
  failCount: number;
  lastVerified: number | null;
  confidence: number;           // decays with age, rises with use
}

export function makeAffordance(
  init: Pick<Affordance, 'id' | 'label' | 'kind'> & Partial<Affordance>,
): Affordance {
  return {
    commit: false, toState: null, addressableUrl: null, children: null, needs: [], acceptsInput: null, core: false,
    semanticStep: init.label, selectorCache: null, cost: 0, reliability: 1,
    successCount: 0, failCount: 0, lastVerified: null, confidence: 1,
    ...init,
  };
}

export interface State {
  id: string;
  nodeId: string | null;        // owning site-node id, e.g. 'github.com'; null when the
                                // id prefix didn't resolve to a known node (migration backfill)
  semanticName: string;
  urlPattern: string;
  role: StateRole;
  availableSignals: string[];   // capability, NOT goal intent
  fingerprint: string[];        // key declared elements that identify this state
  affordances: Affordance[];    // the node's full typed repertoire (source of truth); [] = none
}

export function makeState(
  init: Pick<State, 'id' | 'nodeId' | 'semanticName' | 'urlPattern' | 'role'> & Partial<State>,
): State {
  return {
    availableSignals: [],
    fingerprint: [],
    affordances: [],
    ...init,
  };
}

export interface Edge {
  fromState: string;
  toState: string;
  semanticStep: string;         // DURABLE intent
  selectorCache: string | null; // DISPOSABLE last-known ref/selector
  kind: EdgeKind;
  acceptsInput: string | null;  // runtime slot name, e.g. "query"
  addressableUrl: string | null; // tier-1 coordinate: jump here (goto) instead of resolving a ref; null = resolve
  requiresAffordances: string[];  // in-page affordances to fire before traversing this edge; [] = none
  core: boolean;                // on the main/core path (agent-declared); default false
  cost: number;                 // playwright-cli call count (§4.1); webnav makes no LLM calls
  reliability: number;          // successCount / (successCount + failCount); 1 when unused
  successCount: number;
  failCount: number;
  lastVerified: number | null;  // epoch ms
  confidence: number;           // decays with age, rises with use
}

// Viewer-facing edge (one node's interior). `viaAffordance` = the affordance id
// that triggers this transition (the UI anchors the arrow to that row).
// `dangling` = an explored-but-unmapped navigate/reveal (to === null).
export interface InteriorEdge {
  from: string;
  to: string | null;
  semanticStep: string;
  kind: string;
  viaAffordance: string;
  core: boolean;
  dangling?: boolean;
}

export interface Goal {
  name: string;
  site: string | null;                      // owning site/node id; null for legacy rows
  entry: string | null;                     // entry URL/query template, {query} slot
  extractor: string | null;                 // named extractor (registry key)
  visit: string[];                          // state roles/ids to visit per candidate
  surface: Record<string, string[]>;        // stateRole -> signals to extract
  candidateLimit: number;
}

export function makeEdge(
  init: Pick<Edge, 'fromState' | 'toState' | 'semanticStep' | 'kind'> & Partial<Edge>,
): Edge {
  return {
    selectorCache: null, acceptsInput: null, addressableUrl: null, requiresAffordances: [], core: false, cost: 0,
    reliability: 1, successCount: 0, failCount: 0,
    lastVerified: null, confidence: 1,
    ...init,
  };
}

// ─── Internet graph (inter-site) — Phase 2 ───────────────────────────────────
// A NODE is a website (it owns an intra-site skeleton as its interior); a
// CLUSTER is a neighborhood of nodes serving the same CAPABILITY.
export interface SiteNode {
  id: string;             // e.g. 'github.com' — also the skeleton namespace prefix
  homeUrl: string;        // entry URL
  capabilities: string[]; // cluster names this node serves (web-search, code-search, ...)
  topics: string[];       // declared content tags (v1 of "content similarity")
}

export type NodeEdgeKind = 'capability' | 'hyperlink' | 'co-use' | 'content';

export interface NodeEdge {
  fromNode: string;
  toNode: string;
  kind: NodeEdgeKind;
  weight: number;               // usage weight signal (1 for now; G4 learns it)
  lastVerified: number | null;  // epoch ms
  confidence: number;           // decays with age, rises with use
}

export function makeNodeEdge(
  init: Pick<NodeEdge, 'fromNode' | 'toNode' | 'kind'> & Partial<NodeEdge>,
): NodeEdge {
  return {
    weight: 1, lastVerified: null, confidence: 1,
    ...init,
  };
}
