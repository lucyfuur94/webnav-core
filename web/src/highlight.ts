// Hover-highlight logic, extracted as pure functions so it's unit-testable
// without a browser. The actual mouse wiring (onNodeMouseEnter/Leave) lives in
// InteriorView and is standard xyflow — confirmed visually in a real browser.

export interface MiniEdge { source: string; target: string; }

/** The hovered node plus every node directly connected to it (either direction).
 *  null hovered → null (meaning "no highlight; show everything full"). */
export function neighborSet(hovered: string | null, edges: MiniEdge[]): Set<string> | null {
  if (!hovered) return null;
  const set = new Set<string>([hovered]);
  for (const e of edges) {
    if (e.source === hovered) set.add(e.target);
    if (e.target === hovered) set.add(e.source);
  }
  return set;
}

/** Opacity for a node given the current hover: 1 when no hover or it's the
 *  hovered node / a neighbor; DIM otherwise. */
export function nodeOpacity(nodeId: string, neighbors: Set<string> | null, dim: number): number {
  return !neighbors || neighbors.has(nodeId) ? 1 : dim;
}

/** Whether an edge is "active" for the current hover (touches the hovered node).
 *  No hover → all edges active. */
export function edgeActive(edge: MiniEdge, hovered: string | null): boolean {
  return !hovered || edge.source === hovered || edge.target === hovered;
}
