// Deterministic capture-coverage: the events-vs-steps diff over ledger dispositions.
// Zero LLM, zero cost — this is the fidelity-roadmap 1c measurement for ASSEMBLY
// losses; the video review keeps hunting SENSOR blindness (what no listener saw).
import type { StoredLedgerEvent } from '../mapstore/record.js';
import type { StoredActionEffect } from '../mapstore/record.js';
import { parseSnapshot } from '../playwright/snapshot.js';
import { PROBE_ROLES, namelessInteractive } from './probe.js';

export interface Coverage {
  total: number; captured: number;
  dropped: { seq: number; kind: string; label: string | null; reason: string }[];
}

export function coverage(events: StoredLedgerEvent[]): Coverage {
  const dropped: Coverage['dropped'] = [];
  let captured = 0;
  for (const e of events) {
    const d = e.disposition ?? 'dropped:unprocessed';   // never stamped = lost mid-pair
    if (d.startsWith('step:')) { captured++; continue; }
    const desc = e.descriptor as Record<string, unknown>;
    const candidates = [desc.ariaLabel, desc.leafText, desc.name, desc.placeholder];
    const label = (candidates.find((c) => typeof c === 'string' && c.trim() !== '') ?? null) as string | null;
    dropped.push({ seq: e.seq, kind: e.kind, label, reason: d.replace(/^dropped:/, '') });
  }
  return { total: events.length, captured, dropped };
}

export interface LandingStructure { url: string; named: number; nameless: number }

/** Dedupe key for "same landing page": host+pathname, matching `didNavigate`'s
 *  notion of same-page (query/hash differences don't make a new landing). */
function landingKey(url: string): string {
  try { const u = new URL(url); return u.host + u.pathname; } catch { return url; }
}

export interface CaptureReceipt {
  landings: { url: string; nodes: number; settled: boolean }[];
  unsettled: number;
}

/** record-stop's per-landing capture receipt: for each NAVIGATED effect, its
 *  landing size (parsed node count) and whether the page plateaued before capture.
 *  `settled` reads `e.settled ?? true` (undefined = legacy/not-applicable = settled;
 *  see ActionEffect.settled). Lets the driver see a bad capture the moment the
 *  session ends — not two stages downstream at draft time. */
export function captureReceipt(effects: Pick<StoredActionEffect, 'navigated' | 'toUrl' | 'toSnapshot' | 'settled'>[]): CaptureReceipt {
  const landings: CaptureReceipt['landings'] = [];
  let unsettled = 0;
  for (const e of effects) {
    if (!e.navigated) continue;   // in-page mutate/reveal: no landing, no settledness concern
    const settled = e.settled ?? true;
    if (!settled) unsettled++;
    landings.push({ url: e.toUrl, nodes: parseSnapshot(e.toSnapshot).length, settled });
  }
  return { landings, unsettled };
}

/** Structure audit (fidelity roadmap 1c/gap-3): per distinct landing, how many
 *  interactive nodes are named vs NAMELESS. A page thick with nameless controls
 *  is a sensor gap the review prompt should flag for a frame-by-frame compare. */
export function landingStructure(effects: Pick<StoredActionEffect, 'toUrl' | 'toSnapshot'>[]): LandingStructure[] {
  const byKey = new Map<string, LandingStructure>();
  for (const e of effects) {
    if (!e.toUrl || !e.toSnapshot) continue;
    const nodes = parseSnapshot(e.toSnapshot);
    const interactive = nodes.filter((n) => n.ref && PROBE_ROLES.has(n.role));
    const nameless = namelessInteractive(nodes).length;
    const named = interactive.length - nameless;
    const k = landingKey(e.toUrl);
    const prev = byKey.get(k);
    // worst-wins: a later, healthier revisit must not hide an earlier gap (tie → keep existing)
    if (!prev || nameless > prev.nameless) byKey.set(k, { url: e.toUrl, named, nameless });
  }
  return [...byKey.values()];
}
