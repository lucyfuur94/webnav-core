import { createServer, type Server } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import type { IMapStore } from '../mapstore/store.js';
import type { CredStore, CredCategory } from '../creds.js';
import type { RecordSessionInfo } from '../mapstore/record.js';
import type { ReplayState } from '../recorder/replay.js';
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

/**
 * Human-session recording + replay, injected so the dashboard doesn't hard-depend
 * on the recorder/playwright stack. Absent (undefined) → recordings routes 503.
 */
export interface RecordingsDeps {
  list(): RecordSessionInfo[];
  steps(id: string): { seq: number; label: string; kind: string; toUrl: string; capturedAt: number }[];
  del(id: string): void;
  draft(id: string): unknown;
  open(url: string, session: string, persistent: boolean): Promise<{ ok: true } | { ok: false; error: string }>;
  record(id: string): boolean;
  stop(id: string): boolean;
  replay(id: string): Promise<{ ok: true } | { ok: false; error: string }>;
  replayState(): ReplayState | null;
  replayControl(action: string, payload: { value?: string; save?: boolean; fire?: boolean }): boolean;
  shotPath(session: string, file: string): string | null;
  toggle(id: string, desired?: boolean): { recording: boolean };
  videos(id: string): string[];
  videoPath(session: string, file: string): string | null;
  subscribe(cb: (type: string) => void): () => void;    // realtime push (SSE) — emits 'sessions' | 'step' | 'replay'
}

const HTML = 'text/html; charset=utf-8';
const VALID_CATEGORIES: CredCategory[] = ['login', 'personal', 'other'];

export function startDashboard(
  store: IMapStore,
  creds: CredStore,
  opts: DashboardOpts = {},
  rec?: RecordingsDeps,
): Server {
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

      // ---- RECORDINGS + REPLAY (human-session recorder; injected — 503 when not wired) ----
      if (path.startsWith('/api/recordings') || path.startsWith('/api/replay') || path.startsWith('/replays/') || path.startsWith('/recordings-media/') || path === '/api/events') {
        if (!rec) return sendJson(503, { error: 'recordings not wired' });

        if (path === '/api/recordings' && method === 'GET') return sendJson(200, rec.list());

        // realtime push: Server-Sent Events. The shell's EventSource replaces polling.
        if (path === '/api/events' && method === 'GET') {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
          res.write(': connected\n\n');
          const un = rec.subscribe((type) => res.write('data: ' + type + '\n\n'));
          const beat = setInterval(() => res.write(': ping\n\n'), 15000);
          req.on('close', () => { clearInterval(beat); un(); });
          return;
        }

        const toggleM = path.match(/^\/api\/recordings\/([^/]+)\/toggle$/);
        if (toggleM && method === 'POST') {
          // optional {recording: boolean} = DESIRED state (idempotent; the page pill
          // sends this so a stale visual can't double-toggle). No body → flip.
          let desired: boolean | undefined;
          try { const b = JSON.parse((await readBody(req)) || '{}'); if (typeof b.recording === 'boolean') desired = b.recording; } catch { /* flip */ }
          return sendJson(200, rec.toggle(decodeURIComponent(toggleM[1]), desired));
        }

        const vidsM = path.match(/^\/api\/recordings\/([^/]+)\/videos$/);
        if (vidsM && method === 'GET') return sendJson(200, rec.videos(decodeURIComponent(vidsM[1])));

        const stepsM = path.match(/^\/api\/recordings\/([^/]+)\/steps$/);
        if (stepsM && method === 'GET') return sendJson(200, rec.steps(decodeURIComponent(stepsM[1])));

        const draftM = path.match(/^\/api\/recordings\/([^/]+)\/draft$/);
        if (draftM && method === 'GET') return sendJson(200, rec.draft(decodeURIComponent(draftM[1])));

        if (path === '/api/recordings/open' && method === 'POST') {
          const body = await readBody(req);
          let parsed: { url?: string; session?: string; persistent?: boolean };
          try { parsed = JSON.parse(body || '{}'); } catch { return sendJson(400, { error: 'invalid JSON body' }); }
          if (!parsed.url || !parsed.session) return sendJson(400, { error: 'body must be { url, session, persistent? }' });
          const result = await rec.open(parsed.url, parsed.session, !!parsed.persistent);
          return sendJson(result.ok ? 200 : 409, result);
        }

        const recordM = path.match(/^\/api\/recordings\/([^/]+)\/record$/);
        if (recordM && method === 'POST') {
          const ok = rec.record(decodeURIComponent(recordM[1]));
          return sendJson(ok ? 200 : 404, { ok });
        }
        const stopM = path.match(/^\/api\/recordings\/([^/]+)\/stop$/);
        if (stopM && method === 'POST') {
          const ok = rec.stop(decodeURIComponent(stopM[1]));
          return sendJson(ok ? 200 : 404, { ok });
        }
        const replayM = path.match(/^\/api\/recordings\/([^/]+)\/replay$/);
        if (replayM && method === 'POST') {
          const result = await rec.replay(decodeURIComponent(replayM[1]));
          return sendJson(result.ok ? 200 : 409, result);
        }

        if (path === '/api/replay/status' && method === 'GET') {
          return sendJson(200, rec.replayState() ?? { running: false });
        }
        if (path === '/api/replay/control' && method === 'POST') {
          const body = await readBody(req);
          let parsed: { action?: string; value?: string; save?: boolean; fire?: boolean };
          try { parsed = JSON.parse(body || '{}'); } catch { return sendJson(400, { error: 'invalid JSON body' }); }
          if (!parsed.action) return sendJson(400, { error: 'body must be { action, value?, save?, fire? }' });
          const ok = rec.replayControl(parsed.action, { value: parsed.value, save: parsed.save, fire: parsed.fire });
          return sendJson(ok ? 200 : 400, { ok });
        }

        const vidM = path.match(/^\/recordings-media\/([^/]+)\/([^/]+\.webm)$/);
        if (vidM && method === 'GET') {
          const vp = rec.videoPath(decodeURIComponent(vidM[1]), decodeURIComponent(vidM[2]));
          if (!vp || !existsSync(vp)) return sendJson(404, { error: 'not found' });
          const vs = createReadStream(vp);
          vs.on('error', () => { if (!res.headersSent) sendJson(404, { error: 'not found' }); else res.destroy(); });
          res.writeHead(200, { 'content-type': 'video/webm' });
          return vs.pipe(res);
        }

        const shotM = path.match(/^\/replays\/([^/]+)\/([^/]+\.png)$/);
        if (shotM && method === 'GET') {
          const shotPath = rec.shotPath(decodeURIComponent(shotM[1]), decodeURIComponent(shotM[2]));
          if (!shotPath || !existsSync(shotPath)) return sendJson(404, { error: 'not found' });
          const stream = createReadStream(shotPath);
          // file can vanish between existsSync and open (recording deleted mid-view) —
          // without this handler that's an unhandled stream error (final-review #4).
          stream.on('error', () => { if (!res.headersSent) sendJson(404, { error: 'not found' }); else res.destroy(); });
          res.writeHead(200, { 'content-type': 'image/png' });
          return stream.pipe(res);
        }

        const delM = path.match(/^\/api\/recordings\/([^/]+)$/);
        if (delM && method === 'DELETE') {
          rec.del(decodeURIComponent(delM[1]));
          return sendJson(200, { ok: true });
        }
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
