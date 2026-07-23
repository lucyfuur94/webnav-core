// Server-side ingest: turn raw recorded browser steps into stored ActionEffects.
// The extension stays dumb — fingerprint + diff are reconstructed here from the
// snapshots, reusing tested code (recoverFingerprint, diffSnapshots).

import http from 'node:http';
import { parseSnapshot, type SnapNode } from '../playwright/snapshot.js';
import { recoverFingerprint } from '../playwright/fingerprint.js';
import { diffSnapshots, didNavigate } from '../explorer/diff.js';
import { adaptAXTree, adaptAXTreeWithRefs, type AXNode } from '../playwright/ax-adapter.js';
import type { ActionEffect, ActionRef } from '../mapstore/record.js';
import { RecordStore } from '../mapstore/record.js';

export interface RawStep {
  fromUrl: string; fromSnapshot: string;
  toUrl: string; toSnapshot: string;
  ref: string | null;   // synthetic ref of the clicked node in fromSnapshot, or null for a pure nav
  navigated?: boolean;  // ignored — recomputed server-side via didNavigate (don't trust the extension)
}
export interface IngestBody { sessionId: string; steps: RawStep[] }

export interface RawAXStep {
  fromUrl: string; fromAX: AXNode[];
  toUrl: string; toAX: AXNode[];
  clickedRef?: string | null;  // synthetic bN ref (in the ADAPTED fromAX tree) of the clicked node, or null for a pure nav
  // Teach mode: the RAW CDP AX nodeId (in fromAX) of the element the HUMAN acted on.
  // The extension stays dumb (it never runs the adapter), so it reports the raw id and
  // ingestAX resolves it to the adapted bN ref via adaptAXTreeWithRefs' refMap. Ignored
  // when clickedRef is already set (agent runs resolve refs server-side up front).
  clickedNodeId?: string | null;
  tMs?: number;                // wall-clock ms when the step COMPLETED (so the ledger shows real per-step times, not one flush time)
  settled?: boolean;           // did the extension's plateau loop confirm this landing stopped changing? (absent = legacy/not-applicable — reads as undefined on the effect, same as a non-navigated capture)
}
export interface IngestAXBody { sessionId: string; steps: RawAXStep[] }

/** SnapNode[] → playwright-ish snapshot text, using each node's own `.raw` line
 *  re-indented by `.depth`. This is the inverse of parseSnapshot, so AX-sourced
 *  effects store the same text format DOM-walk effects do (draft.ts/coverage.ts
 *  re-parse fromSnapshot/toSnapshot downstream regardless of producer).
 *  A node with a URL emits a following `/url:` line (indented one deeper, as
 *  playwright-cli does) — the adapter carries the href on `.url` but NOT in `.raw`,
 *  so without this the href is lost on the serialize→re-parse round-trip and every
 *  AX-recorded link becomes url-less, breaking the cross-link mesh + shell-nav edge
 *  synthesis (a recorded navigation then produces no edge). parseSnapshot attaches a
 *  `/url:` line to the node on the line BEFORE it. */
function serializeNodes(nodes: SnapNode[]): string {
  const out: string[] = [];
  for (const n of nodes) {
    out.push(' '.repeat(n.depth) + n.raw);
    if (n.url) out.push(' '.repeat(n.depth + 1) + `/url: ${n.url}`);
  }
  return out.join('\n');
}

/** Shared reconstruction core: fingerprint the clicked node + diff the landing,
 *  independent of what produced the SnapNode[] (playwright YAML or adapted AX).
 *  NOTE: do not add exact-string URL equality here — CDP gives browser-resolved
 *  absolute URLs, playwright gives raw hrefs; didNavigate already compares
 *  host+pathname only, which both producers satisfy. */
export function reconstructEffectFromNodes(
  fromNodes: SnapNode[], toNodes: SnapNode[],
  fromUrl: string, toUrl: string, clickedRef: string | null,
): ActionEffect {
  let action: ActionRef | null = null;
  if (clickedRef) {
    const node = fromNodes.find((n) => n.ref === clickedRef) ?? null;
    action = {
      role: node?.role ?? '', name: node?.name ?? null, ref: clickedRef,
      elementFp: recoverFingerprint(fromNodes, clickedRef),
    };
  }
  return {
    fromUrl, fromSnapshot: serializeNodes(fromNodes),
    action,
    toUrl, toSnapshot: serializeNodes(toNodes),
    navigated: didNavigate(fromUrl, toUrl),
    diff: diffSnapshots(fromNodes, toNodes),
  };
}

export function reconstructEffect(step: RawStep): ActionEffect {
  const fromNodes = parseSnapshot(step.fromSnapshot);
  const toNodes = parseSnapshot(step.toSnapshot);
  const fx = reconstructEffectFromNodes(fromNodes, toNodes, step.fromUrl, step.toUrl, step.ref);
  // parseSnapshot's own text is already canonical — keep the original bytes rather
  // than the re-serialized (equivalent but not byte-identical) form.
  return { ...fx, fromSnapshot: step.fromSnapshot, toSnapshot: step.toSnapshot };
}

export function ingest(body: IngestBody, store: RecordStore): number {
  store.clearSession(body.sessionId);  // re-ingest into the same session replaces, never appends duplicates
  store.start(body.sessionId);
  let n = 0;
  for (const step of body.steps) { store.appendActionEffect(body.sessionId, reconstructEffect(step)); n++; }
  store.stop(body.sessionId);
  return n;
}

export function ingestAX(body: IngestAXBody, store: RecordStore): number {
  store.clearSession(body.sessionId);
  store.start(body.sessionId);
  let n = 0;
  for (const step of body.steps) {
    const fromNodes = adaptAXTree(step.fromAX);
    const toNodes = adaptAXTree(step.toAX);
    // Teach steps carry the RAW AX nodeId of the human-clicked element (the extension
    // never runs the adapter). Resolve it to the adapted bN ref here, server-side, via
    // the same refMap the agent path uses — so downstream (fingerprint recovery, diff)
    // is byte-identical regardless of who acted. Unresolvable (node vanished from the
    // adapted tree) degrades honestly to a ref-less step, never a wrong ref.
    let clickedRef = step.clickedRef ?? null;
    if (!clickedRef && step.clickedNodeId) {
      const { refMap } = adaptAXTreeWithRefs(step.fromAX);
      for (const [bRef, real] of refMap) {
        if (real.nodeId === step.clickedNodeId) { clickedRef = bRef; break; }
      }
    }
    const fx = reconstructEffectFromNodes(fromNodes, toNodes, step.fromUrl, step.toUrl, clickedRef);
    // Carry the extension's capture-quality verdict onto the stored effect (Task 5 parity
    // with the CLI/agent path). Absent → undefined = legacy/not-applicable, same as a
    // non-navigated (in-page mutate/reveal) capture.
    fx.settled = step.settled;
    // Per-step wall-clock time (from the extension). Without it every step got the single
    // flush-time Date.now(), so the dashboard showed them all at the same second.
    const tMs = step.tMs;
    // Ledger event so the Raw pane isn't empty for extension runs: each recorded step IS
    // one event, captured as a step (1:1, no drops in the AX path). kind = navigate when the
    // step changed page, else action; descriptor carries the acted element's identity.
    const kind = fx.navigated ? 'navigate' : 'action';
    const descriptor: Record<string, unknown> = fx.action
      ? { role: fx.action.role, name: fx.action.name, url: fx.toUrl }
      : { url: fx.toUrl };
    const evSeq = store.appendEvent(body.sessionId, { source: 'agent', kind, descriptor, t: tMs }, tMs);
    const stepSeq = store.appendActionEffect(body.sessionId, fx, tMs);
    if (evSeq != null && stepSeq != null) store.stampEvent(body.sessionId, evSeq, 'step:' + stepSeq);
    n++;
  }
  store.stop(body.sessionId);
  return n;
}

// Localhost-only receiver: the webnav-extension Chrome extension POSTs recorded
// steps here; they land in webnav.db as ActionEffects via `ingest`, identical
// to agent-recorded ones. No auth — localhost-only, no secrets in transit
// beyond the map itself.
// note: this is still the live `webnav dev ingest` verb (src/cli.ts), a separate
// surface from agent-serve's own /ingest-ax mount. Its only in-extension caller was
// the Phase-1 popup, removed 2026-07-19 (see webnav-extension/README.md) — the
// wildcard CORS here is unrelated to that removal and is left as-is (out of scope).
export function serveIngest(port: number, store: RecordStore): http.Server {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    if (req.method !== 'POST' || (req.url !== '/ingest' && req.url !== '/ingest-ax')) {
      res.writeHead(404).end(); return;
    }
    const isAX = req.url === '/ingest-ax';
    let raw = '';
    // ponytail: 50MB cap — bounds an unbounded body on this long-running receiver
    // (precedent: dashboard/server.ts). Generous because a session carries full
    // per-step page snapshots; raise if real recordings exceed it.
    req.on('data', (c) => { raw += c; if (raw.length > 50_000_000) req.destroy(); });
    req.on('end', () => {
      try {
        if (isAX) {
          const body = JSON.parse(raw) as IngestAXBody;
          if (!body.sessionId || !Array.isArray(body.steps)) throw new Error('sessionId and steps[] required');
          const appended = ingestAX(body, store);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, appended }));
        } else {
          const body = JSON.parse(raw) as IngestBody;
          if (!body.sessionId || !Array.isArray(body.steps)) throw new Error('sessionId and steps[] required');
          const appended = ingest(body, store);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, appended }));
        }
      } catch (e) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
    });
  });
  server.listen(port, '127.0.0.1');
  return server;
}
