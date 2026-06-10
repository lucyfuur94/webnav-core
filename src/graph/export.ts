import type { IMapStore } from '../mapstore/store.js';

// A visualization-ready view of the whole internet graph. The UI groups nodes
// into CLUSTERS = the capabilities they declare (a capability is a neighborhood
// of sites serving the same need). No clustering algorithm — clusters ARE the
// declared capabilities (YAGNI; the data already announces its neighborhoods).
export interface GraphView {
  nodes: { id: string; homeUrl: string; capabilities: string[]; topics: string[]; clusters: string[] }[];
  clusters: string[];                 // distinct capability names across all nodes (the neighborhoods)
  edges: { from: string; to: string; kind: string; weight: number }[];
}

/**
 * Build a visualization-ready view of the whole internet graph from MapStore.
 * Pure read (no writes). Deterministic ordering — nodes by id, edges by
 * (from, to, kind) — so the UI/tests are stable across runs.
 */
export function buildGraphView(store: IMapStore): GraphView {
  const allNodes = store.allNodes();
  const nodes = allNodes
    .map((n) => ({
      id: n.id,
      homeUrl: n.homeUrl,
      capabilities: n.capabilities,
      topics: n.topics,
      clusters: n.capabilities, // the UI groups by capability
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const clusters = [...new Set(allNodes.flatMap((n) => n.capabilities))].sort();

  const edges = store
    .allNodeEdges()
    .map((e) => ({ from: e.fromNode, to: e.toNode, kind: e.kind, weight: e.weight }))
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind));

  return { nodes, clusters, edges };
}
