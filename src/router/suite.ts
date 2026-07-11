import type { MapStore } from '../mapstore/store.js';
import type { State, Affordance } from '../mapstore/types.js';
import type { RecallResponse } from '../protocol.js';
import type { WalkBrowser, WalkAnswer } from './walk.js';
import { walkRoute } from './walk.js';
import { findPath } from './path.js';

// A walk-driven RELEASE SUITE: declarative walk specs the walk engine executes,
// with checkpoints (--observe) as the assertion hook. The runner answers NOTHING —
// any needs-navigation/needs-classification is an interaction charged against the
// case's budget; a commit point (needs-classification) therefore always FAILS a
// case (a release check must never place orders). Design: 2026-07-12-release-suite.

export interface CheckpointAssert {
  repertoireContains?: string[];         // labels present in the state's stored repertoire
  kinds?: Record<string, string>;        // label -> expected affordance kind
  snapshotContains?: string[];           // live-page substrings (use sparingly — data churns)
}
export interface CaseExpect {
  status?: string;                       // terminal status the case demands (default 'done')
  maxInteractions?: number;              // needs-* escalations allowed before FAIL (default 0)
  checkpoint?: Record<string, CheckpointAssert>;  // state id/label -> assertions
}
export interface SuiteCase {
  name: string;
  start: string;                         // start state id (or bare semanticName)
  goal: string;                          // goal state id (or bare semanticName)
  observe?: string[];                    // states to checkpoint on arrival
  expect?: CaseExpect;
}
export interface Suite {
  site: string;
  profile?: string;
  cases: SuiteCase[];
}

export interface CaseResult {
  name: string;
  verdict: 'pass' | 'fail';
  elapsedMs: number;
  failure?: { at: string; payload: unknown };
}
export interface SuiteResult {
  status: 'ok' | 'failed';
  passed: number;
  failed: number;
  cases: CaseResult[];
  preflight?: { auth: string; loginUrl?: string };
}

/** A bad-suite error the CLI maps to exit 2 (config error, with a hint). */
export class SuiteConfigError extends Error {}

/** Validate + normalize a parsed suite JSON. Throws SuiteConfigError with a hint on
 *  anything malformed — the CLI turns that into exit 2. */
export function parseSuite(raw: unknown): Suite {
  if (typeof raw !== 'object' || raw === null) throw new SuiteConfigError('suite must be a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.site !== 'string' || !o.site) throw new SuiteConfigError('suite.site (the host) is required');
  if (!Array.isArray(o.cases) || o.cases.length === 0) throw new SuiteConfigError('suite.cases must be a non-empty array');
  const cases: SuiteCase[] = o.cases.map((c, i) => {
    if (typeof c !== 'object' || c === null) throw new SuiteConfigError(`cases[${i}] must be an object`);
    const cc = c as Record<string, unknown>;
    if (typeof cc.name !== 'string' || !cc.name) throw new SuiteConfigError(`cases[${i}].name is required`);
    if (typeof cc.start !== 'string' || !cc.start) throw new SuiteConfigError(`cases[${i}] (${cc.name ?? i}).start is required`);
    if (typeof cc.goal !== 'string' || !cc.goal) throw new SuiteConfigError(`cases[${i}] (${cc.name ?? i}).goal is required`);
    const expect = (cc.expect ?? {}) as CaseExpect;
    if (expect.maxInteractions !== undefined && (typeof expect.maxInteractions !== 'number' || expect.maxInteractions < 0))
      throw new SuiteConfigError(`cases[${i}] (${cc.name}).expect.maxInteractions must be a non-negative number`);
    return { name: cc.name, start: cc.start, goal: cc.goal,
      observe: Array.isArray(cc.observe) ? (cc.observe as string[]) : undefined, expect };
  });
  return { site: o.site, profile: typeof o.profile === 'string' ? o.profile : undefined, cases };
}

// Resolve a label (state id OR bare semanticName) to a concrete state id in the
// site's states. Mirrors the CLI's --start/--goal/--observe resolution so a suite
// author can write a bare state name (e.g. "report-list") instead of the fully
// qualified id ("<site>:report-list").
function resolveState(states: State[], label: string): string | null {
  if (states.some((s) => s.id === label)) return label;
  const byName = states.find((s) => s.semanticName === label || s.semanticName === label.split(':').pop());
  if (byName) return byName.id;
  // suite authors use the bare tail (e.g. "report-list") — match the id suffix.
  const bySuffix = states.find((s) => s.id.endsWith(':' + label));
  return bySuffix ? bySuffix.id : null;
}

// Flatten a repertoire (affordances + nested reveal children) to label->kind, so a
// checkpoint can assert against the FULL stored repertoire the state declares.
function flatRepertoire(affs: Affordance[]): Map<string, string> {
  const m = new Map<string, string>();
  const walk = (list: Affordance[]) => {
    for (const a of list) {
      if (!m.has(a.label)) m.set(a.label, a.kind);
      if (a.children) walk(a.children);
    }
  };
  walk(affs);
  return m;
}

/** Assert one checkpoint payload against its CheckpointAssert. Returns a failure
 *  reason string, or null if all assertions hold. */
function assertCheckpoint(cp: Extract<RecallResponse, { status: 'checkpoint' }>, a: CheckpointAssert): string | null {
  const rep = flatRepertoire(cp.repertoire ?? []);
  for (const label of a.repertoireContains ?? []) {
    if (!rep.has(label)) return `repertoire missing "${label}" (have: ${[...rep.keys()].join(', ')})`;
  }
  for (const [label, kind] of Object.entries(a.kinds ?? {})) {
    if (rep.get(label) !== kind) return `"${label}" expected kind ${kind}, got ${rep.get(label) ?? 'ABSENT'}`;
  }
  for (const sub of a.snapshotContains ?? []) {
    if (!cp.snapshot.includes(sub)) return `snapshot does not contain "${sub}"`;
  }
  return null;
}

// A checkpoint id in the suite may be written as a bare label; match it to the fired
// checkpoint state either by exact id or by the id's tail.
function checkpointAssertFor(expectCp: Record<string, CheckpointAssert> | undefined, stateId: string): CheckpointAssert | undefined {
  if (!expectCp) return undefined;
  if (expectCp[stateId]) return expectCp[stateId];
  for (const [k, v] of Object.entries(expectCp)) if (stateId.endsWith(':' + k) || stateId === k) return v;
  return undefined;
}

/** Everything the runner needs to execute ONE case without knowing about live
 *  browsers — the CLI wires the live version, tests wire a fake. `openCase` yields
 *  a fresh WalkBrowser (the walk drives it) and a `close` to reap it after. */
export interface SuiteDeps {
  store: MapStore;
  states: State[];
  // Auth pre-flight run ONCE before case 1. Returns the classified landing; the
  // runner fails the whole run fast on 'needs-login'. Omit to skip pre-flight
  // (e.g. an unauthed site / test without a browser).
  preflight?: () => Promise<{ auth: string; loginUrl?: string }>;
  // Open a FRESH browser session for a case, landed on `startUrl`. Returns the
  // WalkBrowser + a close() to reap it. Serial: only one is live at a time.
  openCase: (startUrl: string) => Promise<{ browser: WalkBrowser; close: () => Promise<void> }>;
  onProgress?: (line: string) => void;
}

/**
 * Run one case: pathfind, walk on autopilot, auto-assert + --continue past every
 * checkpoint, and charge every needs-* escalation against maxInteractions. Fails
 * the case (with the pause payload) when the budget is exceeded, when a commit
 * point is hit (needs-classification — never classified safe here), on drift, or
 * when a checkpoint assertion or the terminal status doesn't match expect.
 */
async function runCase(c: SuiteCase, deps: SuiteDeps): Promise<CaseResult> {
  const t0 = Date.now();
  const done = (verdict: 'pass' | 'fail', failure?: CaseResult['failure']): CaseResult =>
    ({ name: c.name, verdict, elapsedMs: Date.now() - t0, failure });

  const startId = resolveState(deps.states, c.start);
  const goalId = resolveState(deps.states, c.goal);
  if (!startId) return done('fail', { at: 'resolve', payload: `unknown start state "${c.start}"` });
  if (!goalId) return done('fail', { at: 'resolve', payload: `unknown goal state "${c.goal}"` });
  const observe: string[] = [];
  for (const label of c.observe ?? []) {
    const id = resolveState(deps.states, label);
    if (!id) return done('fail', { at: 'resolve', payload: `unknown observe state "${label}"` });
    observe.push(id);
  }
  const path = findPath(deps.store, startId, goalId);
  if (!path) return done('fail', { at: 'route', payload: `no route from ${startId} to ${goalId}` });

  const expect = c.expect ?? {};
  const wantStatus = expect.status ?? 'done';
  const maxInteractions = expect.maxInteractions ?? 0;
  const startState = deps.store.getState(startId)!;

  const { browser, close } = await deps.openCase(startState.urlPattern || 'about:blank');
  const observedSoFar: string[] = [];
  let interactions = 0;
  try {
    let answer: WalkAnswer | undefined;
    let from = startId;
    // The walk loop: run walkRoute; on a checkpoint, assert then --continue; on a
    // needs-* escalation, charge the budget and either fail or (if there were more
    // states before the halt) there is nothing to continue with — the runner never
    // answers navigation/classification, so any such pause ends the case.
    // Guard against a pathological non-advancing loop with a bounded iteration cap.
    for (let iter = 0; iter <= path.length + observe.length + 2; iter++) {
      const res: RecallResponse = await walkRoute({
        goalName: 'suite:' + goalId, startStateId: from, goalStateId: goalId,
        store: deps.store, states: deps.states, browser, path, answer,
        observe, observed: observedSoFar,
      });
      answer = undefined;
      if (res.status === 'checkpoint') {
        observedSoFar.push(res.state);
        const a = checkpointAssertFor(expect.checkpoint, res.state);
        if (a) {
          const fail = assertCheckpoint(res, a);
          if (fail) return done('fail', { at: res.state, payload: fail });
        }
        // auto-assert done → --continue from where it paused (relative `at` over path)
        from = path[res.at] ?? from;
        answer = { kind: 'continue' };
        continue;
      }
      if (res.status === 'needs-navigation' || res.status === 'needs-classification') {
        // A needs-* is the walk asking for judgment. The runner answers NONE (a
        // release check has no judge — including the commit-point classification,
        // which therefore ALWAYS fails a case). Charge it against the budget; a case
        // that escalates beyond maxInteractions (default 0) is a regression signal or
        // a bad case. Since the runner can't answer, the pause ends the case either
        // way — but we report the budget in the failure so intent stays visible.
        interactions++;
        deps.onProgress?.(`  interaction ${interactions} (budget ${maxInteractions}): ${res.status}`);
        return done('fail', { at: interactions > maxInteractions ? 'interaction-budget' : 'needs-answer',
          payload: { interactions, maxInteractions, pause: res } });
      }
      if (res.status === 'needs-auth') {
        return done('fail', { at: 'needs-auth', payload: res });
      }
      // terminal: done or failed
      if (res.status !== wantStatus) {
        return done('fail', { at: 'terminal', payload: { expected: wantStatus, got: res } });
      }
      // A checkpoint on the GOAL state does NOT fire as a `checkpoint` pause — the
      // walk halts at the goal and returns `done`, attaching the goal's live snapshot
      // + repertoire to evidence (walkRoute's goal-state enrichment). So a start==goal
      // observe case is asserted HERE, against the done evidence, using the same
      // assertCheckpoint machinery (the repertoire is the stored one).
      if (res.status === 'done') {
        for (const obsId of observe) {
          if (observedSoFar.includes(obsId)) continue;
          const a = checkpointAssertFor(expect.checkpoint, obsId);
          if (!a) continue;
          const goalRep = deps.store.getState(obsId)?.affordances ?? res.evidence.repertoire ?? [];
          const synthetic = { status: 'checkpoint' as const, at: 0, state: obsId,
            snapshot: res.evidence.snapshot ?? '', repertoire: goalRep };
          const fail = assertCheckpoint(synthetic, a);
          if (fail) return done('fail', { at: obsId, payload: fail });
        }
      }
      return done('pass');
    }
    return done('fail', { at: 'loop', payload: 'walk did not terminate within the step budget' });
  } finally {
    await close().catch(() => {});
  }
}

/** Run a whole suite: auth pre-flight ONCE, then every case serially with a fresh
 *  session each. Fails fast on a needs-login pre-flight. */
export async function runSuite(suite: Suite, deps: SuiteDeps): Promise<SuiteResult> {
  if (deps.preflight) {
    deps.onProgress?.(`pre-flight: checking auth for ${suite.site}...`);
    const pf = await deps.preflight();
    if (pf.auth === 'needs-login') {
      deps.onProgress?.(`pre-flight FAILED: not logged in — ${pf.loginUrl ?? suite.site}`);
      return { status: 'failed', passed: 0, failed: suite.cases.length,
        preflight: pf,
        cases: suite.cases.map((c) => ({ name: c.name, verdict: 'fail' as const, elapsedMs: 0,
          failure: { at: 'preflight', payload: `not logged in for ${suite.site} — log in by hand, then re-run (loginUrl: ${pf.loginUrl ?? 'n/a'})` } })) };
    }
    deps.onProgress?.(`pre-flight ok: auth=${pf.auth}`);
  }
  const cases: CaseResult[] = [];
  for (const c of suite.cases) {
    deps.onProgress?.(`case: ${c.name}`);
    const r = await runCase(c, deps);
    deps.onProgress?.(`  → ${r.verdict}${r.failure ? ' @ ' + r.failure.at : ''} (${r.elapsedMs}ms)`);
    cases.push(r);
  }
  const passed = cases.filter((c) => c.verdict === 'pass').length;
  const failed = cases.length - passed;
  return { status: failed === 0 ? 'ok' : 'failed', passed, failed, cases };
}
