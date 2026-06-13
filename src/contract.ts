// The CLI <-> hosted-service CONTRACT — single source of truth for every shape
// that crosses the wire between the open-source CLI (this repo) and the hosted
// shared-knowledge service (webnav-site). The site imports this module
// types-only from `@dikshanty94/webnav/contract`; nothing here may import
// runtime code, so consuming it never pulls in better-sqlite3 etc.
//
// HARD INVARIANT (CLAUDE.md): the wire carries the MAP SKELETON ONLY —
// site navigation structure. It never carries credentials.

import type { SiteNode, State } from './mapstore/types.js';

export type {
  SiteNode,
  State,
  Affordance,
  AffordanceKind,
  StateRole,
  EdgeKind,
} from './mapstore/types.js';

/** One site's full skeleton. This is what `webnav dev export-map` emits, what
 *  the site's `publish-map` uploads, and what `GET /api/maps/:site` returns. */
export interface MapPack {
  node: SiteNode;
  states: State[];
}

/** Request header carrying the API key on hosted-route calls. */
export const WEBNAV_KEY_HEADER = 'X-Webnav-Key';

/** Path of the metered map-fetch endpoint for a site id (the SiteNode id,
 *  e.g. 'www.saucedemo.com'). */
export function mapFetchPath(site: string): string {
  return `/api/maps/${encodeURIComponent(site)}`;
}

/** Non-200 statuses the map-fetch endpoint returns:
 *  401 missing/invalid/revoked/expired key · 404 no shared map · 429 quota. */
export type MapFetchErrorStatus = 401 | 404 | 429;

/** Body of every non-200 map-fetch response. */
export interface MapFetchError {
  error: string;
}
