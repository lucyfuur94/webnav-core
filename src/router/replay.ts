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

  // Deterministic resolve. resolveStep matches by NAME (not by the ephemeral ref,
  // which is reassigned every snapshot): first the step's own quoted name, then
  // `selectorCache` — the self-healed name an agent's ref resolved to on a prior
  // walk when the step's name had drifted. So a once-broken step re-resolves
  // here without escalating again (principle #3).
  const ref = resolveStep(edge.semanticStep, nodes, edge.selectorCache);
  if (ref) return { status: 'ok', ref, repaired: !!edge.selectorCache };
  return { status: 'escalate' };
}
