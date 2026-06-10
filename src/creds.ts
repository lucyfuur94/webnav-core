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
// Each credential carries a CATEGORY (login | personal | other) so the dashboard
// can group them (a password is not the same kind of thing as a zip code). The
// category is inferred from the key name on add, and overridable. On disk a key
// is stored as { value, category }; LEGACY bare-string values (`key: "val"`) are
// still read and normalized (category inferred), so old files keep working.
//
// Override the path with WEBNAV_CREDS (used by tests).

export type CredCategory = 'login' | 'personal' | 'other';
export interface CredEntry { value: string; category: CredCategory }

// The flat slot→value map the WALK fills inputs from (unchanged contract).
export type SiteCreds = Record<string, string>;
// The detailed slot→{value,category} map the DASHBOARD uses.
export type SiteCredsDetailed = Record<string, CredEntry>;

// On-disk a value may be the new {value,category} object OR a legacy bare string.
type StoredEntry = CredEntry | string;
type StoredSite = Record<string, StoredEntry>;
type CredFile = Record<string, StoredSite>;

export function credsPath(): string {
  return process.env.WEBNAV_CREDS ?? join(homedir(), '.webnav', 'credentials.json');
}

// Infer a credential's category from its key name. Conservative: anything not
// recognized as a login secret or a piece of personal info falls back to 'other'.
const LOGIN_KEYS = /^(user(name)?|login|email|e-?mail|pass(word|wd)?|pin|otp|token|secret|api[-_]?key)$/i;
const PERSONAL_KEYS = /^(first[-_]?name|last[-_]?name|full[-_]?name|name|phone|mobile|tel|address|street|city|state|country|zip|postal[-_]?code|postcode|dob|birth|gender|company)$/i;
export function categorize(key: string): CredCategory {
  if (LOGIN_KEYS.test(key)) return 'login';
  if (PERSONAL_KEYS.test(key)) return 'personal';
  return 'other';
}

// Normalize a stored entry (legacy string OR object) to a full CredEntry.
function normalize(key: string, e: StoredEntry): CredEntry {
  if (typeof e === 'string') return { value: e, category: categorize(key) };
  return { value: e.value, category: e.category ?? categorize(key) };
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

  /** All creds for a site as a flat slot→value map (the walk fills inputs from
   *  this — the contract the walk depends on, unchanged). Legacy + new shapes
   *  both flatten to value strings here. */
  get(site: string): SiteCreds {
    const stored = this.read()[site] ?? {};
    const out: SiteCreds = {};
    for (const [k, e] of Object.entries(stored)) out[k] = normalize(k, e).value;
    return out;
  }

  /** All creds for a site WITH categories (for the dashboard). */
  getDetailed(site: string): SiteCredsDetailed {
    const stored = this.read()[site] ?? {};
    const out: SiteCredsDetailed = {};
    for (const [k, e] of Object.entries(stored)) out[k] = normalize(k, e);
    return out;
  }

  /** Merge key/values into a site's creds (existing keys overwritten). Category
   *  is inferred per key unless `category` is supplied (applies to all keys set
   *  in this call). Returns the site's key names after the merge. */
  set(site: string, values: SiteCreds, category?: CredCategory): string[] {
    const data = this.read();
    const site_creds: StoredSite = { ...(data[site] ?? {}) };
    for (const [k, v] of Object.entries(values)) {
      // Preserve an existing key's category on a value-only update unless told otherwise.
      const existing = site_creds[k] ? normalize(k, site_creds[k]).category : undefined;
      site_creds[k] = { value: v, category: category ?? existing ?? categorize(k) };
    }
    data[site] = site_creds;
    this.write(data);
    return Object.keys(data[site]);
  }

  /** Change just the CATEGORY of an existing key (value untouched). Returns true
   *  if the key existed. */
  setCategory(site: string, key: string, category: CredCategory): boolean {
    const data = this.read();
    if (!data[site] || !(key in data[site])) return false;
    const { value } = normalize(key, data[site][key]);
    data[site][key] = { value, category };
    this.write(data);
    return true;
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

  /** Sites + their KEY names only — never the values (for `creds list`). Shape
   *  unchanged so the CLI JSON contract stays stable. */
  list(): { site: string; keys: string[] }[] {
    const data = this.read();
    return Object.keys(data).sort().map((site) => ({ site, keys: Object.keys(data[site]).sort() }));
  }

  /** Like list() but with each key's CATEGORY (still never the values). Lets the
   *  dashboard group by category without revealing anything. */
  listDetailed(): { site: string; keys: { name: string; category: CredCategory }[] }[] {
    const data = this.read();
    return Object.keys(data).sort().map((site) => ({
      site,
      keys: Object.keys(data[site]).sort().map((name) => ({ name, category: normalize(name, data[site][name]).category })),
    }));
  }
}
