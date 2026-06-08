// The call-and-response protocol between the calling agent and webnav.
// webnav NEVER reasons; whenever a decision is needed, it hands back to the agent.

import type { TokenSavings } from './router/tokens.js';

export interface Candidate {
  id: string; url: string; signals: Record<string, unknown>;
}

export interface EvidenceBundle {
  goal: string;
  query: string;
  candidates: Candidate[];        // raw evidence; the AGENT ranks, webnav does not
  // The real cost win (criterion #2): agent LLM tokens saved by webnav parsing the
  // raw snapshots deterministically and returning this compact bundle instead.
  // playwright_calls is a minor diagnostic, not the headline metric.
  cost: { playwright_calls: number; savings: TokenSavings };
}

export type RecallResponse =
  | { status: 'done'; evidence: EvidenceBundle; halted?: 'commit-point' }
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
