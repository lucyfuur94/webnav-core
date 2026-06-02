import { createServer, type Server } from 'node:http';
import type { IMapStore } from './mapstore/store.js';
import { buildGraphView } from './graph/export.js';
import { buildNodeInterior } from './graph/interior.js';
import { renderGraphHtml } from './graph/html.js';

/**
 * A read-only HTTP server over the live map. webnav's only long-lived process —
 * deliberately dumb: it reads SQLite and serves JSON; it never writes and holds
 * no navigation logic. Bind 127.0.0.1 (localhost, single user, no auth/CORS).
 */
export function startServer(store: IMapStore, port = 7777): Server {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const send = (code: number, body: string, type = 'application/json') => {
      res.writeHead(code, { 'content-type': type }); res.end(body);
    };
    try {
      if (req.method !== 'GET') return send(405, JSON.stringify({ error: 'method not allowed' }));

      if (url.pathname === '/') {
        return send(200, renderGraphHtml(buildGraphView(store), { live: true }), 'text/html; charset=utf-8');
      }
      if (url.pathname === '/api/graph') {
        return send(200, JSON.stringify(buildGraphView(store)));
      }
      const m = url.pathname.match(/^\/api\/node\/([^/]+)\/interior$/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        if (!store.getNode(id)) return send(404, JSON.stringify({ error: 'unknown node' }));
        return send(200, JSON.stringify(buildNodeInterior(store, id)));
      }
      return send(404, JSON.stringify({ error: 'not found' }));
    } catch (e) {
      send(500, JSON.stringify({ error: String(e) }));
    }
  });
  // A clear message + nonzero exit on a bind failure (e.g. port already in use),
  // instead of an unhandled 'error' event dumping a raw stack trace.
  server.on('error', (err: NodeJS.ErrnoException) => {
    const hint = err.code === 'EADDRINUSE'
      ? `port ${port} is already in use — set WEBNAV_PORT to a free port`
      : err.message;
    process.stderr.write(`webnav server: ${hint}\n`);
    process.exitCode = 2;
  });
  server.listen(port, '127.0.0.1');
  return server;
}
