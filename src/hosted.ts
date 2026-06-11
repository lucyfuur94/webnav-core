import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import type { State, SiteNode } from './mapstore/types.js';
import type { IMapStore } from './mapstore/store.js';
import { configPath } from './paths.js';

// The HOSTED "shared knowledge" route. webnav's map can be consumed two ways:
//   - self-host (default): the local ~/.webnav/webnav.db, built/seeded by the user.
//   - hosted: fetch a maintained site map LIVE from the webnav service, per use.
//
// HARD INVARIANT (CLAUDE.md): the hosted route serves the MAP SKELETON ONLY
// (states/edges/affordances). It NEVER sends or receives credentials — site
// logins stay in the local CredStore (~/.webnav/credentials.json) and are filled
// by the live browser on the user's machine at walk time. A MapPack therefore has
// no credential fields, and fetchHostedMap sends only the API key + site id.

export interface MapPack { node: SiteNode; states: State[] }

export interface HostedConfig { apiKey?: string; apiBase?: string }

const DEFAULT_API_BASE = 'https://webnav.qzz.io';

/** Where the CLI looks for the hosted API base + key, in priority order:
 *  explicit arg → env (WEBNAV_API / WEBNAV_KEY) → ~/.webnav/config.json → default. */
export function readConfig(): HostedConfig {
  const path = configPath();
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, 'utf8')) as HostedConfig; }
  catch { return {}; }
}

/** Persist the hosted API key (and optional base) to ~/.webnav/config.json.
 *  This file holds ONLY the service key — never site credentials. */
export function saveConfig(cfg: HostedConfig): void {
  const path = configPath();
  const merged = { ...readConfig(), ...cfg };
  writeFileSync(path, JSON.stringify(merged, null, 2), { mode: 0o600 });
}

export function resolveApiBase(explicit?: string): string {
  return explicit ?? process.env.WEBNAV_API ?? readConfig().apiBase ?? DEFAULT_API_BASE;
}

export function resolveApiKey(explicit?: string): string | undefined {
  return explicit ?? process.env.WEBNAV_KEY ?? readConfig().apiKey;
}

export type FetchFn = (url: string, init?: { headers?: Record<string, string> }) =>
  Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * Fetch one site's map pack LIVE from the hosted service (the metered hot path).
 * Sends ONLY the site id (in the URL) and the API key (header) — never any
 * credential. Throws a clear, actionable error on missing key / quota / network.
 * `fetchImpl` is injectable for tests (defaults to global fetch).
 */
export async function fetchHostedMap(
  site: string,
  opts: { key?: string; apiBase?: string; fetchImpl?: FetchFn } = {},
): Promise<MapPack> {
  const key = resolveApiKey(opts.key);
  if (!key) {
    throw new Error(
      'hosted route needs an API key. Get a free key at the webnav site, then run ' +
      '`webnav login <key>` — or use the free self-host route (drop --hosted).');
  }
  const base = resolveApiBase(opts.apiBase).replace(/\/$/, '');
  const doFetch = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchFn);
  const url = `${base}/api/maps/${encodeURIComponent(site)}`;
  const res = await doFetch(url, { headers: { 'X-Webnav-Key': key } });
  if (res.status === 401) throw new Error('hosted route: invalid or unknown API key (re-run `webnav login <key>`).');
  if (res.status === 429) throw new Error('hosted route: usage quota exceeded for this key — upgrade your tier or use the self-host route.');
  if (res.status === 404) throw new Error(`hosted route: no shared map for "${site}" yet.`);
  if (!res.ok) throw new Error(`hosted route: API error ${res.status} fetching "${site}".`);
  const pack = await res.json() as MapPack;
  if (!pack || !pack.node || !Array.isArray(pack.states)) {
    throw new Error(`hosted route: malformed map pack for "${site}".`);
  }
  return pack;
}

/** Import a fetched map pack into a store via the existing idempotent upserts, so
 *  the SAME walkRoute can travel it. Pure map data — no credentials involved. */
export function importMapPack(store: IMapStore, pack: MapPack): void {
  store.transaction(() => {
    store.upsertNode(pack.node);
    for (const s of pack.states) store.upsertState(s);
  });
}
