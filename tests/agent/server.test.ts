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

async function listen(store: RecordStore, opts?: Parameters<typeof serveAgent>[2]): Promise<number> {
  const server = serveAgent(0, store, opts);
  servers.push(server);
  await new Promise((r) => server.on('listening', r));
  return (server.address() as any).port;
}

// Fake extension: opens the SSE stream, parses `data: {...}` lines into AgentEvent,
// and lets the test answer `action` events by POSTing to /api/agent/command-result.
function openEvents(port: number): { events: AgentEvent[]; close: () => void; waitFor: (pred: (e: AgentEvent) => boolean, timeoutMs?: number) => Promise<AgentEvent> } {
  const events: AgentEvent[] = [];
  const controller = new AbortController();
  const waiters: { pred: (e: AgentEvent) => boolean; resolve: (e: AgentEvent) => void }[] = [];
  (async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/agent/events`, { signal: controller.signal });
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

function postJson(port: number, path: string, body: unknown): Promise<{ status: number; json: any }> {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
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
