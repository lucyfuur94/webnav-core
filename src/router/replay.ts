import type { Edge } from '../mapstore/types.js';
import type { SnapNode } from '../playwright/snapshot.js';
import { resolveStep } from './resolve.js';

export type ReplayResult =
  | { status: 'ok'; ref: string; repaired: boolean }
  | { status: 'escalate' }          // real drift -> Router sends needs-navigation
  | { status: 'needs-classify' }    // unclassified action -> Router sends needs-classification
  | { status: 'blocked-commit' };   // pre-tagged destructive -> never traverse

export function replayStep(edge: Edge, nodes: SnapNode[]): ReplayResult {
  if (edge.kind === 'commit-point') return { status: 'blocked-commit' };
  if (edge.kind === 'unclassified') return { status: 'needs-classify' };

  if (edge.selectorCache && nodes.some((n) => n.ref === edge.selectorCache)) {
    return { status: 'ok', ref: edge.selectorCache, repaired: false };
  }
  // Cache miss -> deterministic re-resolve from the durable semantic step
  const ref = resolveStep(edge.semanticStep, nodes);
  if (ref) return { status: 'ok', ref, repaired: true };
  return { status: 'escalate' };
}
