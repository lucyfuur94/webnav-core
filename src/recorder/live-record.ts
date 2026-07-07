// The live-record poll loop: drain the injected listener's queue, keep a rolling
// buffer of REAL a11y snapshots, pair events to ticks, append ActionEffects.
// Deps injected so tests drive it with a scripted fake adapter.
import {
  INSTALLER_JS, DRAIN_JS, resolveEvent, fromTickFor, chooseToTick, assembleEffect,
  type LiveEvent, type Tick,
} from './live.js';
import { parseSnapshot } from '../playwright/snapshot.js';
import { parseEvalResult } from '../router/browse.js';
import { classifyReadiness } from '../router/readiness.js';
import { didNavigate } from '../explorer/diff.js';
import type { ActionEffect } from '../mapstore/record.js';

export interface LiveRecordDeps {
  adapter: { evalJs(f: string, ref?: string): Promise<string>; snapshot(): Promise<string>;
    currentUrl(): Promise<string>; close(): Promise<unknown> };
  store: { isActive(s: string): boolean; appendActionEffect(s: string, fx: ActionEffect): void };
  sessionId: string; intervalMs: number;
  log: (line: string) => void; isStopped: () => boolean;
  sleep?: (ms: number) => Promise<void>;
}

interface Pending { ev: LiveEvent; drainIdx: number; waits: number }

export async function runLiveRecord(deps: LiveRecordDeps): Promise<{ appended: number; ticks: number }> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const ticks: Tick[] = [];
  const pending: Pending[] = [];
  let appended = 0;
  try {
    while (!deps.isStopped() && deps.store.isActive(deps.sessionId)) {
      await deps.adapter.evalJs(INSTALLER_JS).catch(() => {});          // idempotent re-inject
      const raw = parseEvalResult(await deps.adapter.evalJs(DRAIN_JS).catch(() => '[]'));
      let events: LiveEvent[] = [];
      try { events = JSON.parse(raw || '[]'); } catch { deps.log(`skip: undrainable batch`); }
      for (const ev of events) pending.push({ ev, drainIdx: ticks.length, waits: 0 });

      const snap = await deps.adapter.snapshot();
      const url = await deps.adapter.currentUrl();
      if (classifyReadiness(snap) !== 'loading') ticks.push({ url, snapshot: snap });
      else ticks.push(ticks[ticks.length - 1] ?? { url, snapshot: snap });  // never archive a loading shell

      for (let i = pending.length - 1; i >= 0; i--) {
        const p = pending[i];
        const hasLaterClick = pending.some((q) => q !== p && q.ev.kind === 'click' && q.drainIdx > p.drainIdx);
        let to = chooseToTick(p.drainIdx, ticks, hasLaterClick);
        if (to === -1 && ++p.waits < 3) continue;                        // wait for the lookahead tick
        if (to === -1) to = Math.min(p.drainIdx, ticks.length - 1);      // give up waiting → same tick
        let fromIdx = fromTickFor(p.ev, ticks, p.drainIdx - 1);
        if (fromIdx === -1 && !didNavigate(ticks[Math.min(p.drainIdx, ticks.length - 1)].url, p.ev.url)) {
          fromIdx = Math.min(p.drainIdx, ticks.length - 1);
        }
        pending.splice(i, 1);
        if (fromIdx === -1) { deps.log(`skip: no from-page for seq ${p.ev.seq}`); continue; }

        const res = resolveEvent(p.ev, parseSnapshot(ticks[fromIdx].snapshot));
        let ref: string | null = res && 'ref' in res ? res.ref : null;
        if (res && 'candidates' in res && !didNavigate(url, p.ev.url)) {
          for (const c of res.candidates) {                             // ref-scoped probe (same doc only)
            const hit = parseEvalResult(await deps.adapter.evalJs('(el) => el.dataset.webnavHit || null', c).catch(() => 'null'));
            if (hit === String(p.ev.seq)) { ref = c; break; }
          }
        }
        const fx = assembleEffect(p.ev, ref, ticks[fromIdx], ticks[to]);
        if (fx) { deps.store.appendActionEffect(deps.sessionId, fx); appended++;
          deps.log(`recorded ${fx.navigated ? 'nav' : fx.action?.role ?? 'action'}: ${fx.action?.name ?? fx.toUrl}`); }
        else deps.log(`skip: unresolved same-page click seq ${p.ev.seq}`);
      }
      await sleep(deps.intervalMs);
    }
  } finally {
    await deps.adapter.close().catch(() => {});
  }
  return { appended, ticks: ticks.length };
}
