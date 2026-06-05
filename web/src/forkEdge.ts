import type { NodeInteriorView } from './types.js';

type InteriorEdge = NodeInteriorView['edges'][number];

/** A fork edge is one the map cannot auto-traverse: it needs a human/agent
 *  decision (login/pay/etc). Marked at graph-edit time as kind 'unclassified'
 *  and/or a '[needs-input: ...]' suffix on the step. */
export function isForkEdge(edge: InteriorEdge): boolean {
  return edge.kind === 'unclassified' || edge.semanticStep.includes('[needs-input:');
}
