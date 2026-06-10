import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

// Local credential store for sites that need a login (or other runtime input).
//
// Settled posture (principle #6 + Agent-Reach's local-only pattern): creds are
// RUNTIME values, NEVER stored in the map (SQLite) and never transmitted. They
// live in a single local JSON file at ~/.webnav/credentials.json, chmod 600
// (owner read/write only). Keyed by SITE → { slotKey: value }, where slotKey is
// what the walk's input closure reads (e.g. username / password / firstName /
// lastName / zip). The walk loads a site's creds and fills `acceptsInput` slots
// from them, so you don't pass --input on every run.
//
// Override the path with WEBNAV_CREDS (used by tests).

export type SiteCreds = Record<string, string>;
type CredFile = Record<string, SiteCreds>;

export function credsPath(): string {
  return process.env.WEBNAV_CREDS ?? join(homedir(), '.webnav', 'credentials.json');
}

export class CredStore {
  private path: string;
  constructor(path = credsPath()) { this.path = path; }

  private read(): CredFile {
    if (!existsSync(this.path)) return {};
    try { return JSON.parse(readFileSync(this.path, 'utf8')) as CredFile; }
    catch { return {}; }
  }

  private write(data: CredFile): void {
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(this.path, JSON.stringify(data, null, 2), { mode: 0o600 });
    // Re-assert 0600 in case the file already existed with looser perms.
    try { chmodSync(this.path, 0o600); } catch { /* best-effort */ }
  }

  /** All creds for a site (the slot→value map the walk fills inputs from). */
  get(site: string): SiteCreds {
    return this.read()[site] ?? {};
  }

  /** Merge the given key/values into a site's creds (existing keys overwritten). */
  set(site: string, values: SiteCreds): string[] {
    const data = this.read();
    data[site] = { ...(data[site] ?? {}), ...values };
    this.write(data);
    return Object.keys(data[site]);
  }

  /** Remove a whole site, or just one key when `key` is given. Returns true if
   *  anything was removed. */
  remove(site: string, key?: string): boolean {
    const data = this.read();
    if (!data[site]) return false;
    if (key) {
      if (!(key in data[site])) return false;
      delete data[site][key];
      if (Object.keys(data[site]).length === 0) delete data[site];
    } else {
      delete data[site];
    }
    this.write(data);
    return true;
  }

  /** Sites + their KEY names only — never the values (for `creds list`). */
  list(): { site: string; keys: string[] }[] {
    const data = this.read();
    return Object.keys(data).sort().map((site) => ({ site, keys: Object.keys(data[site]).sort() }));
  }
}
