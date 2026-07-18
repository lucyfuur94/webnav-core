import http from 'node:http';
import type { AXNode } from '../playwright/ax-adapter.js';
import type { AgentChannel } from '../router/live-extension-browser.js';
import { ingestAX, type IngestAXBody } from '../recorder/ingest.js';
import type { RecordStore } from '../mapstore/record.js';

// The local agent server: the Chrome extension sidePanel's counterpart. Streams
// AgentEvent over SSE, accepts a goal, and gives the AGENT LOOP (a later task, via
// opts.onGoal) a real AgentChannel that drives the extension by emitting `action`
// commands over SSE and awaiting a POSTed result. Also mounts /ingest-ax so a live
// goal run is recorded through the same path human/agent recordings use.
export type AgentCommand =
  | { kind: 'get-ax' }
  | { kind: 'click'; nodeId: string }
  | { kind: 'type'; nodeId: string; text?: string };

export type AgentEvent =
  | { type: 'turn'; text: string }
  // `narrate` is DISPLAY-ONLY (what the agent did, human-readable). `action` is the
  // EXECUTE channel — the panel CDP-dispatches it. Never conflate the two.
  | { type: 'narrate'; label: string; detail?: string }
  | { type: 'action'; id: string; cmd: AgentCommand }
  | { type: 'done'; summary?: string }
  | { type: 'error'; message: string }
  | { type: 'plan'; steps: string[] };

export interface AgentGoalBody { goal: string; sessionId: string; mode: string }

export interface ServeAgentOpts {
  onGoal?: (goal: AgentGoalBody, channel: AgentChannel, emit: (e: AgentEvent) => void) => Promise<void>;
  commandTimeoutMs?: number;
}

interface Pending { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }

export function serveAgent(port: number, store: RecordStore, opts: ServeAgentOpts = {}): http.Server {
  const commandTimeoutMs = opts.commandTimeoutMs ?? 30_000;
  const emitters = new Set<(e: AgentEvent) => void>();
  const pending = new Map<string, Pending>();
  let seq = 0;

  const emit = (e: AgentEvent) => { for (const fn of emitters) fn(e); };

  function rejectAllPending(message: string): void {
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new Error(message));
      pending.delete(id);
    }
  }

  // The real AgentChannel: every call becomes an `action` SSE event, resolved when
  // the extension POSTs to /api/agent/command-result (or timed out).
  function makeChannel(): AgentChannel {
    function dispatchCommand(cmd: AgentCommand): Promise<unknown> {
      const id = 'cmd' + (++seq);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`agent-serve: command "${id}" timed out after ${commandTimeoutMs}ms`));
        }, commandTimeoutMs);
        pending.set(id, { resolve, reject, timer });
        emit({ type: 'action', id, cmd });
      });
    }
    return {
      getAX: () => dispatchCommand({ kind: 'get-ax' }) as Promise<AXNode[]>,
      dispatch: async (cmd) => { await dispatchCommand(cmd); },
    };
  }

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }

    const sendJson = (code: number, body: unknown) =>
      res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(body));

    if (req.method === 'GET' && req.url === '/api/agent/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': connected\n\n');
      const send = (e: AgentEvent) => res.write('data: ' + JSON.stringify(e) + '\n\n');
      emitters.add(send);
      const beat = setInterval(() => res.write(': ping\n\n'), 15000);
      req.on('close', () => { clearInterval(beat); emitters.delete(send); });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/agent/goal') {
      readBody(req).then((raw) => {
        let body: AgentGoalBody;
        try { body = JSON.parse(raw); } catch { return sendJson(400, { ok: false, error: 'invalid JSON body' }); }
        if (!body.goal || !body.sessionId) return sendJson(400, { ok: false, error: 'goal and sessionId required' });
        sendJson(200, { ok: true });
        if (opts.onGoal) {
          const channel = makeChannel();
          opts.onGoal(body, channel, emit).catch((e) => emit({ type: 'error', message: String(e) }));
        }
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/agent/command-result') {
      readBody(req).then((raw) => {
        let body: { id?: string; result?: unknown };
        try { body = JSON.parse(raw); } catch { return sendJson(400, { ok: false, error: 'invalid JSON body' }); }
        const p = body.id ? pending.get(body.id) : undefined;
        if (!p) return sendJson(404, { ok: false, error: 'unknown command id' });
        clearTimeout(p.timer);
        pending.delete(body.id!);
        p.resolve(body.result);
        sendJson(200, { ok: true });
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/agent/stop') {
      rejectAllPending('agent-serve: stopped');
      sendJson(200, { ok: true });
      return;
    }

    if (req.method === 'POST' && req.url === '/ingest-ax') {
      readBody(req).then((raw) => {
        try {
          const body = JSON.parse(raw) as IngestAXBody;
          if (!body.sessionId || !Array.isArray(body.steps)) throw new Error('sessionId and steps[] required');
          const appended = ingestAX(body, store);
          sendJson(200, { ok: true, appended });
        } catch (e) {
          sendJson(400, { ok: false, error: String(e) });
        }
      });
      return;
    }

    sendJson(404, { ok: false, error: 'not found' });
  });

  server.listen(port, '127.0.0.1');
  return server;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    // ponytail: 50MB cap mirrors serveIngest's precedent — a goal run can carry
    // full AX trees per step.
    req.on('data', (c) => { data += c; if (data.length > 50_000_000) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
