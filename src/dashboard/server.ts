import { createServer, type Server } from 'node:http';
import type { IMapStore } from '../mapstore/store.js';
import type { CredStore, CredCategory } from '../creds.js';
import { SHELL_HTML } from './shell.js';

/**
 * webnav's local OPERATOR dashboard — a single long-lived process that lets a
 * human inspect what webnav knows (sites + their JSON map) and manage the login
 * credentials webnav uses. Bind 127.0.0.1 ONLY (single user, no auth/CORS): this
 * is a local tool and credential plaintext must never leave the machine. The
 * server reads SQLite (via MapStore) and the creds file (via CredStore); the only
 * writes are credential set/remove/recategorize, which go through CredStore (chmod 600).
 */
export interface DashboardOpts {
  port?: number;
}

const HTML = 'text/html; charset=utf-8';
const VALID_CATEGORIES: CredCategory[] = ['login', 'personal', 'other'];

export function startDashboard(store: IMapStore, creds: CredStore, opts: DashboardOpts = {}): Server {
  const port = opts.port ?? 7777;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;
    const method = req.method ?? 'GET';
    const sendJson = (code: number, body: unknown) =>
      res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(body));

    try {
      // ---- the dashboard shell (sites + credentials tabs) ----
      if (path === '/' && method === 'GET') return res.writeHead(200, { 'content-type': HTML }).end(SHELL_HTML);

      // ---- SITES (read-only) ----
      if (path === '/api/sites' && method === 'GET') {
        const sites = store.allNodes().map((n) => ({
          id: n.id, homeUrl: n.homeUrl, capabilities: n.capabilities, topics: n.topics,
          stateCount: store.statesForNode(n.id).length,
        }));
        return sendJson(200, sites);
      }
      const siteM = path.match(/^\/api\/sites\/([^/]+)$/);
      if (siteM && method === 'GET') {
        const id = decodeURIComponent(siteM[1]);
        const node = store.getNode(id);
        if (!node) return sendJson(404, { error: 'unknown site' });
        return sendJson(200, {
          node,
          states: store.statesForNode(id),
          interiorEdges: store.interiorEdges(id),
        });
      }

      // ---- CREDENTIALS (read masked+categorized · reveal one · write/remove/recategorize) ----
      if (path === '/api/creds' && method === 'GET') {
        return sendJson(200, creds.listDetailed());   // key names + categories — never values
      }
      // recategorize: PATCH /api/creds/:site/:key/category  body { category }
      const catM = path.match(/^\/api\/creds\/([^/]+)\/([^/]+)\/category$/);
      if (catM && method === 'POST') {
        const site = decodeURIComponent(catM[1]);
        const key = decodeURIComponent(catM[2]);
        const body = await readBody(req);
        let parsed: { category?: string };
        try { parsed = JSON.parse(body || '{}'); } catch { return sendJson(400, { error: 'invalid JSON body' }); }
        if (!parsed.category || !VALID_CATEGORIES.includes(parsed.category as CredCategory)) {
          return sendJson(400, { error: 'category must be one of ' + VALID_CATEGORIES.join(', ') });
        }
        const ok = creds.setCategory(site, key, parsed.category as CredCategory);
        return sendJson(ok ? 200 : 404, { site, key, category: parsed.category, ok });
      }
      const credKeyM = path.match(/^\/api\/creds\/([^/]+)\/([^/]+)$/);
      if (credKeyM && method === 'GET') {
        // reveal-on-demand: the ONLY route that returns a plaintext value (localhost only)
        const site = decodeURIComponent(credKeyM[1]);
        const key = decodeURIComponent(credKeyM[2]);
        const value = creds.get(site)[key];
        if (value === undefined) return sendJson(404, { error: 'unknown credential' });
        return sendJson(200, { site, key, value });
      }
      if (credKeyM && method === 'DELETE') {
        const site = decodeURIComponent(credKeyM[1]);
        const key = decodeURIComponent(credKeyM[2]);
        const removed = creds.remove(site, key);
        return sendJson(removed ? 200 : 404, { site, key, removed });
      }
      const credSiteM = path.match(/^\/api\/creds\/([^/]+)$/);
      if (credSiteM && method === 'POST') {
        // set/update one slot's VALUE (also used by inline-edit). Optional category;
        // omitted → CredStore preserves an existing key's category or infers a default.
        const site = decodeURIComponent(credSiteM[1]);
        const body = await readBody(req);
        let parsed: { key?: string; value?: string; category?: string };
        try { parsed = JSON.parse(body || '{}'); } catch { return sendJson(400, { error: 'invalid JSON body' }); }
        if (!parsed.key || typeof parsed.value !== 'string') {
          return sendJson(400, { error: 'body must be { key, value, category? }' });
        }
        if (parsed.category && !VALID_CATEGORIES.includes(parsed.category as CredCategory)) {
          return sendJson(400, { error: 'category must be one of ' + VALID_CATEGORIES.join(', ') });
        }
        const keys = creds.set(site, { [parsed.key]: parsed.value }, parsed.category as CredCategory | undefined);
        return sendJson(200, { site, keys });
      }
      if (credSiteM && method === 'DELETE') {
        const site = decodeURIComponent(credSiteM[1]);
        const removed = creds.remove(site);
        return sendJson(removed ? 200 : 404, { site, removed });
      }

      if (method !== 'GET' && method !== 'POST' && method !== 'DELETE') {
        return sendJson(405, { error: 'method not allowed' });
      }
      return sendJson(404, { error: 'not found', path });
    } catch (e) {
      sendJson(500, { error: String(e) });
    }
  });

  // Clear message + nonzero exit on bind failure (e.g. port in use) instead of a raw stack.
  server.on('error', (err: NodeJS.ErrnoException) => {
    const hint = err.code === 'EADDRINUSE'
      ? `port ${port} is already in use — set WEBNAV_PORT or pass --port <n>`
      : err.message;
    process.stderr.write(`webnav dashboard: ${hint}\n`);
    process.exitCode = 2;
  });

  server.listen(port, '127.0.0.1');
  return server;
}

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1_000_000) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
