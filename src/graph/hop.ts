import type { MapStore } from '../mapstore/store.js';
import type { NodeEdge, NodeEdgeKind } from '../mapstore/types.js';

export interface HopResponse {
  fromNode: string | null;
  toNode: string | null;
  landingUrl: string | null;
  via: string | null;        // edge kind used
  status: 'hopped' | 'no-edge' | 'unknown-source';
}

// Prefer a real link (hyperlink) over a same-cluster (capability) over learned
// (co-use) over topical (content) edge. A hyperlink means a concrete path exists.
const KIND_ORDER: NodeEdgeKind[] = ['hyperlink', 'capability', 'co-use', 'content'];

/**
 * hop: from the current page's node, move to a related node — either a specific
 * toNode or any node in toCluster. Prefers a 'hyperlink' edge (a real link
 * exists) else 'capability'/'co-use'. Returns the target node's home_url as the
 * landing (v1; a hyperlink-specific landing URL is a later refinement).
 */
export function hop(
  store: MapStore,
  fromUrl: string,
  target: { toNode?: string; toCluster?: string },
): HopResponse {
  const fromNode = deriveFromNode(store, fromUrl);
  if (!fromNode) {
    return { fromNode: null, toNode: null, landingUrl: null, via: null, status: 'unknown-source' };
  }

  // Resolve the set of acceptable destination node ids.
  const clusterNodes = target.toCluster
    ? new Set(store.nodesByCapability(target.toCluster).map((n) => n.id))
    : null;
  const matches = (toNode: string): boolean => {
    if (target.toNode && toNode === target.toNode) return true;
    if (clusterNodes && clusterNodes.has(toNode)) return true;
    return false;
  };

  const candidateEdges = store.nodeEdgesFrom(fromNode).filter((e) => matches(e.toNode));
  const best = pickByKind(candidateEdges);
  if (!best) {
    return { fromNode, toNode: null, landingUrl: null, via: null, status: 'no-edge' };
  }

  const dest = store.getNode(best.toNode);
  return {
    fromNode, toNode: best.toNode,
    landingUrl: dest ? dest.homeUrl : null,
    via: best.kind, status: 'hopped',
  };
}

/**
 * Derive the source node by matching the fromUrl's HOST against each node's
 * homeUrl host — NOT against the node id (the id need not equal the host, e.g.
 * node 'saucedemo' has homeUrl host 'www.saucedemo.com'). Fall back to a
 * host-substring match against the id for robustness.
 */
function deriveFromNode(store: MapStore, fromUrl: string): string | null {
  let host: string;
  try {
    host = new URL(fromUrl).host;
  } catch {
    return null;
  }
  for (const n of store.allNodes()) {
    try {
      if (new URL(n.homeUrl).host === host) return n.id;
    } catch {
      // ignore malformed seed homeUrl
    }
  }
  for (const n of store.allNodes()) {
    if (host.includes(n.id)) return n.id;
  }
  return null;
}

function pickByKind(edges: NodeEdge[]): NodeEdge | null {
  for (const kind of KIND_ORDER) {
    const e = edges.find((x) => x.kind === kind);
    if (e) return e;
  }
  return null;
}
