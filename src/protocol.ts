// The call-and-response protocol between the calling agent and webnav.
// webnav NEVER reasons; whenever a decision is needed, it hands back to the agent.

export interface Candidate {
  id: string; url: string; signals: Record<string, unknown>;
}

export interface EvidenceBundle {
  goal: string;
  query: string;
  candidates: Candidate[];        // raw evidence; the AGENT ranks, webnav does not
  cost: { playwright_calls: number };   // webnav makes no LLM calls; cost is the call count
}

export type RecallResponse =
  | { status: 'done'; evidence: EvidenceBundle }
  | { status: 'needs-navigation'; at: number; semanticStep: string; snapshot: string; question: string }
  | { status: 'needs-classification'; action: string; snapshot: string }
  | { status: 'failed'; reason: string };

// --- Place lookup ("where is A?"): return a coordinate WITHOUT traversing. ---
// webnav's two-tier coordinate (see CLAUDE.md "Coordinate system"):
//  - addressable: a canonical URL the agent can `goto` directly, no routing.
//  - unaddressable: a semantic state name + fingerprint (+ a goal/route to reach it).
export type Coordinate =
  | { kind: 'url'; url: string }
  | { kind: 'state'; semanticName: string; fingerprint: string[]; viaGoal?: string };

export type LocateResponse =
  | { status: 'found'; place: string; coordinate: Coordinate }
  | { status: 'unknown'; place: string };
