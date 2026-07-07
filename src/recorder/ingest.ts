// Server-side ingest: turn raw recorded browser steps into stored ActionEffects.
// The extension stays dumb — fingerprint + diff are reconstructed here from the
// snapshots, reusing tested code (recoverFingerprint, diffSnapshots).

import http from 'node:http';
import { parseSnapshot } from '../playwright/snapshot.js';
import { recoverFingerprint } from '../playwright/fingerprint.js';
import { diffSnapshots } from '../explorer/diff.js';
import type { ActionEffect, ActionRef } from '../mapstore/record.js';
import { RecordStore } from '../mapstore/record.js';

export interface RawStep {
  fromUrl: string; fromSnapshot: string;
  toUrl: string; toSnapshot: string;
  navigated: boolean;
  ref: string | null;   // synthetic ref of the clicked node in fromSnapshot, or null for a pure nav
}
export interface IngestBody { sessionId: string; steps: RawStep[] }

export function reconstructEffect(step: RawStep): ActionEffect {
  const fromNodes = parseSnapshot(step.fromSnapshot);
  const toNodes = parseSnapshot(step.toSnapshot);
  let action: ActionRef | null = null;
  if (step.ref) {
    const node = fromNodes.find((n) => n.ref === step.ref) ?? null;
    action = {
      role: node?.role ?? '', name: node?.name ?? null, ref: step.ref,
      elementFp: recoverFingerprint(fromNodes, step.ref),
    };
  }
  return {
    fromUrl: step.fromUrl, fromSnapshot: step.fromSnapshot,
    action,
    toUrl: step.toUrl, toSnapshot: step.toSnapshot,
    navigated: step.navigated,
    diff: diffSnapshots(fromNodes, toNodes),
  };
}

export function ingest(body: IngestBody, store: RecordStore): number {
  store.start(body.sessionId);
  let n = 0;
  for (const step of body.steps) { store.appendActionEffect(body.sessionId, reconstructEffect(step)); n++; }
  store.stop(body.sessionId);
  return n;
}

// Localhost-only receiver: the webnav-recorder Chrome extension POSTs recorded
// steps here; they land in webnav.db as ActionEffects via `ingest`, identical
// to agent-recorded ones. No auth — localhost-only, no secrets in transit
// beyond the map itself.
export function serveIngest(port: number, store: RecordStore): http.Server {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    if (req.method !== 'POST' || req.url !== '/ingest') { res.writeHead(404).end(); return; }
    let raw = '';
    // ponytail: 50MB cap — bounds an unbounded body on this long-running receiver
    // (precedent: dashboard/server.ts). Generous because a session carries full
    // per-step page snapshots; raise if real recordings exceed it.
    req.on('data', (c) => { raw += c; if (raw.length > 50_000_000) req.destroy(); });
    req.on('end', () => {
      try {
        const body = JSON.parse(raw) as IngestBody;
        if (!body.sessionId || !Array.isArray(body.steps)) throw new Error('sessionId and steps[] required');
        const appended = ingest(body, store);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, appended }));
      } catch (e) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
    });
  });
  server.listen(port, '127.0.0.1');
  return server;
}
