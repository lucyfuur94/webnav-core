// Maintainer tool: publish a site's map from the LOCAL webnav.db into the central
// Turso store, so hosted-route users can fetch it. Reads the local map via the
// CLI's MapStore (the same getNode/statesForNode the export uses) and upserts the
// serialized pack. Publishes the SKELETON ONLY — there are no credentials in the
// map to begin with.
//
// Usage:
//   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... \
//   tsx site/scripts/publish-map.ts www.saucedemo.com [more.site ...]
//
// (Run from the repo root so the relative import resolves; needs the site deps.)

import { createClient } from '@libsql/client';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MapStore } from '../../src/mapstore/store.js';

async function main() {
  const sites = process.argv.slice(2);
  if (sites.length === 0) {
    console.error('usage: publish-map <site> [site ...]  (e.g. www.saucedemo.com)');
    process.exit(2);
  }
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) { console.error('TURSO_DATABASE_URL not set'); process.exit(2); }
  const c = createClient({ url, authToken });

  // ensure schema exists
  const here = dirname(fileURLToPath(import.meta.url));
  const schema = readFileSync(join(here, '..', 'db', 'schema.sql'), 'utf8');
  for (const stmt of schema.split(';').map((s) => s.trim()).filter(Boolean)) {
    await c.execute(stmt);
  }

  const store = new MapStore();   // reads ~/.webnav/webnav.db (or WEBNAV_DB)
  for (const site of sites) {
    const node = store.getNode(site);
    const states = store.statesForNode(site);
    if (!node || states.length === 0) {
      console.error(`skip ${site}: no map in local webnav.db (build/seed it first)`);
      continue;
    }
    await c.execute({
      sql: `INSERT INTO shared_maps (site, node_json, states_json, state_count, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(site) DO UPDATE SET node_json=excluded.node_json,
              states_json=excluded.states_json, state_count=excluded.state_count,
              updated_at=excluded.updated_at`,
      args: [site, JSON.stringify(node), JSON.stringify(states), states.length, Date.now()],
    });
    console.log(`published ${site} (${states.length} states)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
