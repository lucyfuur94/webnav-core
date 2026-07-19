import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import type { Server } from 'node:http';
import { RecordStore } from '../../src/mapstore/record.js';
import { serveAgent, type AgentEvent } from '../../src/agent/server.js';
import type { IngestAXBody } from '../../src/recorder/ingest.js';
import type { AXNode } from '../../src/playwright/ax-adapter.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/ax');
const axFixture = (name: string): AXNode[] => JSON.parse(readFileSync(join(fixturesDir, `${name}.ax.json`), 'utf8'));

let servers: Server[] = [];
afterEach(() => { for (const s of servers) s.close(); servers = []; });

const TOKEN = 'test-token-abc123';

async function listen(store: RecordStore, opts?: Parameters<typeof serveAgent>[2]): Promise<number> {
  const server = serveAgent(0, store, { token: TOKEN, ...opts });
  servers.push(server);
  await new Promise((r) => server.on('listening', r));
  return (server.address() as any).port;
}

// Fake extension: opens the SSE stream, parses `data: {...}` lines into AgentEvent,
// and lets the test answer `action` events by POSTing to /api/agent/command-result.
function openEvents(port: number, token: string = TOKEN): { events: AgentEvent[]; close: () => void; waitFor: (pred: (e: AgentEvent) => boolean, timeoutMs?: number) => Promise<AgentEvent> } {
  const events: AgentEvent[] = [];
  const controller = new AbortController();
  const waiters: { pred: (e: AgentEvent) => boolean; resolve: (e: AgentEvent) => void }[] = [];
  (async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/agent/events?token=${encodeURIComponent(token)}`, { signal: controller.signal });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n\n');
        buf = lines.pop() ?? '';
        for (const chunk of lines) {
          const line = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          const evt = JSON.parse(line.slice('data: '.length)) as AgentEvent;
          events.push(evt);
          for (let i = waiters.length - 1; i >= 0; i--) {
            if (waiters[i].pred(evt)) { waiters[i].resolve(evt); waiters.splice(i, 1); }
          }
        }
      }
    } catch { /* aborted on close */ }
  })();
  return {
    events,
    close: () => controller.abort(),
    waitFor: (pred, timeoutMs = 2000) => new Promise((resolve, reject) => {
      const existing = events.find(pred);
      if (existing) return resolve(existing);
      const timer = setTimeout(() => reject(new Error('waitFor timed out')), timeoutMs);
      waiters.push({ pred: (e) => { const hit = pred(e); if (hit) clearTimeout(timer); return hit; }, resolve });
    }),
  };
}

function postJson(port: number, path: string, body: unknown, token: string | null = TOKEN): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token != null) headers['x-webnav-token'] = token;
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, json: await res.json().catch(() => null) }));
}

describe('agent-serve', () => {
  it('dispatch(cmd) emits an action SSE with a fresh id; POSTing command-result resolves the promise', async () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    let channelRef: any;
    const port = await listen(store, {
      onGoal: async (_goal, channel) => { channelRef = channel; },
    });
    const client = openEvents(port);
    await postJson(port, '/api/agent/goal', { goal: 'do a thing', sessionId: 's1', mode: 'live' });
    // wait until onGoal ran and handed us the channel
    for (let i = 0; i < 50 && !channelRef; i++) await new Promise((r) => setTimeout(r, 10));
    expect(channelRef).toBeTruthy();

    const dispatchPromise = channelRef.dispatch({ kind: 'click', nodeId: 'n42' });
    const action = await client.waitFor((e) => e.type === 'action' && (e as any).cmd.kind === 'click') as any;
    expect(action.id).toBeTruthy();
    expect(action.cmd).toEqual({ kind: 'click', nodeId: 'n42' });

    const res = await postJson(port, '/api/agent/command-result', { id: action.id, result: { ok: true } });
    expect(res.status).toBe(200);
    await expect(dispatchPromise).resolves.toBeUndefined();  // AgentChannel.dispatch() resolves void
    client.close();
  });

  it('goto(url) emits an action with cmd {kind:goto,url}; POSTing command-result resolves it', async () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    let channelRef: any;
    const port = await listen(store, { onGoal: async (_goal, channel) => { channelRef = channel; } });
    const client = openEvents(port);
    await postJson(port, '/api/agent/goal', { goal: 'g', sessionId: 'sg', mode: 'live' });
    for (let i = 0; i < 50 && !channelRef; i++) await new Promise((r) => setTimeout(r, 10));

    const gotoPromise = channelRef.goto('https://example.com');
    const action = await client.waitFor((e) => e.type === 'action' && (e as any).cmd.kind === 'goto') as any;
    expect(action.cmd).toEqual({ kind: 'goto', url: 'https://example.com' });
    await postJson(port, '/api/agent/command-result', { id: action.id, result: { ok: true } });
    await expect(gotoPromise).resolves.toBeUndefined();  // AgentChannel.goto() resolves void
    client.close();
  });

  it('currentUrl() emits {kind:current-url} and resolves with the POSTed url string', async () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    let channelRef: any;
    const port = await listen(store, { onGoal: async (_goal, channel) => { channelRef = channel; } });
    const client = openEvents(port);
    await postJson(port, '/api/agent/goal', { goal: 'g', sessionId: 'su', mode: 'live' });
    for (let i = 0; i < 50 && !channelRef; i++) await new Promise((r) => setTimeout(r, 10));

    const urlPromise = channelRef.currentUrl();
    const action = await client.waitFor((e) => e.type === 'action' && (e as any).cmd.kind === 'current-url') as any;
    expect(action.cmd).toEqual({ kind: 'current-url' });
    await postJson(port, '/api/agent/command-result', { id: action.id, result: 'https://landed.example/here' });
    await expect(urlPromise).resolves.toBe('https://landed.example/here');
    client.close();
  });

  it('getAX() round-trips an AXNode[]', async () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    let channelRef: any;
    const port = await listen(store, { onGoal: async (_goal, channel) => { channelRef = channel; } });
    const client = openEvents(port);
    await postJson(port, '/api/agent/goal', { goal: 'g', sessionId: 's2', mode: 'live' });
    for (let i = 0; i < 50 && !channelRef; i++) await new Promise((r) => setTimeout(r, 10));

    const axResult: AXNode[] = axFixture('icons');
    const getAxPromise = channelRef.getAX();
    const action = await client.waitFor((e) => e.type === 'action' && (e as any).cmd.kind === 'get-ax') as any;
    await postJson(port, '/api/agent/command-result', { id: action.id, result: axResult });
    const got = await getAxPromise;
    expect(got).toEqual(axResult);
    client.close();
  });

  it('timeout: commandTimeoutMs rejects with a timeout error and cleans up the pending map', async () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    let channelRef: any;
    const port = await listen(store, {
      onGoal: async (_goal, channel) => { channelRef = channel; },
      commandTimeoutMs: 50,
    });
    const client = openEvents(port);
    await postJson(port, '/api/agent/goal', { goal: 'g', sessionId: 's3', mode: 'live' });
    for (let i = 0; i < 50 && !channelRef; i++) await new Promise((r) => setTimeout(r, 10));

    const dispatchPromise = channelRef.dispatch({ kind: 'click', nodeId: 'n1' });
    const action = await client.waitFor((e) => e.type === 'action') as any;
    await expect(dispatchPromise).rejects.toThrow(/timed out/i);

    // pending entry was cleaned up: a late POST with the same id 404s, doesn't resolve anything
    const late = await postJson(port, '/api/agent/command-result', { id: action.id, result: { ok: true } });
    expect(late.status).toBe(404);
    client.close();
  });

  it('POST /ingest-ax with a committed AX fixture lands in the store', async () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    const port = await listen(store);
    const body: IngestAXBody = {
      sessionId: 'ax-agent-1',
      steps: [{
        fromUrl: 'http://127.0.0.1:8771/fixtures/icons.html', fromAX: axFixture('icons'),
        toUrl: 'http://127.0.0.1:8771/fixtures/table.html', toAX: axFixture('table'),
        clickedRef: 'b7',
      }],
    };
    const res = await postJson(port, '/ingest-ax', body);
    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(true);
    expect(res.json.appended).toBe(1);
    expect(store.actionEffects('ax-agent-1').length).toBeGreaterThan(0);
  });

  it('POST /api/agent/command-result with an unknown id returns 404, does not throw', async () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    const port = await listen(store);
    const res = await postJson(port, '/api/agent/command-result', { id: 'nope', result: {} });
    expect(res.status).toBe(404);
  });

  it('POST /api/agent/goal WITHOUT the token header → 401 unauthorized', async () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    const port = await listen(store);
    const res = await postJson(port, '/api/agent/goal', { goal: 'g', sessionId: 's', mode: 'live' }, null);
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ ok: false, error: 'unauthorized' });
  });

  it('POST /api/agent/goal with the WRONG token → 401 unauthorized', async () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    const port = await listen(store);
    const res = await postJson(port, '/api/agent/goal', { goal: 'g', sessionId: 's', mode: 'live' }, 'wrong-token');
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ ok: false, error: 'unauthorized' });
  });

  it('POST /api/agent/goal WITH the correct token → 200', async () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    const port = await listen(store);
    const res = await postJson(port, '/api/agent/goal', { goal: 'g', sessionId: 's', mode: 'live' });
    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(true);
  });

  it('SSE /events WITHOUT ?token → 401', async () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    const port = await listen(store);
    const res = await fetch(`http://127.0.0.1:${port}/api/agent/events`);
    expect(res.status).toBe(401);
    await res.body?.cancel();
  });

  it('SSE /events WITH ?token → 200 event-stream', async () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    const port = await listen(store);
    const res = await fetch(`http://127.0.0.1:${port}/api/agent/events?token=${encodeURIComponent(TOKEN)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    await res.body?.cancel();
  });

  it('POST /ingest-ax WITHOUT the token header → 401', async () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    const port = await listen(store);
    const res = await postJson(port, '/ingest-ax', { sessionId: 'x', steps: [] }, null);
    expect(res.status).toBe(401);
  });

  it('does NOT set Access-Control-Allow-Origin', async () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    const port = await listen(store);
    const res = await postJson(port, '/api/agent/goal', { goal: 'g', sessionId: 's', mode: 'live' });
    // fetch surfaces response headers; the wildcard CORS header must be absent.
    // (postJson already reads .json; re-fetch to inspect headers.)
    const raw = await fetch(`http://127.0.0.1:${port}/api/agent/goal`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-webnav-token': TOKEN },
      body: JSON.stringify({ goal: 'g', sessionId: 's', mode: 'live' }),
    });
    expect(raw.headers.get('access-control-allow-origin')).toBeNull();
    await raw.body?.cancel();
    expect(res.status).toBe(200);
  });

  it('POST /api/agent/approve resolves the approval gate handed to onGoal', async () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    let gateResult: boolean | undefined;
    let awaitP: Promise<void> | undefined;
    const port = await listen(store, {
      onGoal: async (_goal, _channel, _emit, awaitApproval) => {
        awaitP = awaitApproval!().then((v) => { gateResult = v; });
      },
    });
    const client = openEvents(port);
    await postJson(port, '/api/agent/goal', { goal: 'g', sessionId: 'ap1', mode: 'ask' });
    for (let i = 0; i < 50 && !awaitP; i++) await new Promise((r) => setTimeout(r, 10));
    expect(awaitP).toBeTruthy();
    expect(gateResult).toBeUndefined(); // still pending

    const res = await postJson(port, '/api/agent/approve', { approved: true });
    expect(res.status).toBe(200);
    await awaitP;
    expect(gateResult).toBe(true);
    client.close();
  });

  it('POST /api/agent/approve {approved:false} denies the gate', async () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    let gateResult: boolean | undefined;
    let awaitP: Promise<void> | undefined;
    const port = await listen(store, {
      onGoal: async (_g, _c, _e, awaitApproval) => { awaitP = awaitApproval!().then((v) => { gateResult = v; }); },
    });
    const client = openEvents(port);
    await postJson(port, '/api/agent/goal', { goal: 'g', sessionId: 'ap2', mode: 'ask' });
    for (let i = 0; i < 50 && !awaitP; i++) await new Promise((r) => setTimeout(r, 10));
    await postJson(port, '/api/agent/approve', { approved: false });
    await awaitP;
    expect(gateResult).toBe(false);
    client.close();
  });

  it('POST /api/agent/approve WITHOUT the token → 401', async () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    const port = await listen(store);
    const res = await postJson(port, '/api/agent/approve', { approved: true }, null);
    expect(res.status).toBe(401);
  });

  it('POST /api/agent/stop denies a pending approval gate (false)', async () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    let gateResult: boolean | undefined;
    let awaitP: Promise<void> | undefined;
    const port = await listen(store, {
      onGoal: async (_g, _c, _e, awaitApproval) => { awaitP = awaitApproval!().then((v) => { gateResult = v; }); },
    });
    const client = openEvents(port);
    await postJson(port, '/api/agent/goal', { goal: 'g', sessionId: 'ap3', mode: 'ask' });
    for (let i = 0; i < 50 && !awaitP; i++) await new Promise((r) => setTimeout(r, 10));
    await postJson(port, '/api/agent/stop', {});
    await awaitP;
    expect(gateResult).toBe(false); // stop denies an outstanding approval
    client.close();
  });

  it('POST /api/agent/stop aborts the AbortSignal handed to onGoal (cancels the SDK turn)', async () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    let signalRef: AbortSignal | undefined;
    let aborted = false;
    const port = await listen(store, {
      onGoal: async (_g, _c, _e, _awaitApproval, signal) => {
        signalRef = signal;
        signal?.addEventListener('abort', () => { aborted = true; });
        // keep the "turn" alive so /stop can abort it mid-flight
        await new Promise<void>((resolve) => { signal?.addEventListener('abort', () => resolve()); });
      },
    });
    const client = openEvents(port);
    await postJson(port, '/api/agent/goal', { goal: 'g', sessionId: 'ab1', mode: 'act' });
    for (let i = 0; i < 50 && !signalRef; i++) await new Promise((r) => setTimeout(r, 10));
    expect(signalRef).toBeTruthy();
    expect(signalRef!.aborted).toBe(false);

    const res = await postJson(port, '/api/agent/stop', {});
    expect(res.status).toBe(200);
    for (let i = 0; i < 50 && !aborted; i++) await new Promise((r) => setTimeout(r, 10));
    expect(aborted).toBe(true);
    expect(signalRef!.aborted).toBe(true);
    client.close();
  });

  it('POST /api/agent/stop rejects pending command promises', async () => {
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    let channelRef: any;
    const port = await listen(store, { onGoal: async (_goal, channel) => { channelRef = channel; } });
    const client = openEvents(port);
    await postJson(port, '/api/agent/goal', { goal: 'g', sessionId: 's4', mode: 'live' });
    for (let i = 0; i < 50 && !channelRef; i++) await new Promise((r) => setTimeout(r, 10));

    const dispatchPromise = channelRef.dispatch({ kind: 'click', nodeId: 'n1' });
    dispatchPromise.catch(() => {});  // silence the transient unhandled-rejection window before the assertion below attaches
    await client.waitFor((e) => e.type === 'action');
    const res = await postJson(port, '/api/agent/stop', {});
    expect(res.status).toBe(200);
    await expect(dispatchPromise).rejects.toThrow(/stopped/i);
    client.close();
  });
});
