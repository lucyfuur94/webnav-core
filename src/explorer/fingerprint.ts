import type { State } from '../mapstore/types.js';
import type { SnapNode } from '../playwright/snapshot.js';

export type MatchResult =
  | { status: 'matched'; state: State }
  | { status: 'none' }
  | { status: 'ambiguous'; states: State[] };

/** A fingerprint token is "role" or "role:name". All tokens must be present. */
function hasToken(nodes: SnapNode[], token: string): boolean {
  const [role, name] = token.split(':');
  return nodes.some((n) => n.role === role && (name === undefined || n.name === name));
}

export function matchState(nodes: SnapNode[], states: State[]): MatchResult {
  const hits = states.filter((s) => s.fingerprint.every((t) => hasToken(nodes, t)));
  if (hits.length === 1) return { status: 'matched', state: hits[0] };
  if (hits.length === 0) return { status: 'none' };
  return { status: 'ambiguous', states: hits };
}
