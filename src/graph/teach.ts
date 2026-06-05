import type { MapStore } from '../mapstore/store.js';
import type { SiteNode, NodeEdgeKind } from '../mapstore/types.js';
import { makeNodeEdge } from '../mapstore/types.js';

export interface AddNodeInput {
  id: string;
  homeUrl: string;
  capabilities: string[];
  topics: string[];
}

/** Teach webnav a new site (or update an existing one). Returns the stored node. */
export function addNode(store: MapStore, input: AddNodeInput): SiteNode {
  if (!input.id.trim()) throw new Error('node-add: id must not be empty');
  if (!input.homeUrl.trim()) throw new Error('node-add: url must not be empty');
  const node: SiteNode = {
    id: input.id,
    homeUrl: input.homeUrl,
    capabilities: input.capabilities,
    topics: input.topics,
  };
  store.upsertNode(node);
  return node;
}

export interface AddEdgeInput {
  from: string;
  to: string;
  kind: NodeEdgeKind;
}

export type AddEdgeResult =
  | { status: 'added'; from: string; to: string; kind: NodeEdgeKind }
  | { status: 'unknown-node'; missing: string };

/**
 * Teach webnav a relationship between two KNOWN sites. Both nodes must exist —
 * an edge to a site webnav has never heard of can't be visualized or routed, so
 * we refuse it and name the missing node rather than inventing it.
 */
export function addEdge(store: MapStore, input: AddEdgeInput): AddEdgeResult {
  if (!store.getNode(input.from)) return { status: 'unknown-node', missing: input.from };
  if (!store.getNode(input.to)) return { status: 'unknown-node', missing: input.to };
  store.upsertNodeEdge(makeNodeEdge({ fromNode: input.from, toNode: input.to, kind: input.kind }));
  return { status: 'added', from: input.from, to: input.to, kind: input.kind };
}
