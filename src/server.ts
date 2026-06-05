import { createServer, type Server } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, normalize, extname, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IMapStore } from './mapstore/store.js';
import { buildGraphView } from './graph/export.js';
import { buildNodeInterior } from './graph/interior.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.map': 'application/json',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
};

// Default dist dir: ../web/dist relative to the BUILT server file (dist/server.js).
const DEFAULT_DIST = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist');

/**
 * A read-only HTTP server over the live map. webnav's only long-lived process —
 * deliberately dumb: it reads SQLite + serves the static viewer; it never writes
 * and holds no navigation logic. Bind 127.0.0.1 (single user, no auth/CORS).
 */
export function startServer(store: IMapStore, port = 7777, distDir: string = DEFAULT_DIST): Server {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const send = (code: number, body: string, type = 'application/json') => {
      res.writeHead(code, { 'content-type': type }); res.end(body);
    };
    try {
      if (req.method !== 'GET') return send(405, JSON.stringify({ error: 'method not allowed' }));

      // ── API (unchanged, read-only) ──
      if (url.pathname === '/api/graph') {
        return send(200, JSON.stringify(buildGraphView(store)));
      }
      const m = url.pathname.match(/^\/api\/node\/([^/]+)\/interior$/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        if (!store.getNode(id)) return send(404, JSON.stringify({ error: 'unknown node' }));
        return send(200, JSON.stringify(buildNodeInterior(store, id)));
      }

      // ── Static viewer (web/dist) ──
      return serveStatic(url.pathname, distDir, send);
    } catch (e) {
      send(500, JSON.stringify({ error: String(e) }));
    }
  });
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

/** Serve a file from distDir; SPA-fallback to index.html; guard traversal.
 *  Exported so the traversal guard can be unit-tested directly — over HTTP,
 *  clients normalize `..` out of the path before it ever reaches the server. */
export function serveStatic(
  pathname: string, distDir: string,
  send: (code: number, body: string, type?: string) => void,
): void {
  if (!existsSync(distDir)) {
    return send(503, 'webnav viewer not built — run `npm run build` first.', 'text/plain; charset=utf-8');
  }
  // Reject any `..` segment outright (defense-in-depth). Note: over HTTP, clients
  // collapse `..` before sending, so this guard is exercised by the direct unit
  // test. We check the DECODED path so `%2e%2e` can't smuggle a `..` past us.
  const decoded = decodeURIComponent(pathname);
  if (decoded.split(/[/\\]/).includes('..')) {
    return send(403, 'forbidden', 'text/plain; charset=utf-8');
  }
  const rel = normalize(decoded);
  let filePath = resolve(distDir, '.' + (rel.startsWith('/') ? rel : '/' + rel));
  // Belt-and-suspenders: anything that still resolves outside distDir is rejected.
  if (filePath !== resolve(distDir) && !filePath.startsWith(resolve(distDir) + sep)) {
    return send(403, 'forbidden', 'text/plain; charset=utf-8');
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(distDir, 'index.html');
  }
  if (!existsSync(filePath)) return send(404, 'not found', 'text/plain; charset=utf-8');
  const body = readFileSync(filePath);
  const type = MIME[extname(filePath)] ?? 'application/octet-stream';
  send(200, body.toString('utf8'), type);
}
