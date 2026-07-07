# Recording Control Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A **Recordings** tab in `dev dashboard`: open a site window *armed* (not recording), hit Record/Stop from the dashboard or the in-window overlay, list recordings, and **Replay** any of them — steps re-execute in a real browser while the dashboard shows a live ✓/✗ filmstrip (per-step screenshots), with stored-cred auto-fill (pause-and-ask fallback) and commit steps never auto-firing.

**Architecture:** Four units per the spec (`docs/superpowers/specs/2026-07-07-control-center-design.md`): `RecordStore.listSessions`; armed-mode in the existing `runLiveRecord` loop (+ overlay mode/toggle); a new replay engine (`src/recorder/replay.ts`) with an in-process controller; dashboard endpoints + a vanilla-JS Recordings tab. All deps injected for tests; the CLI `dashboard` dispatch wires the real ones.

**Tech Stack:** TS strict, ESM/NodeNext (`.js` suffixes), vitest, existing `PlaywrightAdapter`/`RecordStore`/`CredStore`/dashboard server.

## Global Constraints

- **Zero LLM** (#5a). Replay is mechanical resolve-and-act; all judgment (confirm a commit, supply a value) comes from the human via the dashboard.
- **Commit steps NEVER auto-fire (#2):** a step whose action label matches `COMMIT_WORDS` (import from `src/explorer/draft.ts` — export it) pauses `waiting:'confirm'`.
- **Secret rule:** supplied values are used once and never persisted unless the user explicitly chose Save (→ `CredStore.set`). No value ever appears in replay state/logs/screenshots' filenames.
- **ONE driven browser at a time** (no-multiple-headed-windows rule): `openArmed`/`startReplay` refuse (HTTP 409) while another driven browser is live.
- **Uniform JSON** on every API route; dashboard binds 127.0.0.1 only; `/replays/` static serving must path-sanitize (no `..`).
- Reuse: `resolveByFingerprint`, `didNavigate`, `parseSnapshot`, `runLiveRecord`, `CredStore`, dashboard `readBody`/`sendJson` patterns. No duplicated logic.
- Commit after every task (tsc + relevant vitest first). Git author `dikshant.y`.

---

## File Structure

- **Modify** `src/mapstore/record.ts` — `listSessions()`.
- **Modify** `src/recorder/live.ts` — `LiveEvent.kind` gains `'toggle'`; overlay button + `MODE_JS`.
- **Modify** `src/recorder/live-record.ts` — armed mode, toggle handling, error-streak exit.
- **Modify** `src/playwright/adapter.ts` — `screenshot()`.
- **Create** `src/recorder/replay.ts` — `ReplayController` + `runReplay`.
- **Modify** `src/explorer/draft.ts` — `export` COMMIT_WORDS (no behavior change).
- **Modify** `src/dashboard/server.ts` — recordings/replay endpoints behind injected `RecordingsDeps`.
- **Modify** `src/dashboard/shell.ts` — Recordings tab.
- **Modify** `src/cli.ts` — dashboard dispatch builds real `RecordingsDeps`.
- **Tests:** extend `tests/mapstore/record.test.ts`, `tests/recorder/live-record.test.ts`; create `tests/recorder/replay.test.ts`; extend `tests/dashboard/server.test.ts`, `tests/dashboard/shell.test.ts`.

---

## Task 1: `RecordStore.listSessions()`

**Files:** Modify `src/mapstore/record.ts` · Test `tests/mapstore/record.test.ts` (append)

**Interfaces — Produces:**
```typescript
export interface RecordSessionInfo {
  sessionId: string; active: boolean; startedAt: number; stoppedAt: number | null;
  steps: number; site: string | null;
}
// on RecordStore:
listSessions(): RecordSessionInfo[]   // newest first
```

- [ ] **Step 1: failing test** (append to `tests/mapstore/record.test.ts` — it already builds a `RecordStore.fromDatabase(new Database(':memory:'))`; follow its local helpers):

```typescript
describe('listSessions', () => {
  it('lists sessions newest-first with step count and site host', () => {
    const s = RecordStore.fromDatabase(new Database(':memory:'));
    s.start('old', 1000);
    s.appendActionEffect('old', { fromUrl: 'https://a.test/x', fromSnapshot: 'RootWebArea "A" [ref=e1]',
      action: null, toUrl: 'https://a.test/y', toSnapshot: 'RootWebArea "B" [ref=e1]',
      navigated: true, diff: { added: [], removed: [] } });
    s.stop('old', 2000);
    s.start('new', 5000);
    const out = s.listSessions();
    expect(out.map((x) => x.sessionId)).toEqual(['new', 'old']);
    expect(out[1]).toMatchObject({ steps: 1, site: 'a.test', active: false, stoppedAt: 2000 });
    expect(out[0]).toMatchObject({ steps: 0, site: null, active: true, stoppedAt: null });
  });
});
```
(Add the imports the file already uses; `Database` and `RecordStore` are already imported there — verify and reuse.)

- [ ] **Step 2:** run `npx vitest run tests/mapstore/record.test.ts` → new case FAILS.

- [ ] **Step 3: implement** (append to the `RecordStore` class):

```typescript
  listSessions(): RecordSessionInfo[] {
    const rows: any[] = this.db.prepare(
      `SELECT s.session_id, s.active, s.started_at, s.stopped_at,
        (SELECT COUNT(*) FROM record_observations o
          WHERE o.session_id = s.session_id AND o.from_snapshot IS NOT NULL) AS steps,
        (SELECT o2.from_url FROM record_observations o2
          WHERE o2.session_id = s.session_id AND o2.from_snapshot IS NOT NULL
          ORDER BY o2.seq LIMIT 1) AS first_url
       FROM record_sessions s ORDER BY s.started_at DESC`).all();
    const hostOf = (u: string | null) => { try { return u ? new URL(u).host : null; } catch { return null; } };
    return rows.map((r) => ({ sessionId: r.session_id, active: r.active === 1,
      startedAt: r.started_at, stoppedAt: r.stopped_at ?? null, steps: r.steps, site: hostOf(r.first_url) }));
  }
```
Plus the `RecordSessionInfo` interface above the class, exported.

- [ ] **Step 4:** tests pass + `npx tsc --noEmit` clean.
- [ ] **Step 5:** `git add -A src/mapstore tests/mapstore && git commit -m "feat(record): listSessions — recordings inventory for the control center"`

---

## Task 2: Armed mode — loop, overlay button, `MODE_JS`, `adapter.screenshot`

**Files:** Modify `src/recorder/live.ts`, `src/recorder/live-record.ts`, `src/playwright/adapter.ts` · Test `tests/recorder/live-record.test.ts`, `tests/recorder/live.test.ts` (append)

**Interfaces — Produces:**
- `LiveEvent.kind: 'click' | 'input' | 'toggle'` (toggle = the overlay ⏺/⏹ was clicked; carries only `{seq, kind, url}`).
- `export const MODE_JS = (recording: boolean) => string` — an eval-able function-string that recolors the badge (red border + `● REC` when recording; grey border + `⏺ record` when armed).
- `LiveRecordDeps.armed?: boolean` — armed loop runs until `isStopped()` or 5 consecutive tick errors (browser closed); capture still gated by `store.isActive`. Non-armed behavior unchanged (exits when `!isActive`).
- `LiveRecordDeps.store` gains `start(s: string): unknown; stop(s: string): void` (RecordStore already has both).
- `PlaywrightAdapter.screenshot(): Promise<string | null>` — runs `playwright-cli screenshot`, returns the emitted `.png` path or null (graceful: thumbnails are optional).

- [ ] **Step 1: failing tests.** Append to `tests/recorder/live.test.ts`:

```typescript
describe('armed-mode overlay', () => {
  it('installer adds a clickable toggle that pushes kind:toggle (only pointer-events-enabled element)', () => {
    expect(INSTALLER_JS).toContain("kind: 'toggle'");
    expect(INSTALLER_JS).toContain('pointer-events:auto');
  });
  it('MODE_JS recolors for both modes', async () => {
    const { MODE_JS } = await import('../../src/recorder/live.js');
    expect(MODE_JS(true)).toContain('REC');
    expect(MODE_JS(false)).toContain('record');
    new Function('return (' + MODE_JS(true) + ')')();   // parses as JS
  });
});
```

Append to `tests/recorder/live-record.test.ts`:

```typescript
it('armed: loop keeps running while session inactive; a toggle event starts capture', async () => {
  const store = RecordStore.fromDatabase(new Database(':memory:'));
  // NOT started — armed loop must still run, capturing nothing.
  const toggleEvt = JSON.stringify([{ seq: 1, kind: 'toggle', url: 'https://s.test/' }]);
  const clickEvt = JSON.stringify([{ seq: 2, kind: 'click', url: 'https://s.test/', tagName: 'button', leafText: 'Login' }]);
  const adapter = fakeAdapter([
    { url: 'https://s.test/', snap: LOGIN },
    { url: 'https://s.test/', snap: LOGIN, drain: toggleEvt },   // human hits ⏺ in the overlay
    { url: 'https://s.test/', snap: LOGIN, drain: clickEvt },
    { url: 'https://s.test/inventory.html', snap: INV },
    { url: 'https://s.test/inventory.html', snap: INV },
  ]);
  let n = 0;
  await runLiveRecord({ adapter, store, sessionId: 'armed-1', intervalMs: 0, armed: true,
    log: () => {}, isStopped: () => ++n > 7, sleep: async () => {} });
  expect(store.isActive('armed-1')).toBe(true);            // toggle started the session
  expect(store.actionEffects('armed-1').length).toBe(1);   // the click after toggle was captured
});

it('armed: 5 consecutive tick errors end the loop (browser closed by user)', async () => {
  const store = RecordStore.fromDatabase(new Database(':memory:'));
  const adapter = { evalJs: async () => 'installed', snapshot: async () => { throw new Error('closed'); },
    currentUrl: async () => 'x', close: async () => '' };
  const res = await runLiveRecord({ adapter, store, sessionId: 'armed-2', intervalMs: 0, armed: true,
    log: () => {}, isStopped: () => false, sleep: async () => {} });
  expect(res.ticks).toBe(0);   // never archived a tick; loop exited on error streak, not hung
});
```

- [ ] **Step 2:** run both files → new cases FAIL.

- [ ] **Step 3: implement.**

`src/playwright/adapter.ts` (after `snapshot()`):
```typescript
  /** Screenshot the current page; returns the .png path playwright-cli printed, or
   *  null if none was found (callers treat shots as optional decoration). */
  async screenshot(): Promise<string | null> {
    try {
      const out = await this.exec('screenshot');
      const m = out.match(/\(([^)]+\.png)\)/) ?? out.match(/(\/\S+\.png)/);
      return m ? m[1] : null;
    } catch { return null; }
  }
```

`src/recorder/live.ts` — INSTALLER_JS changes (inside the existing badge-creation block): the pill `p` becomes a `button` with `pointer-events:auto;cursor:pointer;border:0` in its cssText, `p.textContent` initial `'⏺ record'`, and after `d.appendChild(p)` add:
```
    p.onclick = () => { push({ kind: 'toggle' }); };
```
(`push` is in scope — the badge block moves BELOW the `push` definition but stays ABOVE the idempotence-guard early-return is impossible since push is defined after the guard; so: move the badge-creation block to AFTER `push` is defined, and keep a tiny pre-guard `ensure badge` no-op — simplest correct restructure: keep badge creation where it is WITHOUT onclick, and after `push` is defined add `const badgeBtn = document.querySelector('#__webnav_rec_badge button'); if (badgeBtn) badgeBtn.onclick = () => push({ kind: 'toggle' });`. The badge's pill must therefore be created as `document.createElement('button')`.) Update the badge test expectations accordingly (the existing badge test keeps passing — it checks id/pointer-events:none on the WRAPPER/aria-hidden/order only; wrapper keeps `pointer-events:none`, the button alone overrides with `auto`).

Add `MODE_JS`:
```typescript
// Recolor the overlay for the current mode. Evaled by the loop whenever the mode
// changes (and after each re-inject). Red = capturing; grey = armed (open, not recording).
export const MODE_JS = (recording: boolean) => `() => {
  const d = document.getElementById('__webnav_rec_badge');
  if (!d) return 'no-badge';
  d.style.boxShadow = 'inset 0 0 0 4px ${recording ? '#e5484d' : '#8b93a3'}';
  const p = d.querySelector('button');
  if (p) { p.style.background = '${recording ? '#e5484d' : '#8b93a3'}'; p.textContent = '${recording ? '\\u25CF REC' : '\\u23FA record'}'; }
  return 'ok';
}`;
```
And widen the type: `kind: 'click' | 'input' | 'toggle'`.

`src/recorder/live-record.ts` loop changes:
```typescript
// deps: armed?: boolean; store gains start/stop in the type.
let errStreak = 0;
while (!deps.isStopped() && (deps.armed ? true : deps.store.isActive(deps.sessionId))) {
  ...existing install/drain...
  // toggle events flip capture; they are control, not data — never pended.
  const toggles = events.filter((e) => e.kind === 'toggle');
  const data = events.filter((e) => e.kind !== 'toggle');
  for (const _t of toggles) {
    if (deps.store.isActive(deps.sessionId)) deps.store.stop(deps.sessionId);
    else deps.store.start(deps.sessionId);
  }
  for (const ev of data) pending.push({ ev, drainIdx: ticks.length, waits: 0 });
  ...existing guarded snapshot/currentUrl...
  //   in the catch: `if (deps.isStopped() || (!deps.armed && !deps.store.isActive(...))) break;`
  //   plus: `if (++errStreak >= 5) { deps.log('browser gone — ending'); break; }`
  //   on success: errStreak = 0;
  ...existing tick archive + pending processing...
  await deps.adapter.evalJs(MODE_JS(deps.store.isActive(deps.sessionId))).catch(() => {});
  await sleep(deps.intervalMs);
}
```
Implement exactly this shape (the existing body stays; only the while-condition, the toggle split, the errStreak in the existing catch, and the MODE_JS eval per tick are new). Import `MODE_JS` from `./live.js`.

- [ ] **Step 4:** both test files + full `npx vitest run` + tsc green.
- [ ] **Step 5:** commit `feat(recorder): armed mode — open-without-recording, overlay ⏺ toggle, adapter.screenshot`

---

## Task 3: Replay engine

**Files:** Create `src/recorder/replay.ts` · Modify `src/explorer/draft.ts` (export COMMIT_WORDS) · Test `tests/recorder/replay.test.ts`

**Interfaces — Produces:**
```typescript
export interface ReplayStep { seq: number; label: string;
  status: 'pending' | 'running' | 'ok' | 'fail' | 'jumped' | 'skipped'; shot: string | null; note?: string }
export interface ReplayState { session: string; running: boolean; mode: 'auto' | 'step';
  waiting: 'value' | 'confirm' | null; waitingLabel?: string; steps: ReplayStep[]; done: boolean; error?: string }
export class ReplayController {
  readonly state: ReplayState;
  constructor(session: string, labels: { seq: number; label: string }[]);
  control(action: 'pause' | 'next' | 'resume' | 'abort'): boolean;
  supply(value: string, save: boolean): boolean;   // answers waiting:'value'
  confirm(fire: boolean): boolean;                 // answers waiting:'confirm'; fire:false skips the step
  /** used by runReplay */ gate(): Promise<'go' | 'abort'>; waitFor(kind: 'value' | 'confirm', label: string): Promise<{ value?: string; save?: boolean; fire?: boolean } | 'abort'>;
}
export interface ReplayDeps {
  adapter: { goto(u: string): Promise<unknown>; open(u: string): Promise<unknown>; click(r: string): Promise<unknown>;
    fill(r: string, t: string): Promise<unknown>; snapshot(): Promise<string>; currentUrl(): Promise<string>;
    screenshot(): Promise<string | null>; close(): Promise<unknown> };
  creds: { get(site: string): Record<string, string>; set(site: string, kv: Record<string, string>): unknown };
  site: string; shotsDir: string | null;           // null → no thumbnails
  paceMs?: number; sleep?: (ms: number) => Promise<void>;
}
export async function runReplay(effects: StoredActionEffect[], ctl: ReplayController, deps: ReplayDeps): Promise<ReplayState>
```

**Behavior (implement exactly):**
1. `adapter.open(effects[0].fromUrl)`.
2. Per effect in order — set step `running`, then `await ctl.gate()` (auto → `sleep(paceMs ?? 1500)`; step-mode → resolve on `next`; `abort` anywhere → mark remaining `skipped`, `done`, close, return):
   - `action === null`: navigated → `goto(e.toUrl)`, status `jumped`; else `skipped` (no gate/screenshot for skipped).
   - action with `elementFp`: fresh `parseSnapshot(await adapter.snapshot())` → `resolveByFingerprint(fp, nodes)`; null → `fail` + auto-pause (switch `mode='step'`), note `'element not found'` — human can `next` (retry resolve once) or `abort`.
   - input action (`role==='textbox'`): value = cred lookup — normalize both sides `s.toLowerCase().replace(/[^a-z0-9]/g,'')` and match field name to a cred key of `creds.get(site)`; miss → `ctl.waitFor('value', label)`; on `{value, save}` — `save` → `creds.set(site, { [normName]: value })`; then `fill(ref, value)`. The value is NEVER stored on the step/state.
   - click action: if `COMMIT_WORDS.test(label)` → `ctl.waitFor('confirm', label)`; `fire:false` → status `skipped` and continue; else `click(ref)`.
   - verify: for `e.navigated`, `didNavigate(await currentUrl(), e.toUrl)` must be false, else `fail` + auto-pause, note `'landed elsewhere'`.
   - screenshot → if `shotsDir`, `fs.copyFileSync(src, join(shotsDir, 'step-' + seq + '.png'))` (mkdirSync recursive first; wrap in try — decoration only), step.shot = `'step-' + seq + '.png'`.
   - status `ok`.
3. `done = true`, `running = false`, `adapter.close()` in a finally.

`src/explorer/draft.ts`: change `const COMMIT_WORDS` → `export const COMMIT_WORDS` (no other change).

- [ ] **Step 1: failing tests** — `tests/recorder/replay.test.ts`, full file:

```typescript
import { describe, it, expect } from 'vitest';
import { ReplayController, runReplay } from '../../src/recorder/replay.js';
import type { StoredActionEffect } from '../../src/mapstore/record.js';

const LOGIN = ['RootWebArea "Login" [ref=e1]', '  textbox "Username" [ref=e2]',
  '  textbox "Password" [ref=e3]', '  button "Login" [ref=e4]'].join('\n');
const INV = ['RootWebArea "Products" [ref=e1]', '  button "Finish" [ref=e2]'].join('\n');
const fx = (over: Partial<StoredActionEffect>): StoredActionEffect => ({
  seq: 0, capturedAt: 0, fromUrl: 'https://s.test/', fromSnapshot: LOGIN, action: null,
  toUrl: 'https://s.test/', toSnapshot: LOGIN, navigated: false, diff: { added: [], removed: [] }, ...over } as any);

function fakeAdapter(pages: Record<string, string>) {
  let url = '';
  return {
    open: async (u: string) => { url = u; }, goto: async (u: string) => { url = u; },
    click: async () => { if (url.endsWith('/')) url = 'https://s.test/inventory.html'; },
    fill: async () => {}, snapshot: async () => pages[url] ?? LOGIN,
    currentUrl: async () => url, screenshot: async () => null, close: async () => '',
    calls: [] as string[],
  };
}
const PAGES = { 'https://s.test/': LOGIN, 'https://s.test/inventory.html': INV };

it('replays input (stored cred) + navigated click to ok', async () => {
  const effects = [
    fx({ seq: 1, action: { role: 'textbox', name: 'Username', ref: null, elementFp: { role: 'textbox', name: 'Username', near: null } } }),
    fx({ seq: 2, action: { role: 'button', name: 'Login', ref: null, elementFp: { role: 'button', name: 'Login', near: null } },
        toUrl: 'https://s.test/inventory.html', navigated: true }),
  ];
  const ctl = new ReplayController('r1', effects.map((e) => ({ seq: e.seq, label: e.action!.name! })));
  const st = await runReplay(effects, ctl, { adapter: fakeAdapter(PAGES) as any,
    creds: { get: () => ({ username: 'u' }), set: () => {} }, site: 's.test', shotsDir: null, paceMs: 0, sleep: async () => {} });
  expect(st.steps.map((s) => s.status)).toEqual(['ok', 'ok']);
  expect(st.done).toBe(true);
});

it('missing cred pauses waiting:value; supply(save) writes to the store', async () => {
  const saved: any[] = [];
  const effects = [fx({ seq: 1, action: { role: 'textbox', name: 'Password', ref: null,
    elementFp: { role: 'textbox', name: 'Password', near: null } } })];
  const ctl = new ReplayController('r2', [{ seq: 1, label: 'Password' }]);
  const p = runReplay(effects, ctl, { adapter: fakeAdapter(PAGES) as any,
    creds: { get: () => ({}), set: (_s, kv) => saved.push(kv) }, site: 's.test', shotsDir: null, paceMs: 0, sleep: async () => {} });
  await new Promise((r) => setTimeout(r, 10));
  expect(ctl.state.waiting).toBe('value');
  ctl.supply('secret', true);
  const st = await p;
  expect(st.steps[0].status).toBe('ok');
  expect(saved).toEqual([{ password: 'secret' }]);
  expect(JSON.stringify(st)).not.toContain('secret');    // value never in state
});

it('commit-labeled step pauses waiting:confirm; fire:false skips it', async () => {
  const effects = [fx({ seq: 1, fromUrl: 'https://s.test/inventory.html', fromSnapshot: INV,
    action: { role: 'button', name: 'Finish', ref: null, elementFp: { role: 'button', name: 'Finish', near: null } },
    toUrl: 'https://s.test/done.html', navigated: true })];
  const ctl = new ReplayController('r3', [{ seq: 1, label: 'Finish' }]);
  const p = runReplay(effects, ctl, { adapter: fakeAdapter({ 'https://s.test/inventory.html': INV }) as any,
    creds: { get: () => ({}), set: () => {} }, site: 's.test', shotsDir: null, paceMs: 0, sleep: async () => {} });
  await new Promise((r) => setTimeout(r, 10));
  expect(ctl.state.waiting).toBe('confirm');
  ctl.confirm(false);
  const st = await p;
  expect(st.steps[0].status).toBe('skipped');   // never fired (#2)
});

it('unresolvable element fails + drops to step mode; abort finishes', async () => {
  const effects = [fx({ seq: 1, action: { role: 'button', name: 'Ghost', ref: null,
    elementFp: { role: 'button', name: 'Ghost', near: null } } }),
    fx({ seq: 2, action: null, toUrl: 'https://s.test/inventory.html', navigated: true })];
  const ctl = new ReplayController('r4', [{ seq: 1, label: 'Ghost' }, { seq: 2, label: 'nav' }]);
  const p = runReplay(effects, ctl, { adapter: fakeAdapter(PAGES) as any,
    creds: { get: () => ({}), set: () => {} }, site: 's.test', shotsDir: null, paceMs: 0, sleep: async () => {} });
  await new Promise((r) => setTimeout(r, 10));
  expect(ctl.state.steps[0].status).toBe('fail');
  expect(ctl.state.mode).toBe('step');
  ctl.control('abort');
  const st = await p;
  expect(st.done).toBe(true);
  expect(st.steps[1].status).toBe('skipped');
});
```

- [ ] **Step 2:** run → FAIL (no module).
- [ ] **Step 3: implement `src/recorder/replay.ts`** per the Behavior block. Controller internals: promise-based gates —
```typescript
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
    if (action === 'abort') { this.aborted = true; this.nextResolve?.(); this.nextResolve = null;
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
```
`runReplay` follows the Behavior block verbatim (fail → `this.state.mode = 'step'` via ctl; import `COMMIT_WORDS` from `../explorer/draft.js`, `resolveByFingerprint` from `../playwright/fingerprint.js`, `parseSnapshot`, `didNavigate`; `mkdirSync`/`copyFileSync` from `node:fs`). Note: `gate` is called with `(deps.sleep ?? realSleep, deps.paceMs ?? 1500)`.

- [ ] **Step 4:** replay tests + full suite + tsc green.
- [ ] **Step 5:** commit `feat(recorder): replay engine — auto-play/step gates, cred fill, commit confirm, screenshots`

---

## Task 4: Dashboard endpoints

**Files:** Modify `src/dashboard/server.ts` · Test `tests/dashboard/server.test.ts` (append)

**Interfaces — Produces:** `startDashboard(store, creds, opts, rec?: RecordingsDeps)` — absent `rec` → recordings routes return 503 `{error:'recordings not wired'}` (keeps old callers/tests valid).
```typescript
export interface RecordingsDeps {
  list(): RecordSessionInfo[];
  steps(id: string): { seq: number; label: string; kind: string; toUrl: string }[];  // readable step list
  del(id: string): void;
  draft(id: string): unknown;                                    // draftFromEffects output
  open(url: string, session: string, persistent: boolean): Promise<{ ok: true } | { ok: false; error: string }>;  // 409 when busy
  record(id: string): boolean; stop(id: string): boolean;
  replay(id: string): Promise<{ ok: true } | { ok: false; error: string }>;          // 409 when busy
  replayState(): ReplayState | null;
  replayControl(action: string, payload: { value?: string; save?: boolean; fire?: boolean }): boolean;
  shotPath(session: string, file: string): string | null;        // sanitized absolute path or null
}
```
**Routes** (add before the 405/404 fallthrough; every route guarded by `if (!rec) return sendJson(503, ...)`):
- `GET /api/recordings` → `rec.list()`
- `GET /api/recordings/:id/steps` → `rec.steps(id)`
- `DELETE /api/recordings/:id` → `rec.del(id)` → `{ok:true}`
- `GET /api/recordings/:id/draft` → `rec.draft(id)`
- `POST /api/recordings/open` body `{url, session, persistent?}` → 400 on missing url/session; `rec.open(...)` → 200 or 409
- `POST /api/recordings/:id/record` / `:id/stop` → boolean → 200/404
- `POST /api/recordings/:id/replay` → 200 or 409
- `GET /api/replay/status` → `rec.replayState() ?? {running:false}` (200)
- `POST /api/replay/control` body `{action, value?, save?, fire?}` → `rec.replayControl(...)` → 200/400
- `GET /replays/:session/:file` → `rec.shotPath(...)`; null → 404; else stream the file with `content-type: image/png` (use `createReadStream`; reject any `session`/`file` containing `/` or `..` — the regex match `^\/replays\/([^/]+)\/([^/]+\.png)$` already enforces shape).

- [ ] **Step 1: failing tests** (append; follow the file's existing beforeAll/fetch pattern — build a SECOND server in a new describe with fake `rec` deps):

```typescript
describe('recordings API', () => {
  let base: string; let server: Server;
  const calls: string[] = [];
  const rec = {
    list: () => [{ sessionId: 'r1', active: false, startedAt: 1, stoppedAt: 2, steps: 3, site: 's.test' }],
    steps: (id: string) => [{ seq: 1, label: 'Login', kind: 'navigate', toUrl: 'https://s.test/x' }],
    del: (id: string) => { calls.push('del:' + id); },
    draft: () => ({ states: [] }),
    open: async () => ({ ok: true as const }),
    record: (id: string) => { calls.push('rec:' + id); return true; },
    stop: (id: string) => { calls.push('stop:' + id); return true; },
    replay: async () => ({ ok: false as const, error: 'busy' }),
    replayState: () => null,
    replayControl: () => true,
    shotPath: () => null,
  };
  beforeAll(async () => {
    server = startDashboard(new MapStore(':memory:'), new CredStore(join(tmp2, 'c.json')), { port: 0 }, rec as any);
    await new Promise((r) => server.on('listening', r));
    base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  });
  afterAll(() => server.close());

  it('lists recordings and steps', async () => {
    expect(await (await fetch(base + '/api/recordings')).json()).toHaveLength(1);
    expect(await (await fetch(base + '/api/recordings/r1/steps')).json()).toHaveLength(1);
  });
  it('record/stop/delete round-trip', async () => {
    await fetch(base + '/api/recordings/r1/record', { method: 'POST' });
    await fetch(base + '/api/recordings/r1/stop', { method: 'POST' });
    await fetch(base + '/api/recordings/r1', { method: 'DELETE' });
    expect(calls).toEqual(['rec:r1', 'stop:r1', 'del:r1']);
  });
  it('busy replay → 409; missing shot → 404; open validates body', async () => {
    expect((await fetch(base + '/api/recordings/r1/replay', { method: 'POST' })).status).toBe(409);
    expect((await fetch(base + '/replays/r1/step-1.png')).status).toBe(404);
    expect((await fetch(base + '/api/recordings/open', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(400);
  });
  it('without rec deps the routes are 503', async () => {
    const s2 = startDashboard(new MapStore(':memory:'), new CredStore(join(tmp2, 'c2.json')), { port: 0 });
    await new Promise((r) => s2.on('listening', r));
    const b2 = 'http://127.0.0.1:' + (s2.address() as AddressInfo).port;
    expect((await fetch(b2 + '/api/recordings')).status).toBe(503);
    s2.close();
  });
});
```
(`tmp2` = a `mkdtempSync` local to this describe; add needed imports mirroring the top of the file.)

- [ ] **Step 2:** FAIL. **Step 3:** implement the routes exactly as listed. **Step 4:** dashboard tests + full suite + tsc green. **Step 5:** commit `feat(dashboard): recordings + replay API (injected deps; 503 when unwired)`

---

## Task 5: Recordings tab UI

**Files:** Modify `src/dashboard/shell.ts` · Test `tests/dashboard/shell.test.ts` (append)

- [ ] **Step 1: failing test** (append):
```typescript
it('has a Recordings tab wired to the recordings API', () => {
  expect(SHELL_HTML).toContain('data-tab="recordings"');
  expect(SHELL_HTML).toContain('/api/recordings');
  expect(SHELL_HTML).toContain('/api/replay/status');
  expect(SHELL_HTML).toContain('renderRecordings');
});
```
- [ ] **Step 2:** FAIL. **Step 3: implement** — in `SHELL_HTML`: add `<button data-tab="recordings">Recordings</button>` to the nav; in `render()` add `if (tab === 'recordings') return renderRecordings();`; append the following before the final `render();` (match the file's style — `el`/`esc`/`getJSON` helpers; template-literal `${}` must be escaped as `\${}` inside SHELL_HTML — the file uses string concatenation, keep doing that):

```javascript
// ---------- RECORDINGS ----------
let replayPoll = null;
async function renderRecordings() {
  clearInterval(replayPoll); replayPoll = null;
  main.style.gridTemplateColumns = '280px 1fr';
  const recs = await getJSON('/api/recordings');
  main.innerHTML = '';
  const list = el('<div class="list"></div>');
  const detail = el('<div class="detail"><div class="empty">select a recording — or open a window below</div></div>');
  recs.forEach(r => {
    const when = new Date(r.startedAt).toLocaleString();
    const row = el('<div class="row"><div class="name">'+esc(r.sessionId)+(r.active?' <span style="color:#e5484d">●</span>':'')+'</div><div class="meta">'+esc(r.site||'?')+' · '+r.steps+' steps · '+esc(when)+'</div></div>');
    row.onclick = () => showRecording(r, detail, list, row);
    list.append(row);
  });
  if (!recs.length) list.append(el('<div class="empty">no recordings yet</div>'));
  list.append(newRecordingCard());
  main.append(list, detail);
}
function newRecordingCard() {
  const card = el('<div style="padding:12px;border-top:1px solid var(--border)"><div class="cat-head">New recording</div><div class="addrow" style="display:flex;flex-direction:column;gap:6px"><input placeholder="https://site-to-record" /><input placeholder="session name" /><label class="muted" style="font-size:12px"><input type="checkbox" style="width:auto;margin-right:6px" />keep me logged in (persistent profile)</label><button class="btn">Open window (armed)</button></div><div class="muted" id="openmsg" style="font-size:12px;margin-top:6px"></div></div>');
  const [urlIn, sessIn] = card.querySelectorAll('input:not([type=checkbox])');
  const persistIn = card.querySelector('input[type=checkbox]');
  card.querySelector('button').onclick = async () => {
    const msg = card.querySelector('#openmsg');
    if (!urlIn.value || !sessIn.value) { msg.textContent = 'url + session name required'; return; }
    const r = await fetch('/api/recordings/open', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ url: urlIn.value, session: sessIn.value, persistent: persistIn.checked }) });
    msg.textContent = r.ok ? 'window opened (grey border = armed). Hit Record here or \\u23FA in the window.' : (await r.json()).error;
    if (r.ok) setTimeout(renderRecordings, 800);
  };
  return card;
}
async function showRecording(r, detail, list, row) {
  list.querySelectorAll('.row').forEach(x => x.classList.remove('active')); row.classList.add('active');
  const steps = await getJSON('/api/recordings/'+encodeURIComponent(r.sessionId)+'/steps');
  detail.innerHTML = '';
  const head = el('<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px"><strong>'+esc(r.sessionId)+'</strong><span class="muted">'+esc(r.site||'')+'</span><span style="flex:1"></span></div>');
  const btn = (t, danger) => el('<button class="btn'+(danger?' danger':'')+'">'+t+'</button>');
  const recB = btn(r.active ? 'Stop' : 'Record'), repB = btn('Replay'), anB = btn('Analyse \\u2192 draft'), delB = btn('Delete', true);
  recB.onclick = async () => { await fetch('/api/recordings/'+encodeURIComponent(r.sessionId)+'/'+(r.active?'stop':'record'), { method:'POST' }); renderRecordings(); };
  delB.onclick = async () => { if (confirm('Delete recording '+r.sessionId+'?')) { await fetch('/api/recordings/'+encodeURIComponent(r.sessionId), { method:'DELETE' }); renderRecordings(); } };
  anB.onclick = async () => { const d = await getJSON('/api/recordings/'+encodeURIComponent(r.sessionId)+'/draft'); stepsBox.innerHTML = ''; stepsBox.append(el('<pre>'+esc(JSON.stringify(d, null, 2))+'</pre>')); };
  repB.onclick = async () => {
    const res = await fetch('/api/recordings/'+encodeURIComponent(r.sessionId)+'/replay', { method:'POST' });
    if (!res.ok) { alert((await res.json()).error); return; }
    pollReplay(stepsBox, r.sessionId);
  };
  head.append(recB, repB, anB, delB);
  const stepsBox = el('<div></div>');
  stepsBox.append(stepTable(steps.map(s => ({ ...s, status: '' }))));
  detail.append(head, stepsBox);
}
function stepTable(steps, session) {
  const t = el('<table><tbody></tbody></table>'); const tb = t.querySelector('tbody');
  const ICON = { ok: '\\u2713', fail: '\\u2717', running: '\\u25B6', jumped: '\\u21AA', skipped: '\\u2298', pending: '\\u00B7', '': '' };
  steps.forEach(s => {
    const color = s.status==='ok'?'#3fb950':s.status==='fail'?'#ff6b6b':'var(--muted)';
    const shot = s.shot && session ? '<img src="/replays/'+encodeURIComponent(session)+'/'+encodeURIComponent(s.shot)+'" style="height:44px;border-radius:4px;border:1px solid var(--border)" />' : '';
    tb.append(el('<tr><td style="width:28px;color:'+color+'">'+(ICON[s.status]||'')+'</td><td>'+esc(s.label||s.kind||'step '+s.seq)+(s.note?' <span class="muted">('+esc(s.note)+')</span>':'')+'</td><td style="text-align:right">'+shot+'</td></tr>'));
  });
  return t;
}
function pollReplay(box, session) {
  clearInterval(replayPoll);
  const controls = el('<div style="display:flex;gap:8px;margin:10px 0"><button class="btn">Pause</button><button class="btn">Next</button><button class="btn">Resume</button><button class="btn danger">Abort</button></div>');
  const [pauseB, nextB, resumeB, abortB] = controls.querySelectorAll('button');
  const ctl = a => body => fetch('/api/replay/control', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(Object.assign({ action: a }, body||{})) });
  pauseB.onclick = () => ctl('pause')(); nextB.onclick = () => ctl('next')(); resumeB.onclick = () => ctl('resume')(); abortB.onclick = () => ctl('abort')();
  const prompt = el('<div></div>');
  replayPoll = setInterval(async () => {
    const st = await getJSON('/api/replay/status');
    if (!st || st.running === false) { clearInterval(replayPoll); }
    box.innerHTML = ''; box.append(controls, prompt, stepTable(st.steps || [], session));
    prompt.innerHTML = '';
    if (st.waiting === 'value') {
      const p = el('<div class="addrow" style="margin:8px 0"><span class="muted">value for \\u201C'+esc(st.waitingLabel||'')+'\\u201D: </span><input type="password" /><button class="btn">Use once</button><button class="btn">Use &amp; save</button></div>');
      const inp = p.querySelector('input'); const [once, save] = p.querySelectorAll('button');
      once.onclick = () => ctl('supply')({ value: inp.value, save: false });
      save.onclick = () => ctl('supply')({ value: inp.value, save: true });
      prompt.append(p);
    } else if (st.waiting === 'confirm') {
      const p = el('<div class="addrow" style="margin:8px 0"><span style="color:#ff6b6b">\\u26A0 \\u201C'+esc(st.waitingLabel||'')+'\\u201D looks like a commit (order/pay/delete). Fire it?</span> <button class="btn danger">Fire</button><button class="btn">Skip</button></div>');
      const [fire, skip] = p.querySelectorAll('button');
      fire.onclick = () => ctl('confirm')({ fire: true }); skip.onclick = () => ctl('confirm')({ fire: false });
      prompt.append(p);
    }
    if (st.done) clearInterval(replayPoll);
  }, 700);
}
```
Server-side note: `replayControl` must accept actions `supply` (with `{value, save}`) and `confirm` (with `{fire}`) in addition to pause/next/resume/abort — Task 4's `replayControl(action, payload)` signature already carries the payload; the REAL deps (Task 6) route `supply`→`ctl.supply`, `confirm`→`ctl.confirm`, others→`ctl.control`.

- [ ] **Step 4:** shell + full suite + tsc green. **Step 5:** commit `feat(dashboard): Recordings tab — armed open, record/stop, replay filmstrip + prompts`

---

## Task 6: CLI wiring + docs

**Files:** Modify `src/cli.ts` (dashboard dispatch) · Modify `docs/STATUS.md`, `README.md`

- [ ] **Step 1: wire real deps** in the `dashboard` handler (read the current handler first; it constructs MapStore + CredStore and calls `startDashboard`). Build `RecordingsDeps` there:

```typescript
const { RecordStore } = await import('./mapstore/record.js');
const { runLiveRecord } = await import('./recorder/live-record.js');
const { ReplayController, runReplay } = await import('./recorder/replay.js');
const { draftFromEffects } = await import('./explorer/draft.js');
const { PlaywrightAdapter } = await import('./playwright/adapter.js');
const { join } = await import('node:path');
const { homedir } = await import('node:os');
const recordStore = new RecordStore(dbPath());
let busy: string | null = null;          // ONE driven browser at a time (CLAUDE.md rule)
let activeCtl: InstanceType<typeof ReplayController> | null = null;
const shotsRoot = join(homedir(), '.webnav', 'replays');
const rec = {
  list: () => recordStore.listSessions(),
  steps: (id: string) => recordStore.actionEffects(id).map((e) => ({ seq: e.seq,
    label: e.action?.name ?? (e.navigated ? new URL(e.toUrl).pathname : 'observe'),
    kind: e.action ? (e.navigated ? 'navigate' : e.action.role === 'textbox' ? 'input' : 'click') : (e.navigated ? 'jump' : 'observe'),
    toUrl: e.toUrl })),
  del: (id: string) => recordStore.clearSession(id),
  draft: (id: string) => draftFromEffects(recordStore.actionEffects(id)),
  open: async (url: string, session: string, persistent: boolean) => {
    if (busy) return { ok: false as const, error: 'a driven browser is already open (' + busy + ')' };
    busy = session;
    const adapter = new PlaywrightAdapter(session, undefined, undefined, { headed: true, persistent });
    await adapter.open(url);
    void runLiveRecord({ adapter, store: recordStore, sessionId: session, intervalMs: 500, armed: true,
      log: (l) => process.stderr.write(l + '\n'), isStopped: () => false })
      .finally(() => { busy = null; recordStore.stop(session); });
    return { ok: true as const };
  },
  record: (id: string) => { recordStore.start(id); return true; },
  stop: (id: string) => { recordStore.stop(id); return true; },
  replay: async (id: string) => {
    if (busy) return { ok: false as const, error: 'a driven browser is already open (' + busy + ')' };
    const effects = recordStore.actionEffects(id);
    if (!effects.length) return { ok: false as const, error: 'empty recording' };
    busy = 'replay:' + id;
    const site = (() => { try { return new URL(effects[0].fromUrl).host; } catch { return ''; } })();
    const ctl = new ReplayController(id, effects.map((e) => ({ seq: e.seq, label: e.action?.name ?? (e.navigated ? 'jump' : 'observe') })));
    activeCtl = ctl;
    const adapter = new PlaywrightAdapter('replay-' + id, undefined, undefined, { headed: true });
    void runReplay(effects, ctl, { adapter, creds: credStoreForDashboard, site, shotsDir: join(shotsRoot, id) })
      .finally(() => { busy = null; });
    return { ok: true as const };
  },
  replayState: () => activeCtl?.state ?? null,
  replayControl: (action: string, p: { value?: string; save?: boolean; fire?: boolean }) => {
    if (!activeCtl) return false;
    if (action === 'supply') return activeCtl.supply(p.value ?? '', !!p.save);
    if (action === 'confirm') return activeCtl.confirm(!!p.fire);
    return activeCtl.control(action as 'pause' | 'next' | 'resume' | 'abort');
  },
  shotPath: (session: string, file: string) =>
    /^[\w.-]+$/.test(session) && /^step-\d+\.png$/.test(file) ? join(shotsRoot, session, file) : null,
};
// pass as 4th arg: startDashboard(store, credStoreForDashboard, { port }, rec)
```
(`credStoreForDashboard` = the CredStore instance the handler already constructs — reuse its variable name from the real code.) Verify `adapter.fill/click/goto/open` names against `ReplayDeps` — the adapter satisfies it structurally.

- [ ] **Step 2: verify** — `npx vitest run && npx tsc --noEmit` green; manual smoke: `./bin/webnav dev dashboard --port 7791` + `curl http://127.0.0.1:7791/api/recordings` returns JSON (list from the real DB); Ctrl-C.
- [ ] **Step 3: docs** — STATUS: dated entry (control center: armed record, recordings list, replay-verify w/ screenshots, cred pause-and-ask, commit confirm; live acceptance pending — human). README: dashboard bullet mentions the Recordings tab. Commit `feat(dashboard): wire recordings deps; docs`.

**Live acceptance (human, after all tasks):** from the dashboard — New recording (saucedemo, armed grey) → Record (red) → login→cart → Stop → recording listed → Replay: creds auto-fill, filmstrip goes green; a Finish-containing recording pauses at the confirm and does not fire without the click; second Open while one window is up → clear 409 message.

---

## Self-Review

**Spec coverage:** armed decoupling + overlay ⏺ (T2); list/steps/delete/draft (T1/T4); replay auto+pause-into-step, value-pause w/ save-offer, commit-confirm, fail-pause, jumped for action:null navs, screenshots filmstrip (T3/T4/T5); persistent-profile toggle (T5/T6 `persistent`); one-browser rule (T6 `busy`); 503-unwired keeps dashboard usable standalone (T4). Out-of-scope items from the spec are absent. ✓
**Placeholders:** none; all steps carry code. The two flagged live-verify items: playwright-cli `screenshot` output path format (adapter parses two patterns, returns null gracefully) and SHELL string-concat escaping (unicode escapes `\\uXXXX` must survive the outer template literal — implementer verifies via the shell test + a browser open).
**Type consistency:** `RecordSessionInfo` (T1) ↔ `rec.list` (T4/T6); `ReplayState/ReplayController` (T3) ↔ `replayState/replayControl` (T4/T6); `LiveRecordDeps.armed` + `store.start/stop` (T2) ↔ T6's `runLiveRecord` call; `COMMIT_WORDS` exported (T3) before use. `ReplayController.gate(sleep, paceMs)` signature — runReplay passes both. ✓
