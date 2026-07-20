// The call-and-response protocol between the calling agent and webnav.
// webnav NEVER reasons; whenever a decision is needed, it hands back to the agent.

import type { TokenSavings } from './router/tokens.js';
import type { Affordance } from './mapstore/types.js';

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
  // Set only when the GOAL state itself is dynamic (--observe / --observe-dynamic
  // test) — the live page + its stored repertoire, so the agent doesn't have to
  // snapshot manually right after `done`. done is done: no pause, just extra evidence.
  snapshot?: string;
  repertoire?: Affordance[];
}

export type RecallResponse =
  | { status: 'done'; evidence: EvidenceBundle; halted?: 'commit-point' }
  | { status: 'needs-navigation'; at: number; semanticStep: string; snapshot: string; question: string }
  | { status: 'needs-classification'; action: string; snapshot: string; at?: number }
  | { status: 'needs-auth'; at: number; profile: string; site: string; loginUrl: string }
  // A CONFIRMED arrival at a state the agent asked to observe (--observe <label>)
  // or that the map marks dynamic (--observe-dynamic: provisional, or any row/widget-
  // scoped affordance). Fires ONCE per state per walk. Resume with `--continue` (no
  // action needed — the agent may have already fired `use` actions on the live
  // session first; that's the designed pattern).
  | { status: 'checkpoint'; at: number; state: string; snapshot: string; repertoire: Affordance[] }
  | { status: 'failed'; reason: string };
