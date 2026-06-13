import type { Edge } from '../mapstore/types.js';
import type { SnapNode } from '../playwright/snapshot.js';
import { resolveStep } from './resolve.js';
import { resolveByFingerprint } from '../playwright/fingerprint.js';

export type ReplayResult =
  | { status: 'ok'; ref: string; repaired: boolean }
  | { status: 'escalate' }          // real drift -> Router sends needs-navigation
  | { status: 'needs-classify' }    // unclassified action -> Router sends needs-classification
  | { status: 'blocked-commit' };   // pre-tagged destructive -> never traverse

export function replayStep(edge: Edge, nodes: SnapNode[]): ReplayResult {
  if (edge.kind === 'commit-point') return { status: 'blocked-commit' };
  if (edge.kind === 'unclassified') return { status: 'needs-classify' };

  // Deterministic resolve, zero-LLM. When the edge carries a durable elementFp
  // (role+name+content anchor), use the layered fingerprint resolver — this
  // disambiguates heading-vs-button and identical siblings (e.g. 50 icon buttons in
  // a table row) that name-only matching can't. Legacy edges (no elementFp) fall back
  // to resolveStep's name match (+ selectorCache self-heal) — unchanged behavior.
  if (edge.elementFp) {
    const ref = resolveByFingerprint(edge.elementFp, nodes);
    if (ref) return { status: 'ok', ref, repaired: false };
    return { status: 'escalate' };
  }
  const ref = resolveStep(edge.semanticStep, nodes, edge.selectorCache);
  if (ref) return { status: 'ok', ref, repaired: !!edge.selectorCache };
  return { status: 'escalate' };
}
