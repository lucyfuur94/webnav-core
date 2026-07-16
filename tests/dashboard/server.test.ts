import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server, AddressInfo } from 'node:net';
import { MapStore } from '../../src/mapstore/store.js';
import { seedGraph } from '../../src/graph/seed.js';
import { makeState } from '../../src/mapstore/types.js';
import { CredStore } from '../../src/creds.js';
import { startDashboard } from '../../src/dashboard/server.js';
import { RecordStore } from '../../src/mapstore/record.js';

// A localhost dashboard server over a seeded in-memory map + a temp creds file.
// No browser needed — we drive the HTTP API with fetch.
describe('startDashboard', () => {
  let server: Server;
  let base: string;
  let credsFile: string;
  let tmp: string;

  beforeAll(async () => {
    const store = new MapStore(':memory:');
    seedGraph(store);            // default: saucedemo
    // a second site with a small interior, so the dashboard's multi-site / per-site endpoints are exercised.
    store.upsertNode({ id: 'example.com', homeUrl: 'https://example.com', capabilities: ['code-search'], topics: ['code'] });
    for (const id of ['home', 'list', 'detail']) {
      store.upsertState(makeState({ id: `example.com:${id}`, nodeId: 'example.com', semanticName: id, urlPattern: `https://example.com/${id}`, role: 'detail' }));
    }
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
    expect(html).toContain('<title>webnav</title>');
  });

  it('GET /api/sites lists seeded nodes with stateCount', async () => {
    const sites = await (await get('/api/sites')).json();
    const ex = sites.find((s: any) => s.id === 'example.com');
    expect(ex).toBeTruthy();
    expect(ex.stateCount).toBe(3);            // home, list, detail
    expect(ex.capabilities).toContain('code-search');
  });

  it('GET /api/sites/:id returns node + states + interiorEdges; 404 unknown', async () => {
    const full = await (await get('/api/sites/example.com')).json();
    expect(full.node.id).toBe('example.com');
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

describe('recordings API', () => {
  let base: string; let server: Server;
  let tmp2: string;
  const calls: string[] = [];
  const rec = {
    list: () => [{ sessionId: 'r1', active: false, startedAt: 1, stoppedAt: 2, steps: 3, site: 's.test' }],
    steps: (id: string) => [{ seq: 1, label: 'Login', kind: 'navigate', fromUrl: 'https://s.test/', toUrl: 'https://s.test/x', capturedAt: 1 }],
    del: (id: string) => { calls.push('del:' + id); },
    draft: () => ({ states: [] }),
    open: async () => ({ ok: true as const }),
    record: (id: string) => { calls.push('rec:' + id); return true; },
    stop: (id: string) => { calls.push('stop:' + id); return true; },
    replay: async (id: string, mode?: string) => { calls.push('replay:' + id + ':' + mode); return { ok: false as const, error: 'busy' }; },
    events: (id: string) => ({ events: [{ seq: 1, kind: 'click', source: 'human', descriptor: {}, disposition: 'step:1' }], coverage: { total: 2, captured: 1, dropped: [{ seq: 2, kind: 'click', label: 'X', reason: 'unprocessed' }] } }),
    replayState: () => null,
    replayControl: () => true,
    shotPath: () => null,
    review: () => ({ ok: true }),
    reviewReport: () => null,
    reviewRunning: () => null,
    reviewConfig: () => ({ model: 'sonnet', instructions: '' }),
    reviewFramePath: () => null,
    profiles: () => [{ name: 'default', site: 's.test', sessions: 2, sizeMb: 1.2, lastUsed: 9, open: false }],
    profileNew: () => ({ ok: true }),
    profileOpen: async () => ({ ok: true as const }),
    profileRename: () => ({ ok: true }),
    profileDelete: () => ({ ok: true }),
    profileStatus: async (name: string, site: string) => { calls.push('status:' + name + ':' + site); return { ok: true as const, auth: 'valid' as const, checkedAt: '2026-07-11T00:00:00.000Z' }; },
    profileReset: (name: string) => { calls.push('reset:' + name); return { ok: true }; },
  };
  beforeAll(async () => {
    tmp2 = mkdtempSync(join(tmpdir(), 'webnav-dash-rec-'));
    server = startDashboard(new MapStore(':memory:'), new CredStore(join(tmp2, 'c.json')), { port: 0 }, rec as any);
    await new Promise((r) => server.on('listening', r));
    base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  });
  afterAll(() => { server.close(); rmSync(tmp2, { recursive: true, force: true }); });

  it('lists recordings and steps', async () => {
    expect(await (await fetch(base + '/api/recordings')).json()).toHaveLength(1);
    expect(await (await fetch(base + '/api/recordings/r1/steps')).json()).toHaveLength(1);
  });
  it('record/stop/delete round-trip', async () => {
    await fetch(base + '/api/recordings/r1/record', { method: 'POST' });
    await fetch(base + '/api/recordings/r1/stop', { method: 'POST' });
    await fetch(base + '/api/recordings/r1', { method: 'DELETE' });
    expect(calls).toEqual(['rec:r1', 'stop:r1', 'del:r1']);
  });
  it('profiles: list, delete', async () => {
    expect(await (await fetch(base + '/api/profiles')).json()).toHaveLength(1);
    expect((await fetch(base + '/api/profiles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'work' }) })).status).toBe(200);
    expect((await fetch(base + '/api/profiles/default/rename', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: 'work' }) })).status).toBe(200);
    expect((await fetch(base + '/api/profiles/default', { method: 'DELETE' })).status).toBe(200);
  });
  it('POST /api/profiles/:name/status runs the auth-status engine and returns {auth,checkedAt}', async () => {
    const r = await fetch(base + '/api/profiles/default/status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ site: 's.test' }) });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.auth).toBe('valid');
    expect(body.checkedAt).toBeTruthy();
    expect(calls).toContain('status:default:s.test');
  });
  it('POST /api/profiles/:name/status without a site → 400', async () => {
    const r = await fetch(base + '/api/profiles/default/status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(r.status).toBe(400);
  });
  it('POST /api/profiles/:name/reset recreates the profile dir', async () => {
    const r = await fetch(base + '/api/profiles/default/reset', { method: 'POST' });
    expect(r.status).toBe(200);
    expect(calls).toContain('reset:default');
  });
  it('busy replay → 409; missing shot → 404; open validates body', async () => {
    expect((await fetch(base + '/api/recordings/r1/replay', { method: 'POST' })).status).toBe(409);
    expect((await fetch(base + '/replays/r1/step-1.png')).status).toBe(404);
    expect((await fetch(base + '/api/recordings/open', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(400);
  });
  it('POST replay passes the mode through (default steps)', async () => {
    await fetch(base + '/api/recordings/r1/replay', { method: 'POST' });
    expect(calls).toContain('replay:r1:steps');
    await fetch(base + '/api/recordings/r1/replay', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'ledger' }) });
    expect(calls).toContain('replay:r1:ledger');
  });
  it('GET /api/recordings/:id/events returns the ledger with coverage', async () => {
    const r = await fetch(base + '/api/recordings/r1/events');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.events).toHaveLength(1);
    expect(body.coverage).toEqual({ total: 2, captured: 1, dropped: [{ seq: 2, kind: 'click', label: 'X', reason: 'unprocessed' }] });
  });
  it('without rec deps the routes are 503', async () => {
    const s2 = startDashboard(new MapStore(':memory:'), new CredStore(join(tmp2, 'c2.json')), { port: 0 });
    await new Promise((r) => s2.on('listening', r));
    const b2 = 'http://127.0.0.1:' + (s2.address() as AddressInfo).port;
    expect((await fetch(b2 + '/api/recordings')).status).toBe(503);
    s2.close();
  });
});

// Reconcile-on-read: a session left active=1 by an ended `use session` process
// (SSE 'sessions' emit missed/raced) must still read back active:false on the
// NEXT GET /api/recordings — ground truth from real process liveness, not the
// dashboard's own `busy`. Mirrors the reconcile the `dashboard` command's `list`
// dep runs in src/cli.ts (reconcileStale + await inside list()).
describe('recordings API: stale-active reconcile on list()', () => {
  let base: string; let server: Server; let tmp3: string;
  let liveNames: Set<string>;
  let recordStore: RecordStore;

  beforeAll(async () => {
    tmp3 = mkdtempSync(join(tmpdir(), 'webnav-dash-reconcile-'));
    recordStore = new RecordStore(join(tmp3, 'store.db'));
    recordStore.start('stale-1');   // active in DB, will NOT be in liveNames → must reconcile to false
    recordStore.start('live-1');    // active in DB, IS in liveNames → must stay true
    liveNames = new Set(['live-1']);

    const rec = {
      list: async () => {
        // same shape as cli.ts's reconcileStale: any active row absent from the
        // live-session set is stale → stop it, THEN read the truthful rows back.
        for (const x of recordStore.listSessions()) {
          if (x.active && !liveNames.has(x.sessionId)) recordStore.stop(x.sessionId);
        }
        return recordStore.listSessions();
      },
      steps: () => [], del: () => {}, draft: () => ({}),
      open: async () => ({ ok: true as const }), record: () => true, stop: () => true,
      replay: async () => ({ ok: false as const, error: 'busy' }), replayState: () => null,
      replayControl: () => true, shotPath: () => null,
      review: () => ({ ok: true }), reviewReport: () => null, reviewRunning: () => null,
      reviewConfig: () => ({ model: 'sonnet', instructions: '' }), reviewFramePath: () => null,
      profiles: () => [], profileNew: () => ({ ok: true }), profileOpen: async () => ({ ok: true as const }),
      profileRename: () => ({ ok: true }), profileDelete: () => ({ ok: true }),
    };
    server = startDashboard(new MapStore(':memory:'), new CredStore(join(tmp3, 'c.json')), { port: 0 }, rec as any);
    await new Promise((r) => server.on('listening', r));
    base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  });
  afterAll(() => { server.close(); rmSync(tmp3, { recursive: true, force: true }); });

  it('a session active in DB but absent from the live-session set reads back active:false', async () => {
    const rows = await (await fetch(base + '/api/recordings')).json();
    const stale = rows.find((r: any) => r.sessionId === 'stale-1');
    expect(stale.active).toBe(false);
  });
  it('a session active in DB AND present in the live-session set stays active:true', async () => {
    const rows = await (await fetch(base + '/api/recordings')).json();
    const live = rows.find((r: any) => r.sessionId === 'live-1');
    expect(live.active).toBe(true);
  });
});

describe('realtime (SSE + toggle)', () => {
  const vidFile = join(mkdtempSync(join(tmpdir(), 'webnav-vid-')), 'take-1.webm');
  it('toggle flips and /api/events streams pushed types', async () => {
    const events: string[] = [];
    const notifyCalls: string[] = [];
    let push: ((t: string) => void) | null = null;
    const rec2 = {
      list: () => [], steps: () => [], del: () => {}, draft: () => ({}),
      open: async () => ({ ok: true as const }), record: () => true, stop: () => true,
      replay: async () => ({ ok: true as const }), replayState: () => null,
      replayControl: () => true, shotPath: () => null,
      toggle: (id: string, desired?: boolean) => { events.push('toggled:' + id + ':' + desired); push?.('sessions'); return { recording: desired ?? true }; },
      videos: () => ['take-1.webm'],
      videoPath: (sess: string, f: string) => (f === 'take-1.webm' ? vidFile : null),
      activeWindow: () => 'r9',
      logs: () => ({ now: 1, lines: [{ t: 1, line: 'hello' }] }),
    notify: (k: string, line?: string) => { notifyCalls.push(k + ':' + (line ?? '')); },
      review: () => ({ ok: true }),
      reviewReport: (id: string) => (id === 'r9' ? { report: '# audit', at: 5 } : null),
      reviewRunning: () => null,
      reviewConfig: () => ({ model: 'sonnet', instructions: 'audit it' }),
      reviewFramePath: () => null,
      profiles: () => [{ name: 'default', site: 's.test', sessions: 1, sizeMb: 2.5, lastUsed: 7, open: false }],
      profileNew: () => ({ ok: true }),
      profileOpen: async () => ({ ok: true as const }),
      profileRename: () => ({ ok: true }),
      profileDelete: () => ({ ok: true }),
      subscribe: (cb: (t: string) => void) => { push = cb; return () => { push = null; }; },
    };
    writeFileSync(vidFile, Buffer.from('0123456789'));   // 10-byte fake video for range tests
    const s3 = startDashboard(new MapStore(':memory:'), new CredStore(join(mkdtempSync(join(tmpdir(), 'webnav-sse-')), 'c3.json')), { port: 0 }, rec2 as any);
    await new Promise((r) => s3.on('listening', r));
    const b3 = 'http://127.0.0.1:' + (s3.address() as AddressInfo).port;

    const res = await fetch(b3 + '/api/events');
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    await reader.read();                                        // ': connected'

    // preflight: the pill's JSON POST from a RECORDED https page triggers OPTIONS,
    // and Chrome PNA requires allow-private-network (live failure: stop never sent)
    const pre = await fetch(b3 + '/api/recordings/r9/toggle', { method: 'OPTIONS' });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('*');
    expect(pre.headers.get('access-control-allow-private-network')).toBe('true');
    const t = await (await fetch(b3 + '/api/recordings/r9/toggle', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ recording: true }) })).json() as any;
    expect(t.recording).toBe(true);
    expect(events).toEqual(['toggled:r9:true']);          // DESIRED state forwarded (idempotent)
    expect(await (await fetch(b3 + '/api/recordings/r9/videos')).json()).toEqual(['take-1.webm']);
    expect(await (await fetch(b3 + '/api/recordings/window')).json()).toEqual({ session: 'r9' });
    expect((await (await fetch(b3 + '/api/logs')).json()).lines[0].line).toBe('hello');
    // cross-process realtime bridge: POST /api/notify reaches rec.notify (used by `use session`)
    expect((await fetch(b3 + '/api/notify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'step', line: 'agent nav' }) })).status).toBe(200);
    expect(notifyCalls).toContain('step:agent nav');
    expect((await fetch(b3 + '/api/recordings/r9/review', { method: 'POST' })).status).toBe(200);
    const rev = await (await fetch(b3 + '/api/recordings/r9/review')).json() as any;
    expect(rev.report).toBe('# audit');
    expect(rev.at).toBe(5);                              // last-run time surfaced
    expect(rev.running).toBe(false);
    expect((await (await fetch(b3 + '/api/review-config')).json()).instructions).toBe('audit it');
    expect((await fetch(b3 + '/api/recordings/other/review')).status).toBe(404);
    const full = await fetch(b3 + '/recordings-media/r9/take-1.webm');
    expect(full.status).toBe(200);
    expect(full.headers.get('accept-ranges')).toBe('bytes');
    expect(full.headers.get('content-length')).toBe('10');
    const part = await fetch(b3 + '/recordings-media/r9/take-1.webm', { headers: { range: 'bytes=2-5' } });
    expect(part.status).toBe(206);                                        // seeking needs 206s
    expect(part.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await part.text()).toBe('2345');
    expect((await fetch(b3 + '/recordings-media/r9/nope.webm')).status).toBe(404);
    const chunk = new TextDecoder().decode((await reader.read()).value);
    expect(chunk).toContain('data: sessions');                  // the toggle was PUSHED to the stream
    reader.cancel();
    s3.close();
  });
});
