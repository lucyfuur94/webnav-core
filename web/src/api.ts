import type { GraphView, NodeInteriorView } from './types.js';

// Offline/standalone mode: `webnav dev standalone <site>` produces a single HTML
// file with the graph + interior data inlined on `window.__WEBNAV_DATA__`. When
// that's present we read from it instead of the server API, so the file renders
// by double-clicking — no running server.
interface StandaloneData {
  graph?: GraphView;
  interiors?: Record<string, NodeInteriorView>;
  open?: string;   // site id to auto-open into its interior view
}
function standalone(): StandaloneData | null {
  return (globalThis as { __WEBNAV_DATA__?: StandaloneData }).__WEBNAV_DATA__ ?? null;
}
export function standaloneOpen(): string | null {
  return standalone()?.open ?? null;
}

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json() as Promise<T>;
}

export const fetchGraph = (): Promise<GraphView> => {
  const s = standalone();
  if (s?.graph) return Promise.resolve(s.graph);
  return getJson<GraphView>('/api/graph');
};

export const fetchInterior = (id: string): Promise<NodeInteriorView> => {
  const s = standalone();
  if (s?.interiors && s.interiors[id]) return Promise.resolve(s.interiors[id]);
  if (s) return Promise.reject(new Error(`${id} → 404`)); // standalone but no data for this id
  return getJson<NodeInteriorView>(`/api/node/${encodeURIComponent(id)}/interior`);
};
