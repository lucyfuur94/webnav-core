// The live-record poll loop: drain the injected listener's queue, keep a rolling
// buffer of REAL a11y snapshots, pair events to ticks, append ActionEffects.
// Deps injected so tests drive it with a scripted fake adapter.
//
// TICK ECONOMY (live finding: every playwright-cli call is a child-process spawn,
// ~150-400ms each — five per tick made the overlay lag seconds behind): a tick is
// url+installer+drain (cheap); the EXPENSIVE snapshot runs only when something
// happened (events drained / URL changed / pendings waiting for their lookahead
// tick / no baseline yet). MODE_JS runs only when the mode or document changed.
import {
  INSTALLER_JS, DRAIN_JS, MODE_JS, resolveEvent, fromTickFor, chooseToTick, assembleEffect,
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
  store: { isActive(s: string): boolean; appendActionEffect(s: string, fx: ActionEffect): void;
    start(s: string): unknown; stop(s: string): void };
  sessionId: string; intervalMs: number;
  log: (line: string) => void; isStopped: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  // Armed = the overlay is open before recording starts; the loop keeps polling
  // (installer/toggle) regardless of store.isActive, and only capture (append) stays
  // gated on isActive. Ends on isStopped(), 5 consecutive tick errors, or a SUSTAINED
  // undrainable-drain streak (~2.4s — the human closed the window; playwright-cli's
  // daemon would otherwise RESURRECT the browser on our next eval; live finding).
  armed?: boolean;
}

interface Pending { ev: LiveEvent; drainIdx: number; waits: number }

export async function runLiveRecord(deps: LiveRecordDeps): Promise<{ appended: number; ticks: number }> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const ticks: Tick[] = [];
  const pending: Pending[] = [];
  let appended = 0;
  let errStreak = 0;
  let undrainStreak = 0;
  let lastMode: boolean | null = null;
  try {
    while (!deps.isStopped() && (deps.armed ? true : deps.store.isActive(deps.sessionId))) {
      // 1. where are we? (cheap; also our browser-liveness probe)
      let url: string;
      try {
        url = await deps.adapter.currentUrl();
        // NOTE: do NOT reset errStreak here — currentUrl succeeding every tick while
        // snapshot keeps throwing would pin the streak at 1 forever (found as a
        // microtask-starved infinite loop that hung vitest unkillably). The streak
        // resets only on a successful SNAPSHOT below.
      } catch (e) {
        if (deps.isStopped() || (!deps.armed && !deps.store.isActive(deps.sessionId))) break;
        if (++errStreak >= 5) { deps.log('browser gone — ending'); break; }
        deps.log(`tick error (retrying): ${String(e).split('\n')[0]}`);
        await sleep(deps.intervalMs);
        continue;
      }

      // 2. ensure the listener+badge exist in THIS document ('installed' = new doc).
      const installed = parseEvalResult(await deps.adapter.evalJs(INSTALLER_JS).catch(() => "'already'"));

      // 3. drain. Junk (unparseable) output means the page/window is gone — the
      // daemon would resurrect the browser on further evals, so treat a short
      // streak as "window closed" and end the session instead of spamming.
      const raw = parseEvalResult(await deps.adapter.evalJs(DRAIN_JS).catch(() => '[]'));
      let events: LiveEvent[] = [];
      try {
        events = JSON.parse(raw || '[]');
        undrainStreak = 0;
      } catch {
        // Threshold is deliberately generous: DRAIN_JS is in-page try/catch-safe, so an
        // ALIVE page never produces junk — but the eval itself can fail transiently
        // mid-navigation. Only a sustained streak (~2.4s at 300ms) means the window is
        // really gone (live finding: 3 fired during a plain page load and closed the
        // armed window out from under the user).
        if (++undrainStreak === 1) deps.log('skip: undrainable batch');
        if (undrainStreak >= 8) { deps.log('browser window closed — ending session'); break; }
        await sleep(deps.intervalMs);
        continue;
      }
      const toggles = events.filter((e) => e.kind === 'toggle');
      const data = events.filter((e) => e.kind !== 'toggle');
      for (const _t of toggles) {
        if (deps.store.isActive(deps.sessionId)) deps.store.stop(deps.sessionId);
        else deps.store.start(deps.sessionId);
      }
      for (const ev of data) pending.push({ ev, drainIdx: ticks.length, waits: 0 });

      // 4. overlay mode: update IMMEDIATELY on toggle / new document / mode change
      // (a fresh document's badge starts grey even mid-recording).
      const mode = deps.store.isActive(deps.sessionId);
      if (toggles.length || installed === 'installed' || mode !== lastMode) {
        await deps.adapter.evalJs(MODE_JS(mode)).catch(() => {});
        lastMode = mode;
      }

      // 5. snapshot only when it can matter (the expensive call).
      const urlChanged = ticks.length === 0 || didNavigate(ticks[ticks.length - 1].url, url)
        || ticks[ticks.length - 1].url !== url;
      if (data.length || pending.length || urlChanged) {
        let snap: string;
        try {
          snap = await deps.adapter.snapshot();
          errStreak = 0;
        } catch (e) {
          if (deps.isStopped() || (!deps.armed && !deps.store.isActive(deps.sessionId))) break;
          if (++errStreak >= 5) { deps.log('browser gone — ending'); break; }
          deps.log(`tick error (retrying): ${String(e).split('\n')[0]}`);
          await sleep(deps.intervalMs);
          continue;
        }
        if (classifyReadiness(snap) !== 'loading') ticks.push({ url, snapshot: snap });
        else ticks.push(ticks[ticks.length - 1] ?? { url, snapshot: snap });  // never archive a loading shell
      }

      // 6. pair pended events to ticks (unchanged semantics).
      // Snapshot the later-click facts BEFORE the loop splices pending: computed inside,
      // an already-processed (spliced) click stops counting as "later" for its same-batch
      // input, and the input then pairs with the click's landing tick (final-review #1).
      const clicks = pending.filter((q) => q.ev.kind === 'click')
        .map((q) => ({ drainIdx: q.drainIdx, seq: q.ev.seq }));
      for (let i = pending.length - 1; i >= 0; i--) {
        const p = pending[i];
        const hasLaterClick = clicks.some((c) =>
          c.drainIdx > p.drainIdx || (c.drainIdx === p.drainIdx && c.seq > p.ev.seq));
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
