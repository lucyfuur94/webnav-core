import type { State } from '../mapstore/types.js';
import type { SnapNode } from '../playwright/snapshot.js';

export type MatchResult =
  | { status: 'matched'; state: State }
  | { status: 'none' }
  | { status: 'ambiguous'; states: State[] };

/** A fingerprint token is "role" or "role:name". All tokens must be present. */
export function hasToken(nodes: SnapNode[], token: string): boolean {
  const [role, name] = token.split(':');
  return nodes.some((n) => n.role === role && (name === undefined || n.name === name));
}

export function matchState(nodes: SnapNode[], states: State[]): MatchResult {
  // An EMPTY fingerprint identifies nothing — `[].every()` is vacuously true, so it would match
  // EVERY page and make every landing `ambiguous`. `_shell` (site chrome, no identity) and any
  // degenerate/held-out stub carry `[]`; they are routing sources, never match candidates. Excise
  // them here so no caller has to remember to (live finding: `_shell` in the walk's state set made
  // a walk to a real report escalate `ambiguous` forever — [report, _shell]).
  const hits = states.filter((s) => s.fingerprint.length > 0 && s.fingerprint.every((t) => hasToken(nodes, t)));
  if (hits.length === 1) return { status: 'matched', state: hits[0] };
  if (hits.length === 0) return { status: 'none' };
  return { status: 'ambiguous', states: hits };
}
