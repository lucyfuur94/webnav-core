import type { GraphView, NodeInteriorView } from './types.js';

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json() as Promise<T>;
}
export const fetchGraph = () => getJson<GraphView>('/api/graph');
export const fetchInterior = (id: string) =>
  getJson<NodeInteriorView>(`/api/node/${encodeURIComponent(id)}/interior`);
