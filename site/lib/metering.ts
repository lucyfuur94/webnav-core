import { quotaFor } from './pricing';

// PURE hosted-route logic — no libSQL import, so it's unit-testable without the
// Turso client dependency. The DB is a tiny injectable seam (see lib/db.ts for
// the real libSQL-backed implementation + an in-memory fake in tests).
//
// INVARIANT: nothing here reads or writes credentials — only map skeletons,
// keys, and usage counts.

export interface Db {
  getKey(key: string): Promise<{ key: string; tier: string } | null>;
  usageCount(key: string, period: string): Promise<number>;
  recordUsage(key: string, site: string, period: string, ts: number): Promise<void>;
  getMap(site: string): Promise<{ node: unknown; states: unknown[] } | null>;
  listMaps(): Promise<{ site: string; stateCount: number }[]>;
  putKey(key: string, tier: string, email: string | null, ts: number): Promise<void>;
}

/** 'YYYY-MM' (UTC) for a timestamp — the monthly bucket usage is counted in. */
export function period(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export type MapServeResult =
  | { status: 200; pack: { node: unknown; states: unknown[] } }
  | { status: 401 | 404 | 429; error: string };

/**
 * The metered hot path: validate key → check monthly quota → fetch map → record
 * one usage → return. Pure w.r.t. the Db seam; `ts`/`per` passed in for
 * determinism. Over-quota and not-found requests do NOT record usage.
 */
export async function serveMapMetered(db: Db, key: string | null, site: string, ts: number, per: string): Promise<MapServeResult> {
  if (!key) return { status: 401, error: 'missing API key' };
  const row = await db.getKey(key);
  if (!row) return { status: 401, error: 'invalid API key' };
  const quota = quotaFor(row.tier);
  if (quota !== null) {
    const used = await db.usageCount(key, per);
    if (used >= quota) return { status: 429, error: 'monthly quota exceeded' };
  }
  const pack = await db.getMap(site);
  if (!pack) return { status: 404, error: 'no shared map for this site' };
  await db.recordUsage(key, site, per, ts);
  return { status: 200, pack };
}
