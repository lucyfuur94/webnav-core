// The call-and-response protocol between the calling agent and webnav.
// webnav NEVER reasons; whenever a decision is needed, it hands back to the agent.

export interface Candidate {
  id: string; url: string; signals: Record<string, unknown>;
}

export interface EvidenceBundle {
  goal: string;
  query: string;
  candidates: Candidate[];        // raw evidence; the AGENT ranks, webnav does not
  cost: { playwright_calls: number; wall_ms: number };
}

export type RecallResponse =
  | { status: 'done'; evidence: EvidenceBundle }
  | { status: 'needs-navigation'; at: number; semanticStep: string; snapshot: string; question: string }
  | { status: 'needs-classification'; action: string; snapshot: string }
  | { status: 'failed'; reason: string };
