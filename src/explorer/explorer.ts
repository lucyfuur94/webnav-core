import type { Edge } from '../mapstore/types.js';
import { makeEdge } from '../mapstore/types.js';
import type { SnapNode } from '../playwright/snapshot.js';

const INTERACTIVE = new Set(['link', 'button', 'searchbox', 'textbox']);

/**
 * Observe-first: read declared interactive elements into candidate edges.
 * Links with /url -> navigate edges. Inputs -> safe-reversible with acceptsInput.
 * Buttons -> 'unclassified' (webnav does NOT decide safe vs commit - the agent
 * does, via needs-classification, only if a route ever needs to traverse one).
 * No clicking happens here. Synchronous; no LLM.
 */
export function deriveEdges(nodes: SnapNode[], fromState: string): Edge[] {
  const edges: Edge[] = [];
  for (const n of nodes) {
    if (!n.ref || !INTERACTIVE.has(n.role)) continue;

    if (n.role === 'link' && n.url) {
      edges.push(makeEdge({
        fromState, toState: `url:${n.url}`,
        semanticStep: `follow link "${n.name ?? n.url}"`,
        kind: 'navigate', selectorCache: n.ref,
      }));
      continue;
    }
    if (n.role === 'searchbox' || n.role === 'textbox') {
      edges.push(makeEdge({
        fromState, toState: `${fromState}:input`,
        semanticStep: `enter query in "${n.name ?? 'input'}"`,
        kind: 'safe-reversible', selectorCache: n.ref, acceptsInput: 'query',
      }));
      continue;
    }
    // button or other: recorded but NOT classified by webnav
    edges.push(makeEdge({
      fromState, toState: `${fromState}:after-${n.ref}`,
      semanticStep: `click "${n.name ?? n.ref}"`, kind: 'unclassified', selectorCache: n.ref,
    }));
  }
  return edges;
}
