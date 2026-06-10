import { createClient, type Client } from '@libsql/client';
import type { Db } from './metering';

// libSQL (Turso)-backed implementation of the pure `Db` seam in metering.ts.
// Kept separate so the metered hot-path logic can be unit-tested WITHOUT the
// libSQL dependency. Re-export the pure helpers for convenient API-route imports.
export { serveMapMetered, period, type Db, type MapServeResult } from './metering';

// INVARIANT: only map skeletons, keys, and usage — never credentials.

let _client: Client | null = null;
export function client(): Client {
  if (_client) return _client;
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error('TURSO_DATABASE_URL not set');
  _client = createClient({ url, authToken });
  return _client;
}

export function libsqlDb(c: Client = client()): Db {
  return {
    async getKey(key) {
      const r = await c.execute({ sql: 'SELECT key, tier FROM api_keys WHERE key = ?', args: [key] });
      const row = r.rows[0];
      return row ? { key: String(row.key), tier: String(row.tier) } : null;
    },
    async usageCount(key, per) {
      const r = await c.execute({ sql: 'SELECT COUNT(*) AS n FROM usage WHERE key = ? AND period = ?', args: [key, per] });
      return Number(r.rows[0]?.n ?? 0);
    },
    async recordUsage(key, site, per, ts) {
      await c.execute({ sql: 'INSERT INTO usage (key, site, action, ts, period) VALUES (?, ?, ?, ?, ?)', args: [key, site, 'map-fetch', ts, per] });
    },
    async getMap(site) {
      const r = await c.execute({ sql: 'SELECT node_json, states_json FROM shared_maps WHERE site = ?', args: [site] });
      const row = r.rows[0];
      if (!row) return null;
      return { node: JSON.parse(String(row.node_json)), states: JSON.parse(String(row.states_json)) };
    },
    async listMaps() {
      const r = await c.execute('SELECT site, state_count FROM shared_maps ORDER BY site');
      return r.rows.map((row) => ({ site: String(row.site), stateCount: Number(row.state_count) }));
    },
    async putKey(key, tier, email, ts) {
      await c.execute({ sql: 'INSERT INTO api_keys (key, tier, email, created_at) VALUES (?, ?, ?, ?)', args: [key, tier, email, ts] });
    },
  };
}
