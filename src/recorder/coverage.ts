// Deterministic capture-coverage: the events-vs-steps diff over ledger dispositions.
// Zero LLM, zero cost — this is the fidelity-roadmap 1c measurement for ASSEMBLY
// losses; the video review keeps hunting SENSOR blindness (what no listener saw).
import type { StoredLedgerEvent } from '../mapstore/record.js';

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
