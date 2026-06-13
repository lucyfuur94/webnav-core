import type { MapStore } from '../mapstore/store.js';

/**
 * `list` — the table of contents. "What's on this map?" Reads the local store
 * and returns every site webnav has a map for, with its state count. Pure read,
 * no browser, no LLM. The agent reads this to learn which sites it can walk.
 *
 * (Richer per-site inspection — states, affordances, edges — is `dev graph-show`
 * / `dev outline` / `dev mermaid`. `list` is just the index.)
 */
export interface SiteListing {
  site: string;       // node id, e.g. 'www.saucedemo.com'
  homeUrl: string;
  states: number;     // how many states are mapped under this site
}
export interface Coverage {
  sites: SiteListing[];
}

export function listCoverage(store: MapStore): Coverage {
  const sites = store.allNodes()
    .map((n) => ({ site: n.id, homeUrl: n.homeUrl, states: store.statesForNode(n.id).length }))
    .sort((a, b) => a.site.localeCompare(b.site));
  return { sites };
}
