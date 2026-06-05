import type { StoredObservation } from '../mapstore/record.js';

export interface AnalysedState {
  label: string;          // machine label, e.g. 'github.com:state-type-1'
  fingerprint: string[];
  urlPatterns: string[];  // distinct urls' paths seen for this type (raw urls for v1)
  pageCount: number;
  sampleUrls: string[];   // up to 3
}
export interface AnalysedEdge { from: string; to: string; via: string; }
export interface AnalysedSite { node: string; states: AnalysedState[]; edges: AnalysedEdge[]; }
export interface CrossSiteEdge { from: string; to: string; via: string; }
export interface AnalysisResult { sites: AnalysedSite[]; crossSiteEdges: CrossSiteEdge[]; }

function host(url: string): string | null {
  try { return new URL(url).host; } catch { return null; }
}
const fpKey = (fp: string[]) => fp.join('|');

export function analyseObservations(observations: StoredObservation[]): AnalysisResult {
  // node -> fingerprint-key -> state accumulator
  const sites = new Map<string, Map<string, AnalysedState>>();
  // (node, url) -> state label, so edges can resolve a link target to a type.
  // CONTRACT: if the SAME url was observed under two different fingerprints
  // (e.g. a logged-out vs logged-in render, or a render-race), last-seen wins
  // here — edges to that url resolve to the last fingerprint's type, and the
  // earlier type may become an unreachable orphan. This is intended for v1
  // (url != state, per the coordinate model); the agent reconciles on validate.
  const urlToLabel = new Map<string, string>();
  const counters = new Map<string, number>();

  for (const o of observations) {
    const node = host(o.url);
    if (!node) continue;
    if (!sites.has(node)) { sites.set(node, new Map()); counters.set(node, 0); }
    const states = sites.get(node)!;
    const key = fpKey(o.fingerprint);
    let st = states.get(key);
    if (!st) {
      const n = counters.get(node)! + 1; counters.set(node, n);
      st = { label: `${node}:state-type-${n}`, fingerprint: o.fingerprint,
        urlPatterns: [], pageCount: 0, sampleUrls: [] };
      states.set(key, st);
    }
    st.pageCount++;
    if (!st.urlPatterns.includes(o.url)) st.urlPatterns.push(o.url);
    if (st.sampleUrls.length < 3) st.sampleUrls.push(o.url);
    urlToLabel.set(`${node}\n${o.url}`, st.label);
  }

  // Edges (second pass: all labels are now known).
  const edgeSets = new Map<string, Set<string>>();         // node -> "from|to|via"
  const crossSet = new Set<string>();                       // "from|to|via"
  const crossSiteEdges: CrossSiteEdge[] = [];
  for (const o of observations) {
    const node = host(o.url);
    if (!node) continue;
    const fromLabel = urlToLabel.get(`${node}\n${o.url}`);
    if (!fromLabel) continue;
    for (const link of o.declaredLinks) {
      const linkHost = host(link.to);
      if (!linkHost) continue;
      if (linkHost === node) {
        const toLabel = urlToLabel.get(`${node}\n${link.to}`);
        if (!toLabel) continue;                 // target type never observed → drop
        if (!edgeSets.has(node)) edgeSets.set(node, new Set());
        edgeSets.get(node)!.add(`${fromLabel}|${toLabel}|${link.via}`);
      } else {
        const k = `${node}|${linkHost}|${link.via}`;
        if (!crossSet.has(k)) { crossSet.add(k); crossSiteEdges.push({ from: node, to: linkHost, via: link.via }); }
      }
    }
  }

  const result: AnalysedSite[] = [];
  for (const [node, states] of sites) {
    const edges: AnalysedEdge[] = [...(edgeSets.get(node) ?? [])].map((s) => {
      const [from, to, via] = s.split('|'); return { from, to, via };
    });
    result.push({ node, states: [...states.values()], edges });
  }
  result.sort((a, b) => a.node.localeCompare(b.node));
  return { sites: result, crossSiteEdges };
}
