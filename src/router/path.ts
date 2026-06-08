import type { MapStore } from '../mapstore/store.js';
import type { Edge } from '../mapstore/types.js';

/** Weight for an edge: lower = preferred. Cheap, reliable, confident edges win.
 *  +0.01 guards against a zero denominator (a brand-new edge has reliability 1). */
function edgeWeight(e: Edge): number {
  return (1 + e.cost) / (e.reliability * e.confidence + 0.01);
}

/**
 * Weighted shortest path (Dijkstra) over graph edges from startId to goalId.
 * Returns the ordered state-id list (inclusive of both ends), or null if the
 * goal is unreachable. Pure: reads the store only. Cycles terminate (visited set).
 */
export function findPath(store: MapStore, startId: string, goalId: string): string[] | null {
  if (startId === goalId) return [startId];
  const dist = new Map<string, number>([[startId, 0]]);
  const prev = new Map<string, string>();
  const visited = new Set<string>();
  const frontier = new Set<string>([startId]);

  while (frontier.size > 0) {
    let cur = '';
    let best = Infinity;
    for (const id of frontier) {
      const d = dist.get(id) ?? Infinity;
      if (d < best) { best = d; cur = id; }
    }
    frontier.delete(cur);
    if (cur === goalId) break;
    if (visited.has(cur)) continue;
    visited.add(cur);

    for (const e of store.edgesFrom(cur)) {
      if (visited.has(e.toState)) continue;
      const nd = (dist.get(cur) ?? Infinity) + edgeWeight(e);
      if (nd < (dist.get(e.toState) ?? Infinity)) {
        dist.set(e.toState, nd);
        prev.set(e.toState, cur);
      }
      frontier.add(e.toState);
    }
  }

  if (!dist.has(goalId)) return null;
  const path: string[] = [];
  let node: string | undefined = goalId;
  while (node !== undefined) { path.unshift(node); node = prev.get(node); }
  return path[0] === startId ? path : null;
}
