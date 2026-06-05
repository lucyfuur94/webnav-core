import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { MapStore } from '../src/mapstore/store.js';
import { startServer, serveStatic } from '../src/server.js';
import type { Server } from 'node:http';

const store = MapStore.fromDatabase(new Database(':memory:'));
let dist: string;
let server: Server;
let base: string;

beforeAll(async () => {
  dist = mkdtempSync(join(tmpdir(), 'webdist-'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>webnav</title>');
  mkdirSync(join(dist, 'assets'));
  writeFileSync(join(dist, 'assets', 'app.js'), 'console.log("hi")');
  server = startServer(store, 0, dist);
  await new Promise((r) => server.once('listening', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});
afterAll(() => { server.close(); rmSync(dist, { recursive: true, force: true }); });

describe('serveStatic', () => {
  it('serves index.html at /', async () => {
    const r = await fetch(`${base}/`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/html');
    expect(await r.text()).toContain('webnav');
  });
  it('serves an asset with a js content-type', async () => {
    const r = await fetch(`${base}/assets/app.js`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('javascript');
  });
  it('blocks path traversal (direct — HTTP clients normalize `..` away)', () => {
    // fetch() collapses `../` before sending, so the guard can't be exercised
    // over the wire; call serveStatic directly with a malicious path.
    let code = 0;
    serveStatic('/../../../etc/passwd', dist, (c) => { code = c; });
    expect([403, 404]).toContain(code);
  });
  it('still serves the JSON API', async () => {
    const r = await fetch(`${base}/api/graph`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('application/json');
  });
  it('falls back to index.html for an unknown non-api path (SPA)', async () => {
    const r = await fetch(`${base}/some/client/route`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('webnav');
  });
});

describe('serveStatic — missing dist', () => {
  it('returns a build hint when dist is absent', async () => {
    const missing = join(tmpdir(), 'definitely-not-built-xyz');
    const s2 = startServer(store, 0, missing);
    await new Promise((r) => s2.once('listening', r));
    const addr = s2.address();
    const b2 = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    const r = await fetch(`${b2}/`);
    expect(r.status).toBe(503);
    expect(await r.text()).toMatch(/npm run build/);
    s2.close();
  });
});
