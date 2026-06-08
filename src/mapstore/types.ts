export type StateRole = 'search-entry' | 'result-list' | 'detail' | 'sub-detail';
// 'unclassified' = webnav read this action but does NOT decide if it's safe;
// the agent classifies it via needs-classification only if a route must traverse it.
export type EdgeKind = 'safe-reversible' | 'commit-point' | 'navigate' | 'unclassified';

export interface State {
  id: string;
  nodeId: string | null;        // owning site-node id, e.g. 'github.com'; null when the
                                // id prefix didn't resolve to a known node (migration backfill)
  semanticName: string;
  urlPattern: string;
  role: StateRole;
  availableSignals: string[];   // capability, NOT goal intent
  fingerprint: string[];        // key declared elements that identify this state
  affordances: string[];        // in-page actions available here (node repertoire); [] = none
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
  requiresAffordances: string[];  // in-page affordances to fire before traversing this edge; [] = none
  core: boolean;                // on the main/core path (agent-declared); default false
  cost: number;                 // playwright-cli call count (§4.1); webnav makes no LLM calls
  reliability: number;          // successCount / (successCount + failCount); 1 when unused
  successCount: number;
  failCount: number;
  lastVerified: number | null;  // epoch ms
  confidence: number;           // decays with age, rises with use
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
    selectorCache: null, acceptsInput: null, requiresAffordances: [], core: false, cost: 0,
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
