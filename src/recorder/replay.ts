// The replay engine: plays back a recorded StoredActionEffect[] against a live adapter,
// auto-paced or step-by-step, pausing for missing creds / commit confirmation / drift.
// Deps injected (adapter/creds/sleep) so tests drive it with fakes — mirrors live-record.ts.
import { mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSnapshot } from '../playwright/snapshot.js';
import { resolveByFingerprint } from '../playwright/fingerprint.js';
import { didNavigate } from '../explorer/diff.js';
import { COMMIT_WORDS } from '../explorer/draft.js';
import { resolveEvent, descriptorName, type LiveEvent } from './live.js';
import type { StoredActionEffect, StoredLedgerEvent } from '../mapstore/record.js';

export interface ReplayStep {
  seq: number; label: string;
  status: 'pending' | 'running' | 'ok' | 'fail' | 'jumped' | 'skipped';
  shot: string | null; note?: string;
}
export interface ReplayState {
  session: string; running: boolean; mode: 'auto' | 'step';
  waiting: 'value' | 'confirm' | null; waitingLabel?: string;
  steps: ReplayStep[]; done: boolean; error?: string;
}

export class ReplayController {
  readonly state: ReplayState;
  private nextResolve: (() => void) | null = null;
  private waitResolve: ((a: { value?: string; save?: boolean; fire?: boolean } | 'abort') => void) | null = null;
  private aborted = false;
  constructor(session: string, labels: { seq: number; label: string }[]) {
    this.state = { session, running: true, mode: 'auto', waiting: null, done: false,
      steps: labels.map((l) => ({ seq: l.seq, label: l.label, status: 'pending', shot: null })) };
  }
  control(action: 'pause' | 'next' | 'resume' | 'abort'): boolean {
    if (action === 'pause') { this.state.mode = 'step'; return true; }
    if (action === 'resume') { this.state.mode = 'auto'; this.nextResolve?.(); this.nextResolve = null; return true; }
    if (action === 'next') { this.nextResolve?.(); this.nextResolve = null; return true; }
    if (action === 'abort') { this.aborted = true; this.state.waiting = null; this.state.waitingLabel = undefined;
      this.nextResolve?.(); this.nextResolve = null;
      this.waitResolve?.('abort'); this.waitResolve = null; return true; }
    return false;
  }
  supply(value: string, save: boolean): boolean {
    if (this.state.waiting !== 'value' || !this.waitResolve) return false;
    this.state.waiting = null; const r = this.waitResolve; this.waitResolve = null; r({ value, save }); return true;
  }
  confirm(fire: boolean): boolean {
    if (this.state.waiting !== 'confirm' || !this.waitResolve) return false;
    this.state.waiting = null; const r = this.waitResolve; this.waitResolve = null; r({ fire }); return true;
  }
  async gate(sleep: (ms: number) => Promise<void>, paceMs: number): Promise<'go' | 'abort'> {
    if (this.aborted) return 'abort';
    if (this.state.mode === 'auto') { await sleep(paceMs); return this.aborted ? 'abort' : 'go'; }
    await new Promise<void>((r) => { this.nextResolve = r; });
    return this.aborted ? 'abort' : 'go';
  }
  waitFor(kind: 'value' | 'confirm', label: string): Promise<{ value?: string; save?: boolean; fire?: boolean } | 'abort'> {
    this.state.waiting = kind; this.state.waitingLabel = label;
    return new Promise((r) => { this.waitResolve = r; });
  }
}

export interface ReplayDeps {
  adapter: { goto(u: string): Promise<unknown>; open(u: string): Promise<unknown>; click(r: string): Promise<unknown>;
    fill(r: string, t: string): Promise<unknown>; hover(r: string): Promise<unknown>;
    snapshot(): Promise<string>; currentUrl(): Promise<string>;
    screenshot(): Promise<string | null>; close(): Promise<unknown> };
  creds: { get(site: string): Record<string, string>; set(site: string, kv: Record<string, string>): unknown };
  site: string; shotsDir: string | null;           // null → no thumbnails
  paceMs?: number; sleep?: (ms: number) => Promise<void>;
}

const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Best-effort screenshot copy — decoration only, never fails the step. */
function saveShot(shotsDir: string, src: string, seq: number): string | null {
  const name = `step-${seq}.png`;
  try {
    mkdirSync(shotsDir, { recursive: true });
    copyFileSync(src, join(shotsDir, name));
    return name;
  } catch {
    return null;
  }
}

export async function runReplay(
  effects: StoredActionEffect[], ctl: ReplayController, deps: ReplayDeps,
): Promise<ReplayState> {
  const sleep = deps.sleep ?? realSleep;
  const paceMs = deps.paceMs ?? 1500;
  const st = ctl.state;
  const skipRest = (from: number) => {
    for (let j = from; j < st.steps.length; j++) {
      if (st.steps[j].status === 'running' || st.steps[j].status === 'pending') st.steps[j].status = 'skipped';
    }
  };
  try {
    if (effects.length === 0) { st.done = true; st.running = false; return st; }
    await deps.adapter.open(effects[0].fromUrl);

    for (let i = 0; i < effects.length; i++) {
      const e = effects[i];
      const step = st.steps[i];
      step.status = 'running';

      const g = await ctl.gate(sleep, paceMs);
      if (g === 'abort') {
        skipRest(i);
        break;
      }

      if (e.action === null) {
        if (e.navigated) { await deps.adapter.goto(e.toUrl); step.status = 'jumped'; }
        else { step.status = 'skipped'; }
        continue;   // no gate/screenshot for skipped/jumped null-action steps
      }

      const action = e.action;
      let ref: string | null = action.ref ?? null;
      let abortedHere = false;
      if (action.elementFp) {
        // Resolve with ONE human-assisted retry (plan semantics): the first miss pauses
        // (step mode) so the human can fix the live page — dismiss a popup, let a render
        // settle — and hit Next, which re-resolves THIS step. A second miss is final.
        for (let attempt = 0; attempt < 2; attempt++) {
          const nodes = parseSnapshot(await deps.adapter.snapshot());
          ref = resolveByFingerprint(action.elementFp, nodes);
          if (ref || attempt === 1) break;
          step.status = 'fail';
          step.note = 'element not found — Next retries once';
          ctl.control('pause');
          const g2 = await ctl.gate(sleep, paceMs);
          if (g2 === 'abort') { abortedHere = true; break; }
          step.status = 'running';
          step.note = undefined;
        }
      }
      if (abortedHere) { skipRest(i); break; }
      if (!ref) {
        step.status = 'fail';
        step.note = 'element not found';
        ctl.control('pause');
        continue;
      }

      if (action.role === 'textbox') {
        const wantKey = normName(action.name ?? '');
        const creds = deps.creds.get(deps.site);
        let value: string | undefined;
        for (const [k, v] of Object.entries(creds)) {
          if (normName(k) === wantKey) { value = v; break; }
        }
        // the RECORDED value is the flow's variable — use it when no stored cred
        // overrides (creds are the operator's variable store; secrets were never
        // recorded, so a password still asks unless creds cover it).
        if (value === undefined && typeof action.value === 'string') value = action.value;
        if (value === undefined) {
          const answer = await ctl.waitFor('value', action.name ?? step.label);
          if (answer === 'abort') {
            skipRest(i);
            break;
          }
          value = answer.value ?? '';
          if (answer.save) deps.creds.set(deps.site, { [wantKey]: value });
        }
        await deps.adapter.fill(ref, value);
      } else {
        const label = action.name ?? step.label;
        if (COMMIT_WORDS.test(label)) {
          const answer = await ctl.waitFor('confirm', label);
          if (answer === 'abort') {
            skipRest(i);
            break;
          }
          if (!answer.fire) { step.status = 'skipped'; continue; }
        }
        await deps.adapter.click(ref);
      }

      if (e.navigated) {
        const cur = await deps.adapter.currentUrl();
        if (didNavigate(cur, e.toUrl)) {
          step.status = 'fail';
          step.note = 'landed elsewhere';
          ctl.control('pause');
          continue;
        }
      }

      if (deps.shotsDir) {
        const src = await deps.adapter.screenshot();
        if (src) step.shot = saveShot(deps.shotsDir, src, e.seq);
      }
      step.status = 'ok';
    }
  } catch (e) {
    // Engine failure (browser would not open, adapter died mid-run): resolve with a
    // terminal error state — a REJECTED replay promise killed the whole dashboard
    // process once (unhandled rejection; live crash 2026-07-15). Never rethrow.
    st.error = String((e as Error).message ?? e);
    skipRest(0);
  } finally {
    st.done = true;
    st.running = false;
    await deps.adapter.close().catch(() => {});   // close on a never-opened session throws too
  }
  return st;
}

// --- Ledger replay: play the RAW event stream (including what assembly dropped) ---
// "Exactly what was done, again": resolution is the SAME deterministic descriptor
// matching recording used (resolveEvent) — never a stored selector, never a guess.
// A capture miss replays as a visible failed step, so this runner doubles as a
// capture-fidelity test (spec 2026-07-16).

/** A ledger row as a resolvable LiveEvent: human rows ARE LiveEvents; agent rows
 *  synthesize one from {role,name} (descriptorName reads ariaLabel first). */
function asLiveEvent(e: StoredLedgerEvent): LiveEvent {
  const d = e.descriptor as Record<string, unknown>;
  if (e.source === 'human') return d as unknown as LiveEvent;
  return { seq: e.seq, kind: e.kind === 'type' ? 'input' : 'click', tagName: '',
    url: String(d.url ?? ''), role: (d.role as string) ?? null,
    ariaLabel: (d.name as string) ?? null, leafText: null, href: null,
    placeholder: null, nameAttr: null, inputType: null } as LiveEvent;
}
/** The page URL an event acted on (agent navigate rows act FROM fromUrl). */
function pageUrlOf(e: StoredLedgerEvent): string {
  const d = e.descriptor as Record<string, unknown>;
  return String((e.source === 'agent' && e.kind === 'navigate' ? d.fromUrl : d.url) ?? '');
}

export async function runLedgerReplay(
  events: StoredLedgerEvent[], ctl: ReplayController, deps: ReplayDeps,
): Promise<ReplayState> {
  const sleep = deps.sleep ?? realSleep;
  const paceMs = deps.paceMs ?? 1500;
  const st = ctl.state;
  const skipRest = (from: number) => {
    for (let j = from; j < st.steps.length; j++) {
      if (st.steps[j].status === 'running' || st.steps[j].status === 'pending') st.steps[j].status = 'skipped';
    }
  };
  try {
    if (events.length === 0) { return st; }
    const first = events[0];
    await deps.adapter.open(first.source === 'agent' && first.kind === 'navigate'
      ? String((first.descriptor as Record<string, unknown>).url) : pageUrlOf(first));

    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      const d = e.descriptor as Record<string, unknown>;
      const step = st.steps[i];
      step.status = 'running';
      const g = await ctl.gate(sleep, paceMs);
      if (g === 'abort') { skipRest(i); break; }

      // expected landing = the page the NEXT event acted on (judgment-free — the
      // ledger's own urls encode the journey)
      const nextUrl = i + 1 < events.length ? pageUrlOf(events[i + 1]) : null;

      if (e.source === 'agent' && e.kind === 'navigate') {
        await deps.adapter.goto(String(d.url));
        step.status = 'jumped';
        continue;
      }

      const lev = asLiveEvent(e);
      // resolve with ONE human-assisted retry (same semantics as steps replay)
      let ref: string | null = null;
      let abortedHere = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = resolveEvent(lev, parseSnapshot(await deps.adapter.snapshot()));
        ref = res && 'ref' in res ? res.ref : null;   // candidates = ambiguous = no guess
        if (ref || attempt === 1) break;
        step.status = 'fail';
        step.note = 'element not found — Next retries once';
        ctl.control('pause');
        const g2 = await ctl.gate(sleep, paceMs);
        if (g2 === 'abort') { abortedHere = true; break; }
        step.status = 'running'; step.note = undefined;
      }
      if (abortedHere) { skipRest(i); break; }
      if (!ref) { step.status = 'fail'; step.note = 'element not found'; ctl.control('pause'); continue; }

      const label = descriptorName(lev) ?? step.label;
      if (e.kind === 'input' || e.kind === 'type') {
        let value = typeof d.value === 'string' ? d.value : undefined;   // human non-secret variable
        if (value === undefined) {
          const wantKey = normName(label);
          for (const [k, v] of Object.entries(deps.creds.get(deps.site))) {
            if (normName(k) === wantKey) { value = v; break; }
          }
        }
        if (value === undefined) {
          const answer = await ctl.waitFor('value', label);
          if (answer === 'abort') { skipRest(i); break; }
          value = answer.value ?? '';
          if (answer.save) deps.creds.set(deps.site, { [normName(label)]: value });
        }
        await deps.adapter.fill(ref, value);
      } else if (e.kind === 'hover') {
        await deps.adapter.hover(ref);
      } else {
        if (COMMIT_WORDS.test(label)) {
          const answer = await ctl.waitFor('confirm', label);
          if (answer === 'abort') { skipRest(i); break; }
          if (!answer.fire) { step.status = 'skipped'; continue; }
        }
        await deps.adapter.click(ref);
      }

      if (nextUrl && didNavigate(pageUrlOf(e), nextUrl)) {
        // bounded settle: a client-side redirect needs a beat before the url is real
        let cur = await deps.adapter.currentUrl();
        for (let w = 0; w < 3 && didNavigate(cur, nextUrl); w++) {
          await sleep(700); cur = await deps.adapter.currentUrl();
        }
        if (didNavigate(cur, nextUrl)) {
          step.status = 'fail'; step.note = 'landed elsewhere'; ctl.control('pause'); continue;
        }
      }
      if (deps.shotsDir) {
        const src = await deps.adapter.screenshot();
        if (src) step.shot = saveShot(deps.shotsDir, src, e.seq);
      }
      step.status = 'ok';
    }
  } catch (e) {
    st.error = String((e as Error).message ?? e);   // same never-reject contract as runReplay
    skipRest(0);
  } finally {
    st.done = true;
    st.running = false;
    await deps.adapter.close().catch(() => {});
  }
  return st;
}
