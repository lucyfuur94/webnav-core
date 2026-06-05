import type { MapStore } from '../mapstore/store.js';
import type { State, Edge } from '../mapstore/types.js';

export interface Interior { node: string; states: State[]; edges: Edge[]; }

export function showInterior(store: MapStore, node: string): Interior {
  const states = store.statesForNode(node);
  const prefix = `${node}:`;
  const edges = store.allEdges().filter((e) => e.fromState.startsWith(prefix));
  return { node, states, edges };
}
