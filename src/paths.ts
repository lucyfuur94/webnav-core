import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

// Single source of truth for where webnav keeps its STATE on a laptop.
//
// The map (SQLite) is a per-USER resource, not per-directory: every session and
// every agent on the machine should share ONE map regardless of which folder it
// runs webnav from. So the DB lives at ~/.webnav/webnav.db (next to the creds
// file at ~/.webnav/credentials.json), NOT as a CWD-relative 'webnav.db' — the
// latter silently gave each working directory its own map ("works in one
// terminal, empty in another"). WEBNAV_DB overrides (tests pass ':memory:').

export function webnavDir(): string {
  const dir = join(homedir(), '.webnav');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** The shared map DB path. Honors WEBNAV_DB (override / tests); otherwise the
 *  per-user ~/.webnav/webnav.db. Ensures ~/.webnav exists for a real file path
 *  (an in-memory ':memory:' override needs no directory). */
export function dbPath(): string {
  const override = process.env.WEBNAV_DB;
  if (override) return override;
  return join(webnavDir(), 'webnav.db');
}

/** Non-secret CLI config (the hosted-route API key + optional API base URL) at
 *  ~/.webnav/config.json. SEPARATE from credentials.json (site logins) and the
 *  map DB — this only holds the hosted-service key, never site credentials.
 *  Honors WEBNAV_CONFIG (tests). */
export function configPath(): string {
  return process.env.WEBNAV_CONFIG ?? join(webnavDir(), 'config.json');
}
