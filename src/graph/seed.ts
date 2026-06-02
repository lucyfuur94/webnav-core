import type { MapStore } from '../mapstore/store.js';
import type { SiteNode, NodeEdge } from '../mapstore/types.js';
import { makeNodeEdge } from '../mapstore/types.js';
import { exploreGitHub } from '../explorer/github-skeleton.js';
import { exploreSaucedemo } from '../explorer/saucedemo-skeleton.js';

// Seed-and-grow (spec #2): the graph starts from the nodes webnav actually
// navigates and grows from there. This is the structure-only starting set —
// nodes + the edges between them. NO judgments about which node is "best";
// edges record only that a relationship exists (same cluster / a real link /
// learned co-use). weight is 1 for all edges now; G4 learns it from usage.
export const INTERNET_GRAPH_SEED: { nodes: SiteNode[]; edges: NodeEdge[] } = {
  nodes: [
    { id: 'github.com', homeUrl: 'https://github.com',
      capabilities: ['code-search', 'repo-search'], topics: ['code', 'software', 'git'] },
    { id: 'pypi.org', homeUrl: 'https://pypi.org',
      capabilities: ['package-search'], topics: ['python', 'packages'] },
    { id: 'marginalia', homeUrl: 'https://search.marginalia.nu',
      capabilities: ['web-search'], topics: ['general'] },
    { id: 'duckduckgo', homeUrl: 'https://html.duckduckgo.com',
      capabilities: ['web-search'], topics: ['general'] },
    { id: 'saucedemo', homeUrl: 'https://www.saucedemo.com',
      capabilities: ['shopping-demo'], topics: ['shopping', 'demo'] },
  ],
  edges: [
    // A GitHub repo links its PyPI package page — a real hyperlink in the web graph.
    makeNodeEdge({ fromNode: 'github.com', toNode: 'pypi.org', kind: 'hyperlink' }),
    // marginalia & duckduckgo are both in the web-search cluster (same capability).
    makeNodeEdge({ fromNode: 'marginalia', toNode: 'duckduckgo', kind: 'capability' }),
    makeNodeEdge({ fromNode: 'duckduckgo', toNode: 'marginalia', kind: 'capability' }),
  ],
};

/** Seed the internet graph into `store` transactionally (idempotent upserts). */
export function seedGraph(store: MapStore): void {
  store.transaction(() => {
    for (const n of INTERNET_GRAPH_SEED.nodes) store.upsertNode(n);
    for (const e of INTERNET_GRAPH_SEED.edges) store.upsertNodeEdge(e);
  });
  // Interiors: the known site skeletons are seed DATA. exploreGitHub/Saucedemo
  // each run their own transaction (atomic, idempotent upserts).
  exploreGitHub(store);
  exploreSaucedemo(store);
}

/**
 * Ensure the map is fully seeded — nodes AND interiors. Use this as the bootstrap
 * guard (NOT `if (!getNode(...))`): a pre-existing webnav.db may already have the
 * nodes from an older seed but ZERO interior states, so a node-only guard would
 * skip seeding and leave drill-in empty. We guard on a known interior state
 * instead. seedGraph's upserts are idempotent, so calling it again is cheap+safe.
 */
export function ensureSeeded(store: MapStore): void {
  if (store.getState('github:repo-detail') === null) {
    seedGraph(store);
  }
}
