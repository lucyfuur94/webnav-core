import type { MapStore } from '../mapstore/store.js';
import type { SiteNode, NodeEdge } from '../mapstore/types.js';
import { makeNodeEdge } from '../mapstore/types.js';
import { exploreGitHub } from '../explorer/github-skeleton.js';
import { seedSaucedemoComplete } from '../router/walk-live.js';
import { FIND_BATTLE_TESTED_REPOS } from '../goals/find-battle-tested-repos.js';

// Seed-and-grow (spec #2): the graph starts from the nodes webnav actually
// navigates and grows from there. This is the structure-only starting set —
// nodes + the edges between them. NO judgments about which node is "best";
// edges record only that a relationship exists (same cluster / a real link /
// learned co-use). Usage-learned co-use weights are a hosted-service feature (webnav-site).
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
  ],
  edges: [
    // A GitHub repo links its PyPI package page — a real hyperlink in the web graph.
    makeNodeEdge({ fromNode: 'github.com', toNode: 'pypi.org', kind: 'hyperlink' }),
    // marginalia & duckduckgo are both in the web-search cluster (same capability).
    makeNodeEdge({ fromNode: 'marginalia', toNode: 'duckduckgo', kind: 'capability' }),
    makeNodeEdge({ fromNode: 'duckduckgo', toNode: 'marginalia', kind: 'capability' }),
  ],
};

/**
 * Seed the out-of-the-box map for a FRESH install (idempotent upserts).
 *
 * Deliberately MINIMAL: the ONLY thing seeded is the **saucedemo** walk map — a
 * single, complete worked example (login → checkout-complete + the burger menu)
 * so `webnav walk` does something real on first run. Everything else (the GitHub
 * recall skeleton, the internet-graph nodes for route/search, …) is NOT seeded —
 * a new user builds those maps themselves (or seeds them explicitly). webnav is a
 * blank-slate map tool; saucedemo is just the example that proves it works.
 *
 * Tests/features that need GitHub or the internet graph seed it explicitly
 * (exploreGitHub(store) / seedInternetGraph(store)); they no longer get it for
 * free from this function.
 */
export function seedGraph(store: MapStore): void {
  seedSaucedemoComplete(store);
}

/** Opt-in: the GitHub recall skeleton + internet-graph nodes + the github-repos
 *  goal. Not part of the default seed — call this when you want `recall`/`route`/
 *  `search` to work (tests, or a user who wants GitHub repo discovery). */
export function seedGitHubAndGraph(store: MapStore): void {
  store.transaction(() => {
    for (const n of INTERNET_GRAPH_SEED.nodes) store.upsertNode(n);
    for (const e of INTERNET_GRAPH_SEED.edges) store.upsertNodeEdge(e);
  });
  exploreGitHub(store);
  store.upsertGoal(FIND_BATTLE_TESTED_REPOS);
}

/**
 * Ensure the default out-of-the-box map is present. Guard on a known saucedemo
 * interior state (NOT a node-only check): a pre-existing webnav.db may have older
 * data but lack the full saucedemo walk map. seedGraph's upserts are idempotent,
 * so re-running is cheap+safe. (GitHub/internet-graph are opt-in via
 * seedGitHubAndGraph — they are intentionally NOT part of the default seed.)
 */
export function ensureSeeded(store: MapStore): void {
  if (store.getState('www.saucedemo.com:checkout-complete') === null) {
    seedGraph(store);
  }
}
