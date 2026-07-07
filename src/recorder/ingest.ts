// Server-side ingest: turn raw recorded browser steps into stored ActionEffects.
// The extension stays dumb — fingerprint + diff are reconstructed here from the
// snapshots, reusing tested code (recoverFingerprint, diffSnapshots).

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
