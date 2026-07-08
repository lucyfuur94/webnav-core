// The replay engine: plays back a recorded StoredActionEffect[] against a live adapter,
// auto-paced or step-by-step, pausing for missing creds / commit confirmation / drift.
// Deps injected (adapter/creds/sleep) so tests drive it with fakes — mirrors live-record.ts.
import { mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSnapshot } from '../playwright/snapshot.js';
import { resolveByFingerprint } from '../playwright/fingerprint.js';
import { didNavigate } from '../explorer/diff.js';
import { COMMIT_WORDS } from '../explorer/draft.js';
import type { StoredActionEffect } from '../mapstore/record.js';

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
    fill(r: string, t: string): Promise<unknown>; snapshot(): Promise<string>; currentUrl(): Promise<string>;
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
  } finally {
    st.done = true;
    st.running = false;
    await deps.adapter.close();
  }
  return st;
}
