export type StateRole = 'search-entry' | 'result-list' | 'detail' | 'sub-detail';
// 'unclassified' = webnav read this action but does NOT decide if it's safe;
// the agent classifies it via needs-classification only if a route must traverse it.
export type EdgeKind = 'safe-reversible' | 'commit-point' | 'navigate' | 'unclassified';

export interface State {
  id: string;
  semanticName: string;
  urlPattern: string;
  role: StateRole;
  availableSignals: string[];   // capability, NOT goal intent
  fingerprint: string[];        // key declared elements that identify this state
}

export interface Edge {
  fromState: string;
  toState: string;
  semanticStep: string;         // DURABLE intent
  selectorCache: string | null; // DISPOSABLE last-known ref/selector
  kind: EdgeKind;
  acceptsInput: string | null;  // runtime slot name, e.g. "query"
  cost: number;                 // playwright-cli call count (§4.1); webnav makes no LLM calls
  reliability: number;          // successCount / (successCount + failCount); 1 when unused
  successCount: number;
  failCount: number;
  lastVerified: number | null;  // epoch ms
  confidence: number;           // decays with age, rises with use
}

export interface Goal {
  name: string;
  visit: string[];                          // state roles/ids to visit per candidate
  surface: Record<string, string[]>;        // stateRole -> signals to extract
  candidateLimit: number;
}

export function makeEdge(
  init: Pick<Edge, 'fromState' | 'toState' | 'semanticStep' | 'kind'> & Partial<Edge>,
): Edge {
  return {
    selectorCache: null, acceptsInput: null, cost: 0,
    reliability: 1, successCount: 0, failCount: 0,
    lastVerified: null, confidence: 1,
    ...init,
  };
}
