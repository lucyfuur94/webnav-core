import Database from 'better-sqlite3';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Per-host politeness throttle: a minimum interval between page-OPENS to the same host, so a
// burst of CLI invocations can't hammer one site into a bot-wall (the OrangeHRM incident).
// This is POLITENESS, not evasion — it slows webnav down, it never disguises it (the hard
// no-evasion line, CLAUDE.md). Bot-walls are still detected + escalated; this just stops us
// provoking one. Each CLI call is a separate PROCESS, so the last-open time must persist
// CROSS-process — backed by sqlite (file-locked UPSERT) rather than a lockfree JSON that
// would race under the exact 100-process burst it targets.

export const DEFAULT_HOST_INTERVAL_MS = 1000;

/** Min interval (ms) between opens to one host, from `WEBNAV_HOST_INTERVAL_MS`. 0/garbage → 0 (off). */
export function intervalMs(envValue: string | undefined): number {
  if (!envValue) return DEFAULT_HOST_INTERVAL_MS;
  const n = Number(envValue);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_HOST_INTERVAL_MS;
}

/** How long to wait before opening `host` again. Pure. last=null (never seen) or interval≤0 → 0. */
export function delayFor(lastOpenMs: number | null, nowMs: number, interval: number): number {
  if (lastOpenMs === null || interval <= 0) return 0;
  const elapsed = nowMs - lastOpenMs;
  return elapsed >= interval ? 0 : interval - elapsed;
}

/** Host of a URL, or null for globs / about:blank / non-URLs (→ skip the throttle). Never throws. */
export function hostOf(url: string): string | null {
  if (!url || url.startsWith('about:') || url.includes('*')) return null;
  try { const h = new URL(url).host; return h || null; } catch { return null; }
}

// ─── sqlite persistence (cross-process, file-locked) ──────────────────────────
function throttleDbPath(): string {
  // sibling of the creds/config dir; its own tiny db so it never contends with the map db
  return join(homedir(), '.webnav', 'throttle.db');
}

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  const d = new Database(throttleDbPath());
  d.pragma('journal_mode = WAL');           // concurrent readers + a writer
  d.pragma('busy_timeout = 2000');          // wait out a lock under the burst rather than throw
  d.exec('CREATE TABLE IF NOT EXISTS host_last_open (host TEXT PRIMARY KEY, ts INTEGER NOT NULL)');
  _db = d;
  return d;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Throttle an open to `url`'s host: read the last-open time, sleep the remaining interval if
 * any, then record now as the new last-open (atomic UPSERT under the busy_timeout lock).
 * No-ops for hostless urls (globs/about:blank) and when the interval is 0. Best-effort: any
 * db error degrades to no-throttle so housekeeping never breaks the actual open.
 */
export async function throttleOpen(url: string, nowMs: number = Date.now()): Promise<void> {
  const interval = intervalMs(process.env.WEBNAV_HOST_INTERVAL_MS);
  const host = hostOf(url);
  if (!host || interval <= 0) return;
  try {
    const d = db();
    const row: any = d.prepare('SELECT ts FROM host_last_open WHERE host=?').get(host);
    const wait = delayFor(row ? row.ts : null, nowMs, interval);
    if (wait > 0) await sleep(wait);
    d.prepare('INSERT INTO host_last_open (host, ts) VALUES (?, ?) ON CONFLICT(host) DO UPDATE SET ts=excluded.ts')
      .run(host, Date.now());
  } catch { /* never break a real open on a throttle-bookkeeping failure */ }
}
