// Server-side ingest: turn raw recorded browser steps into stored ActionEffects.
// The extension stays dumb — fingerprint + diff are reconstructed here from the
// snapshots, reusing tested code (recoverFingerprint, diffSnapshots).

import http from 'node:http';
import { parseSnapshot, type SnapNode } from '../playwright/snapshot.js';
import { recoverFingerprint } from '../playwright/fingerprint.js';
import { diffSnapshots, didNavigate } from '../explorer/diff.js';
import { adaptAXTree, type AXNode } from '../playwright/ax-adapter.js';
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
}
export interface IngestAXBody { sessionId: string; steps: RawAXStep[] }

/** SnapNode[] → playwright-ish snapshot text, using each node's own `.raw` line
 *  re-indented by `.depth`. This is the inverse of parseSnapshot, so AX-sourced
 *  effects store the same text format DOM-walk effects do (draft.ts/coverage.ts
 *  re-parse fromSnapshot/toSnapshot downstream regardless of producer). */
function serializeNodes(nodes: SnapNode[]): string {
  return nodes.map((n) => ' '.repeat(n.depth) + n.raw).join('\n');
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
    const fx = reconstructEffectFromNodes(fromNodes, toNodes, step.fromUrl, step.toUrl, step.clickedRef ?? null);
    store.appendActionEffect(body.sessionId, fx);
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
