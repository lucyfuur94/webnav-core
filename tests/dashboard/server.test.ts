import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server, AddressInfo } from 'node:net';
import { MapStore } from '../../src/mapstore/store.js';
import { seedGraph } from '../../src/graph/seed.js';
import { exploreGitHub } from '../../src/explorer/github-skeleton.js';
import { CredStore } from '../../src/creds.js';
import { startDashboard } from '../../src/dashboard/server.js';

// A localhost dashboard server over a seeded in-memory map + a temp creds file.
// No browser needed — we drive the HTTP API with fetch.
describe('startDashboard', () => {
  let server: Server;
  let base: string;
  let credsFile: string;
  let tmp: string;

  beforeAll(async () => {
    const store = new MapStore(':memory:');
    seedGraph(store);
    exploreGitHub(store);
    tmp = mkdtempSync(join(tmpdir(), 'webnav-dash-'));
    credsFile = join(tmp, 'credentials.json');
    const creds = new CredStore(credsFile);
    creds.set('www.saucedemo.com', { username: 'standard_user', password: 'secret_sauce' });

    server = startDashboard(store, creds, { port: 0 }) as unknown as Server; // port 0 = ephemeral
    await new Promise<void>((r) => server.once('listening', () => r()));
    const addr = server.address() as AddressInfo;
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(() => { server?.close(); rmSync(tmp, { recursive: true, force: true }); });

  const get = (p: string) => fetch(base + p);

  it('GET / serves the dashboard shell HTML', async () => {
    const r = await get('/');
    expect(r.headers.get('content-type')).toContain('text/html');
    const html = await r.text();
    expect(html).toContain('webnav dashboard');
  });

  it('GET /api/sites lists seeded nodes with stateCount', async () => {
    const sites = await (await get('/api/sites')).json();
    const gh = sites.find((s: any) => s.id === 'github.com');
    expect(gh).toBeTruthy();
    expect(gh.stateCount).toBe(3);            // search-entry, result-list, repo-detail
    expect(gh.capabilities).toContain('code-search');
  });

  it('GET /api/sites/:id returns node + states + interiorEdges; 404 unknown', async () => {
    const full = await (await get('/api/sites/github.com')).json();
    expect(full.node.id).toBe('github.com');
    expect(full.states.length).toBe(3);
    expect(Array.isArray(full.interiorEdges)).toBe(true);
    const r404 = await get('/api/sites/nope.example');
    expect(r404.status).toBe(404);
  });

  it('GET /api/creds returns key NAMES + categories only (no values)', async () => {
    const list = await (await get('/api/creds')).json();
    const sd = list.find((s: any) => s.site === 'www.saucedemo.com');
    expect(sd.keys).toEqual([
      { name: 'password', category: 'login' },
      { name: 'username', category: 'login' },
    ]);
    expect(JSON.stringify(list)).not.toContain('secret_sauce');  // value never in the list
  });

  it('GET /api/creds/:site/:key reveals one value on demand; 404 unknown', async () => {
    const r = await (await get('/api/creds/www.saucedemo.com/password')).json();
    expect(r.value).toBe('secret_sauce');
    const r404 = await get('/api/creds/www.saucedemo.com/nope');
    expect(r404.status).toBe(404);
  });

  it('POST then DELETE a credential; file stays chmod 600', async () => {
    const post = await fetch(base + '/api/creds/example.com', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'token', value: 'abc123' }),
    });
    expect(post.status).toBe(200);
    expect((await post.json()).keys).toContain('token');

    // confirm it now appears + is revealable
    const reveal = await (await get('/api/creds/example.com/token')).json();
    expect(reveal.value).toBe('abc123');

    // file permissions must be -rw------- (0o600)
    const mode = statSync(credsFile).mode & 0o777;
    expect(mode).toBe(0o600);

    const del = await fetch(base + '/api/creds/example.com/token', { method: 'DELETE' });
    expect((await del.json()).removed).toBe(true);
    const gone = await get('/api/creds/example.com/token');
    expect(gone.status).toBe(404);
  });

  it('inline-edit: POST same key with a new value updates it in place', async () => {
    await fetch(base + '/api/creds/edit.com', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'username', value: 'first' }),
    });
    await fetch(base + '/api/creds/edit.com', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'username', value: 'second' }),  // edit in place
    });
    expect((await (await get('/api/creds/edit.com/username')).json()).value).toBe('second');
  });

  it('recategorize: POST /api/creds/:site/:key/category changes the category', async () => {
    await fetch(base + '/api/creds/cat.com', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'username', value: 'u' }),   // infers login
    });
    const before = await (await get('/api/creds')).json();
    expect(before.find((s: any) => s.site === 'cat.com').keys[0].category).toBe('login');

    const r = await fetch(base + '/api/creds/cat.com/username/category', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ category: 'other' }),
    });
    expect((await r.json()).ok).toBe(true);
    const after = await (await get('/api/creds')).json();
    expect(after.find((s: any) => s.site === 'cat.com').keys[0].category).toBe('other');

    // invalid category rejected
    const bad = await fetch(base + '/api/creds/cat.com/username/category', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ category: 'bogus' }),
    });
    expect(bad.status).toBe(400);
  });

  it('unknown path → 404 JSON', async () => {
    const r = await get('/api/nonsense');
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBeTruthy();
  });

  it('graph routes are gone (404)', async () => {
    expect((await get('/api/graph')).status).toBe(404);
    expect((await get('/graph')).status).toBe(404);
  });
});
