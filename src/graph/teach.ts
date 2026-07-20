import type { MapStore } from '../mapstore/store.js';
import type { SiteNode } from '../mapstore/types.js';

export interface AddNodeInput {
  id: string;
  homeUrl: string;
}

/** Teach webnav a new site (or update an existing one). Returns the stored node. */
export function addNode(store: MapStore, input: AddNodeInput): SiteNode {
  if (!input.id.trim()) throw new Error('node-add: id must not be empty');
  if (!input.homeUrl.trim()) throw new Error('node-add: url must not be empty');
  const node: SiteNode = { id: input.id, homeUrl: input.homeUrl };
  store.upsertNode(node);
  return node;
}
