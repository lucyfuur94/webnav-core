import http from 'node:http';
import crypto from 'node:crypto';
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
  | { kind: 'type'; nodeId: string; text?: string }
  | { kind: 'goto'; url: string }
  | { kind: 'current-url' };

export type AgentEvent =
  | { type: 'turn'; text: string }
  // `narrate` is DISPLAY-ONLY (what the agent did, human-readable). `action` is the
  // EXECUTE channel — the panel CDP-dispatches it. Never conflate the two.
  | { type: 'narrate'; label: string; detail?: string }
  | { type: 'action'; id: string; cmd: AgentCommand }
  | { type: 'done'; summary?: string }
  | { type: 'error'; message: string }
  | { type: 'plan'; steps: string[] };

export interface AgentGoalBody { goal: string; sessionId: string; mode: string; model?: string }

export interface ServeAgentOpts {
  // `awaitApproval` is the Ask/Auto approval gate (crit #3/#4): the loop calls it and
  // blocks until the user POSTs /api/agent/approve (or /stop, which denies). Resolves
  // true=proceed / false=deny.
  // `signal` (5th arg) is the /stop abort channel: the server aborts it when /stop is
  // POSTed, and onGoal threads it to runAgentGoal → the SDK query's abortController, so
  // /stop actually cancels the in-flight turn (not just rejects pending browser commands).
  onGoal?: (goal: AgentGoalBody, channel: AgentChannel, emit: (e: AgentEvent) => void, awaitApproval: () => Promise<boolean>, signal: AbortSignal) => Promise<void>;
  commandTimeoutMs?: number;
  // Per-run secret. Every /api/agent/* and /ingest-ax request must present it
  // (header `x-webnav-token` on POSTs; `?token=` on the SSE GET, which can't set a
  // header). Absent → generated at boot (safe default: never token-less). The cli
  // generates + passes + prints it so the user can paste it into the extension panel.
  token?: string;
}

interface Pending { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }

export function serveAgent(port: number, store: RecordStore, opts: ServeAgentOpts = {}): http.Server {
  const commandTimeoutMs = opts.commandTimeoutMs ?? 30_000;
  // `||` not `??`: an explicitly-passed empty string must still fall back to a random
  // token — token:'' would make authorized('') true and disable auth entirely.
  const token = opts.token || crypto.randomBytes(16).toString('hex');
  // LAST-CONNECTION-WINS (single-panel guard): two open panels (or a reopened panel
  // racing the old EventSource's close) must not both receive+execute every `action` —
  // that double-fires CDP clicks. Only the newest /events connection is kept live; a
  // fresh connection evicts+ends whatever was there before.
  let current: { send: (e: AgentEvent) => void; res: http.ServerResponse } | null = null;
  const emit = (e: AgentEvent) => current?.send(e);
  const pending = new Map<string, Pending>();
  let seq = 0;
  // Single outstanding approval gate (one goal runs at a time). onGoal is handed an
  // awaitApproval() that parks here until /approve (or /stop, which denies) resolves it.
  // ponytail: one slot, not a per-goal map — the server drives one goal at a time.
  let pendingApproval: ((approved: boolean) => void) | null = null;
  // Single outstanding run's abort controller (one goal at a time, same as the approval
  // slot). /stop aborts it so the SDK query is cancelled, not just the pending commands.
  let currentGoalAbort: AbortController | null = null;

  function awaitApproval(): Promise<boolean> {
    // A fresh goal supersedes any stale unresolved gate (deny it so nothing leaks).
    if (pendingApproval) pendingApproval(false);
    return new Promise<boolean>((resolve) => { pendingApproval = resolve; });
  }
  function resolveApproval(approved: boolean): void {
    const p = pendingApproval;
    pendingApproval = null;
    p?.(approved);
  }

  function rejectAllPending(message: string): void {
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new Error(message));
      pending.delete(id);
    }
    resolveApproval(false); // /stop also denies an outstanding approval gate
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
      goto: async (url) => { await dispatchCommand({ kind: 'goto', url }); },
      currentUrl: () => dispatchCommand({ kind: 'current-url' }) as Promise<string>,
    };
  }

  // Constant-time token check. The extension sends the secret as an `x-webnav-token`
  // header on POSTs; EventSource can't set headers, so the SSE GET carries it as a
  // `?token=` query param. No CORS headers are emitted at all — this server is only
  // reached by the extension (a privileged context whose fetch/EventSource are NOT
  // page-CORS-gated), so `*` was never needed; dropping it blocks any web page from
  // reading responses cross-origin, and the token blocks driving the browser without
  // the secret (closes the DNS-rebind / local-process attack).
  const authorized = (req: http.IncomingMessage): boolean => {
    const url = new URL(req.url ?? '', 'http://x');
    const presented = (req.headers['x-webnav-token'] as string | undefined) ?? url.searchParams.get('token') ?? '';
    const a = Buffer.from(presented);
    const b = Buffer.from(token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };

  const server = http.createServer((req, res) => {
    const sendJson = (code: number, body: unknown) =>
      res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(body));

    if (!authorized(req)) return sendJson(401, { ok: false, error: 'unauthorized' });

    if (req.method === 'GET' && (req.url ?? '').startsWith('/api/agent/events')) {
      // Evict whatever connection was previously current — last-connection-wins.
      current?.res.end();
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': connected\n\n');
      const send = (e: AgentEvent) => res.write('data: ' + JSON.stringify(e) + '\n\n');
      const self = { send, res };
      current = self;
      const beat = setInterval(() => res.write(': ping\n\n'), 15000);
      req.on('close', () => { clearInterval(beat); if (current === self) current = null; });
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
          // A fresh goal supersedes any prior run's abort controller.
          const abort = new AbortController();
          currentGoalAbort = abort;
          opts.onGoal(body, channel, emit, awaitApproval, abort.signal)
            .catch((e) => emit({ type: 'error', message: String(e) }))
            .finally(() => { if (currentGoalAbort === abort) currentGoalAbort = null; });
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

    if (req.method === 'POST' && req.url === '/api/agent/approve') {
      readBody(req).then((raw) => {
        let body: { approved?: boolean };
        try { body = JSON.parse(raw); } catch { return sendJson(400, { ok: false, error: 'invalid JSON body' }); }
        resolveApproval(body.approved === true);
        sendJson(200, { ok: true });
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/agent/stop') {
      // Stop must ACTUALLY stop: reject in-flight browser commands AND abort the SDK
      // query (via the per-goal signal threaded to runAgentGoal). Rejecting pending
      // commands alone only fails the next browser call — the SDK turn keeps running.
      rejectAllPending('agent-serve: stopped');
      currentGoalAbort?.abort();
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
