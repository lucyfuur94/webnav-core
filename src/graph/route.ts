import type { MapStore } from '../mapstore/store.js';
import type { SiteNode } from '../mapstore/types.js';

export interface RouteCandidate {
  node: string;
  cluster: string;
  homeUrl: string;
  weight: number;          // node-edge/usage weight signal (1 for now; G4 learns it)
  why: string;             // provenance: why this candidate surfaced
}
export interface RouteResponse {
  request: string;
  capability: string | null;   // the resolved capability, or null if not given/derivable
  candidates: RouteCandidate[];
  note: string;                // disclaims judgment — webnav surfaces signals only
}

const NOTE =
  'signals only — the agent decides which node(s) to use; webnav does not judge which is best';

/**
 * route: given a request and an OPTIONAL explicit capability, surface candidate
 * nodes (+ mechanical signals). If capability is given, return that cluster's
 * nodes. If NOT given, do a deterministic keyword match of the request against
 * nodes' declared topics/capabilities (NO intent inference — if nothing matches,
 * return ALL nodes as candidates so the agent can choose). Sorted by weight as a
 * CONVENIENCE ordering, explicitly labeled not-a-judgment in `note`.
 */
export function route(store: MapStore, request: string, capability?: string): RouteResponse {
  let candidates: RouteCandidate[];
  let resolvedCapability: string | null;

  if (capability) {
    // Explicit capability: the cluster is named by the agent. No inference.
    resolvedCapability = capability;
    candidates = store.nodesByCapability(capability).map((n) => ({
      node: n.id, cluster: capability, homeUrl: n.homeUrl,
      weight: 1, why: `serves ${capability}`,
    }));
  } else {
    resolvedCapability = null;
    const lower = request.toLowerCase();
    const matched: RouteCandidate[] = [];
    for (const n of store.allNodes()) {
      // Deterministic token match: does the request mention any declared token?
      // NO intent inference — we only test substring presence of declared tokens.
      const token = [...n.topics, ...n.capabilities].find((t) => lower.includes(t.toLowerCase()));
      if (token) {
        matched.push({
          node: n.id, cluster: n.capabilities[0], homeUrl: n.homeUrl,
          weight: 1, why: `request mentions "${token}"`,
        });
      }
    }
    if (matched.length > 0) {
      candidates = matched;
    } else {
      // Ambiguous (no declared token matched) → offer ALL known nodes; the agent
      // chooses. webnav refuses to guess intent (#5a).
      candidates = store.allNodes().map((n: SiteNode) => ({
        node: n.id, cluster: n.capabilities[0], homeUrl: n.homeUrl,
        weight: 1, why: 'no capability match — all known nodes offered',
      }));
    }
  }

  // Convenience ordering only (weight desc, then node id for stability). The
  // `note` makes explicit this is NOT a quality ranking.
  candidates.sort((a, b) => b.weight - a.weight || a.node.localeCompare(b.node));

  return { request, capability: resolvedCapability, candidates, note: NOTE };
}
