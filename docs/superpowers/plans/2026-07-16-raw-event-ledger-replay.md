# Raw-Event Ledger + Two-Mode Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the raw event stream every recording already captures (but discards), make capture losses measurable per session, add a ledger-based "exact rerun" replay mode alongside the existing steps replay, surface both in the dashboard, and fix the two defects that crash the dashboard on Replay.

**Architecture:** A new append-only `record_events` table sits beside `record_observations`; capture paths append events at the earliest point and stamp a disposition (`step:<seq>` / `dropped:<reason>`) where they already log the outcome. A pure `coverage()` diff aggregates dispositions. A second replay runner (`runLedgerReplay`) plays raw events through the SAME `ReplayController`, resolving descriptors with the existing `resolveEvent` (no CSS selectors — settled). Crash fixes: a deterministic session-name cap in `PlaywrightAdapter` (macOS 104-char unix-socket limit) and a never-rejecting `runReplay`.

**Tech Stack:** TypeScript strict, Node 18+, better-sqlite3, vitest, playwright-cli (via the existing `PlaywrightAdapter`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-16-raw-event-ledger-replay-design.md`

## Global Constraints

- **Capture-engine gate:** `live.ts`, `live-record.ts`, `agent-session.ts`, `review.ts`, `browse.ts` (recording seams), `record.ts` — edits happen only after the user's explicit OK for this plan's execution.
- **Zero LLM in webnav** (principle #5a). The ledger, coverage, and both replay runners are deterministic. Never guess a ref — ambiguity pauses/escalates.
- **The ledger stores descriptors, never CSS selectors** (settled). **Secrets are never captured**: human path inherits the in-page secret rule; agent path stores NO typed text at all (no secret oracle there — replay falls back to creds/ask).
- **Uniform JSON stdout** for CLI verbs; diagnostics to stderr. Exit codes 0/2/3.
- **Style:** 2-space indent, single quotes, existing naming. Comments only for constraints the code can't show (match surrounding density).
- **`src/dashboard/shell.ts` is one big TS template literal** — client JS inside it must follow the file's escaping conventions (`\\n` for newlines in client regexes/strings, `BT` for backticks, no bare backslashes). Copy the style of the surrounding code exactly.
- **Testing:** vitest, no real browser in unit tests (fake adapters / `RecordStore.fromDatabase(new Database(':memory:'))`). Full suite must stay green: `npm test`.
- **Headless only** for any live verification; at most ONE headed window, only where headed is the point, reaped after.
- **Commits:** author `dikshant.y` (already configured), conventional messages, commit per task.

---

### Task 1: Session-name cap in PlaywrightAdapter (crash fix 1/2)

The dashboard replay crash: `playwright-cli -s=replay-report-builder open …` → `listen EINVAL … /T/playwright-cli/<16-char-hash>/replay-report-builder.sock`. macOS caps a unix socket path (`sun_path`) at 104 bytes; the TMPDIR prefix (`/var/folders/xx/<30-char-hash>/T/playwright-cli/<16-char-hash>/`) is ~82 chars, leaving ~21 for `<name>.sock` — so any session name over ~16 chars can break. `replay-<id>` names routinely exceed that.

**Files:**
- Modify: `src/playwright/adapter.ts` (constructor + new exported pure function)
- Test: `tests/playwright/adapter.test.ts`

**Interfaces:**
- Produces: `export function wireSessionName(name: string): string` — identity for names ≤16 chars; longer names become `<first-9>-<6-hex-hash>` (exactly 16 chars), deterministic. `PlaywrightAdapter` applies it to its private `session` field, so every `-s=` uses the capped name. Reattach works because the same input always maps to the same wire name.

- [ ] **Step 1: Write the failing tests**

Append to `tests/playwright/adapter.test.ts`:

```ts
import { wireSessionName } from '../../src/playwright/adapter.js';

describe('wireSessionName (macOS unix-socket 104-char cap)', () => {
  it('leaves short names untouched', () => {
    expect(wireSessionName('walk-1')).toBe('walk-1');
    expect(wireSessionName('a'.repeat(16))).toBe('a'.repeat(16));
  });
  it('caps long names to exactly 16 chars, deterministically', () => {
    const long = 'replay-report-builder';   // 21 chars — the live crash name
    const capped = wireSessionName(long);
    expect(capped).toHaveLength(16);
    expect(capped.startsWith('replay-re')).toBe(true);   // readable head survives
    expect(wireSessionName(long)).toBe(capped);           // same input → same wire name
    expect(wireSessionName(long + 'x')).not.toBe(capped); // distinct inputs stay distinct
    expect(capped).toMatch(/^[\w.-]+$/);                  // stays a valid session name
  });
  it('adapter puts the capped name on the wire', async () => {
    const calls: string[][] = [];
    const a = new PlaywrightAdapter('replay-report-builder', async (args) => { calls.push(args); return 'ok'; });
    await a.click('e1');
    expect(calls[0][0]).toBe('-s=' + wireSessionName('replay-report-builder'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/playwright/adapter.test.ts`
Expected: FAIL — `wireSessionName` is not exported.

- [ ] **Step 3: Implement**

In `src/playwright/adapter.ts`, above the class:

```ts
// macOS caps a unix-socket path (sun_path) at 104 bytes. playwright-cli's socket is
// $TMPDIR/playwright-cli/<16-char-hash>/<session>.sock and the darwin TMPDIR prefix is
// ~82 chars — so a session NAME over ~16 chars can hit `listen EINVAL` (live crash:
// 'replay-report-builder', 21 chars). Deterministic cap: same input → same wire name,
// so reattach through this adapter keeps working; names ≤16 are untouched (every seed/
// walk/record name in use today).
const WIRE_MAX = 16;
export function wireSessionName(name: string): string {
  if (name.length <= WIRE_MAX) return name;
  let h = 5381;
  for (let i = 0; i < name.length; i++) h = ((h * 33) ^ name.charCodeAt(i)) >>> 0;
  return name.slice(0, 9) + '-' + h.toString(16).padStart(6, '0').slice(0, 6);
}
```

In the constructor, cap the field (the private `session` is only ever used for `-s=`):

```ts
  constructor(
    private session: string,
    private run: RunFn = defaultRun,
    private readFile: ReadFileFn = (p) => readFileSync(p, 'utf8'),
    private opts: BrowserOpts = { headed: true },   // HEADED by default; pass {headed:false} for CI/headless
  ) { this.session = wireSessionName(session); }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/playwright/adapter.test.ts`
Expected: PASS (all, including the pre-existing adapter tests — short names like `'test-session'` (12 chars) are unchanged).

- [ ] **Step 5: Run the full suite** (session names thread through many tests)

Run: `npm test`
Expected: all green. If a test constructed an adapter with a >16-char literal name and asserts the raw `-s=`, update that assertion to `wireSessionName(...)`.

- [ ] **Step 6: Commit**

```bash
git add src/playwright/adapter.ts tests/playwright/adapter.test.ts
git commit -m "fix(adapter): cap session names for the macOS 104-char unix-socket limit"
```

---

### Task 2: `runReplay` never rejects (crash fix 2/2)

The EINVAL rejection propagated out of `runReplay` (its `try…finally` has no catch, and the `finally`'s bare `await deps.adapter.close()` can itself throw when open never succeeded). `cli.ts` launches it as `void runReplay(...).finally(...)` — an unhandled rejection, which kills the whole dashboard process. Root fix in the engine: `runReplay` always resolves with a terminal state carrying `error`.

**Files:**
- Modify: `src/recorder/replay.ts:96-201` (add catch; guard close)
- Modify: `src/cli.ts:1540-1541` (belt-and-braces `.catch`)
- Test: `tests/recorder/replay.test.ts`

**Interfaces:**
- Produces: `runReplay` (and later `runLedgerReplay`, Task 7) NEVER rejects; on an engine-level failure it resolves with `state.error` set, `state.done === true`, remaining steps `'skipped'`. `ReplayState.error` already exists.

- [ ] **Step 1: Write the failing test**

Append to `tests/recorder/replay.test.ts` (reuse the file's existing fake-adapter/creds helpers for the other fields):

```ts
it('resolves with error state when the browser cannot open — never rejects', async () => {
  const ctl = new ReplayController('s', [{ seq: 0, label: 'Login' }]);
  const adapter = {
    open: async () => { throw new Error('listen EINVAL bad.sock'); },
    goto: async () => {}, click: async () => {}, fill: async () => {},
    snapshot: async () => '', currentUrl: async () => '',
    screenshot: async () => null,
    close: async () => { throw new Error('no session'); },   // close ALSO throws (never opened)
  };
  const effects = [{ seq: 0, capturedAt: 1, fromUrl: 'https://x.com/', fromSnapshot: '',
    action: { role: 'button', name: 'Login', ref: 'e1' },
    toUrl: 'https://x.com/a', toSnapshot: '', navigated: true, diff: { added: [], removed: [] } }];
  const st = await runReplay(effects as never, ctl, {
    adapter, creds: { get: () => ({}), set: () => {} }, site: 'x.com', shotsDir: null,
    sleep: async () => {},
  });
  expect(st.done).toBe(true);
  expect(st.running).toBe(false);
  expect(st.error).toContain('EINVAL');
  expect(st.steps[0].status).toBe('skipped');   // never ran — honest terminal state
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/recorder/replay.test.ts`
Expected: FAIL — the promise rejects (unhandled `EINVAL`).

- [ ] **Step 3: Implement**

In `src/recorder/replay.ts`, `runReplay`: add a `catch` between the existing `try` body and `finally`, and guard the close. The `skipRest` helper already exists inside the function.

```ts
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
```

(The existing `finally` body is `st.done = true; st.running = false; await deps.adapter.close();` — the only change inside it is the `.catch(() => {})`.)

In `src/cli.ts` (dashboard `rec.replay`), make the launch belt-and-braces:

```ts
        void runReplay(effects, ctl, { adapter, creds, site, shotsDir: join(shotsRoot, id) })
          .catch(() => { /* engine already recorded state.error; never let this reject */ })
          .finally(() => { busy = null; });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/recorder/replay.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/recorder/replay.ts src/cli.ts tests/recorder/replay.test.ts
git commit -m "fix(replay): resolve with error state instead of rejecting — dashboard no longer dies"
```

---

### Task 3: Ledger storage in RecordStore

**Files:**
- Modify: `src/mapstore/schema.sql` (new table)
- Modify: `src/mapstore/record.ts` (types + 3 methods; `appendActionEffect` returns seq; delete/clear/rename cover the new table)
- Test: `tests/mapstore/record-ledger.test.ts` (new)

**Interfaces:**
- Produces (later tasks depend on these exact signatures):
  - `export interface LedgerEvent { t?: number; source: 'human' | 'agent'; kind: string; descriptor: Record<string, unknown> }`
  - `export interface StoredLedgerEvent extends LedgerEvent { seq: number; disposition: string | null }`
  - `RecordStore.appendEvent(sessionId: string, ev: LedgerEvent): number | null` — null when session inactive (isActive-gated, same rule as steps)
  - `RecordStore.stampEvent(sessionId: string, seq: number, disposition: string): void`
  - `RecordStore.events(sessionId: string): StoredLedgerEvent[]` — ordered by seq
  - `RecordStore.appendActionEffect(...): number | null` — WAS void; now returns the step seq (null when inactive)

- [ ] **Step 1: Write the failing tests**

Create `tests/mapstore/record-ledger.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { RecordStore } from '../../src/mapstore/record.js';

function store(): RecordStore {
  return RecordStore.fromDatabase(new Database(':memory:'));
}
const FX = { fromUrl: 'u', fromSnapshot: 's', action: null, toUrl: 'u2', toSnapshot: 's2',
  navigated: true, diff: { added: [], removed: [] } };

describe('RecordStore ledger (record_events)', () => {
  it('appends, stamps, and reads back events in order', () => {
    const s = store();
    s.start('sess');
    const a = s.appendEvent('sess', { t: 111, source: 'human', kind: 'click', descriptor: { leafText: 'Login' } });
    const b = s.appendEvent('sess', { source: 'agent', kind: 'navigate', descriptor: { url: 'https://x.com' } });
    expect(a).toBe(0);
    expect(b).toBe(1);
    s.stampEvent('sess', a!, 'step:0');
    s.stampEvent('sess', b!, 'dropped:failed:timeout');
    const evs = s.events('sess');
    expect(evs).toHaveLength(2);
    expect(evs[0]).toMatchObject({ seq: 0, t: 111, source: 'human', kind: 'click', disposition: 'step:0' });
    expect(evs[0].descriptor).toEqual({ leafText: 'Login' });
    expect(evs[1].disposition).toBe('dropped:failed:timeout');
  });
  it('appendEvent is a no-op returning null when the session is inactive', () => {
    const s = store();
    s.start('sess'); s.stop('sess');
    expect(s.appendEvent('sess', { source: 'human', kind: 'click', descriptor: {} })).toBeNull();
    expect(s.events('sess')).toHaveLength(0);
  });
  it('appendActionEffect returns the step seq (and null when inactive)', () => {
    const s = store();
    s.start('sess');
    expect(s.appendActionEffect('sess', FX)).toBe(0);
    expect(s.appendActionEffect('sess', FX)).toBe(1);
    s.stop('sess');
    expect(s.appendActionEffect('sess', FX)).toBeNull();
  });
  it('delete/clear/rename cover record_events', () => {
    const s = store();
    s.start('a');
    s.appendEvent('a', { source: 'human', kind: 'click', descriptor: {} });
    expect(s.renameSession('a', 'b')).toBe(true);
    expect(s.events('b')).toHaveLength(1);
    expect(s.events('a')).toHaveLength(0);
    s.deleteSession('b');
    expect(s.events('b')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/mapstore/record-ledger.test.ts`
Expected: FAIL — `appendEvent` does not exist.

- [ ] **Step 3: Implement**

Append to `src/mapstore/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS record_events (
  session_id TEXT NOT NULL, seq INTEGER NOT NULL,
  t INTEGER, source TEXT NOT NULL, kind TEXT NOT NULL,
  descriptor TEXT NOT NULL, disposition TEXT,
  PRIMARY KEY (session_id, seq)
);
```

(No ALTER migration needed — the constructor `exec(SCHEMA)` creates it on every open.)

In `src/mapstore/record.ts`, add types after `StoredActionEffect`:

```ts
// The raw-event LEDGER: every captured event, appended at the earliest capture point
// (before assembly can lose it), later stamped with its fate. Descriptors only —
// role/label/href/non-secret value — never CSS selectors (spec 2026-07-16). Secrets
// are excluded at the SOURCE (the in-page listener / no agent text), so this table
// can never contain them.
export interface LedgerEvent {
  t?: number; source: 'human' | 'agent'; kind: string;
  descriptor: Record<string, unknown>;
}
export interface StoredLedgerEvent extends LedgerEvent { seq: number; disposition: string | null }
```

Add the methods (beside `appendActionEffect`):

```ts
  /** Append one raw event to the session's ledger. isActive-gated like steps:
   *  recording off = off, for BOTH capture paths. Returns the ledger seq (for the
   *  later disposition stamp) or null when not recording. */
  appendEvent(sessionId: string, ev: LedgerEvent): number | null {
    if (!this.isActive(sessionId)) return null;
    const seq: any = this.db.prepare(
      'SELECT COUNT(*) AS c FROM record_events WHERE session_id=?').get(sessionId);
    this.db.prepare(
      'INSERT INTO record_events (session_id,seq,t,source,kind,descriptor) VALUES (?,?,?,?,?,?)')
      .run(sessionId, seq.c, ev.t ?? null, ev.source, ev.kind, JSON.stringify(ev.descriptor));
    return seq.c as number;
  }
  /** Stamp an event's fate: 'step:<stepSeq>' or 'dropped:<reason>'. */
  stampEvent(sessionId: string, seq: number, disposition: string): void {
    this.db.prepare('UPDATE record_events SET disposition=? WHERE session_id=? AND seq=?')
      .run(disposition, sessionId, seq);
  }
  events(sessionId: string): StoredLedgerEvent[] {
    const rows: any[] = this.db.prepare(
      'SELECT * FROM record_events WHERE session_id=? ORDER BY seq').all(sessionId);
    return rows.map((r) => ({ seq: r.seq, t: r.t ?? undefined, source: r.source, kind: r.kind,
      descriptor: JSON.parse(r.descriptor), disposition: r.disposition ?? null }));
  }
```

Change `appendActionEffect`'s signature and return (body otherwise unchanged):

```ts
  appendActionEffect(sessionId: string, fx: ActionEffect, nowMs = Date.now()): number | null {
    if (!this.isActive(sessionId)) return null;
    const seq: any = this.db.prepare(
      'SELECT COUNT(*) AS c FROM record_observations WHERE session_id=?').get(sessionId);
    // ... existing INSERT unchanged ...
    return seq.c as number;
  }
```

Extend housekeeping:
- `clearSession`: add `this.db.prepare('DELETE FROM record_events WHERE session_id=?').run(sessionId);`
- `renameSession` transaction: add `this.db.prepare('UPDATE record_events SET session_id=? WHERE session_id=?').run(to, from);`
(`deleteSession` calls `clearSession`, so it's covered.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/mapstore/`
Expected: PASS — including the pre-existing record tests (the return-type change is additive; callers ignoring the return still compile).

- [ ] **Step 5: Commit**

```bash
git add src/mapstore/schema.sql src/mapstore/record.ts tests/mapstore/record-ledger.test.ts
git commit -m "feat(record): raw-event ledger table + appendEvent/stampEvent/events"
```

---

### Task 4: Human-path ledger writes + pointer glide

**Files:**
- Modify: `src/recorder/live-record.ts` (append at drain, stamp at each outcome; `Pending` carries `ledgerSeq`; store dep type)
- Modify: `src/recorder/live.ts` (pointer-dot transition 50ms → 200ms)
- Test: `tests/recorder/live-record.test.ts`, `tests/recorder/live.test.ts`

**Interfaces:**
- Consumes: `appendEvent` / `stampEvent` / `appendActionEffect → number | null` (Task 3).
- Produces: every drained non-toggle `LiveEvent` while recording is ON becomes exactly one ledger row (`source:'human'`, `kind: ev.kind`, `descriptor: the LiveEvent`, `t: ev.t`), later stamped `step:<seq>` or `dropped:no-from-page` / `dropped:unresolved-same-page`.

- [ ] **Step 1: Write the failing test**

Add to `tests/recorder/live-record.test.ts`, following the file's existing scripted-fake-adapter pattern (reuse its fake-store helper; extend the fake store with:
`appendEvent: (s, ev) => { ledger.push({ ...ev, seq: ledger.length, disposition: null }); return ledger.length - 1; }` and
`stampEvent: (s, seq, d) => { ledger[seq].disposition = d; }`). The scenario: one resolvable click that navigates (becomes a step) and one unresolvable same-page click (dropped) — the file already has fixtures for both shapes; copy the nearest existing scenario's adapter script.

```ts
it('ledgers every drained event and stamps its fate', async () => {
  // arrange: reuse the existing two-event scripted scenario (resolved nav click +
  // unresolved same-page click with no visible change)
  // ... existing-style deps setup with the extended fake store ...
  await runLiveRecord(deps);
  expect(ledger).toHaveLength(2);
  expect(ledger[0].source).toBe('human');
  expect(ledger[0].kind).toBe('click');
  expect(ledger[0].descriptor.leafText).toBeDefined();        // the LiveEvent IS the descriptor
  expect(ledger[0].disposition).toMatch(/^step:\d+$/);
  expect(ledger[1].disposition).toBe('dropped:unresolved-same-page');
});

it('does not ledger events drained while recording is off (armed)', async () => {
  // armed:true, store inactive — the loop drops data events; ledger must stay empty
  // ... existing armed-scenario setup ...
  await runLiveRecord(deps);
  expect(ledger).toHaveLength(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/recorder/live-record.test.ts`
Expected: FAIL — `appendEvent` never called / type error on the store dep.

- [ ] **Step 3: Implement in `live-record.ts`**

Extend the store dep type (line 23-24):

```ts
  store: { isActive(s: string): boolean; appendActionEffect(s: string, fx: ActionEffect, nowMs?: number): number | null;
    appendEvent(s: string, ev: { t?: number; source: 'human' | 'agent'; kind: string; descriptor: Record<string, unknown> }): number | null;
    stampEvent(s: string, seq: number, disposition: string): void;
    start(s: string): unknown; stop(s: string): void };
```

`Pending` gains the ledger handle:

```ts
interface Pending { ev: LiveEvent; drainIdx: number; waits: number; ledgerSeq: number | null }
```

At the enqueue point (the `for (const ev of data) pending.push(...)` line — it runs AFTER the `if (!deps.store.isActive(...)) data = []` armed-gate, so only recorded events are ledgered):

```ts
      for (const ev of data) pending.push({
        ev, drainIdx: ticks.length, waits: 0,
        // ledger the raw event NOW — before pairing can lose it (spec 2026-07-16)
        ledgerSeq: deps.store.appendEvent(deps.sessionId, {
          t: ev.t, source: 'human', kind: ev.kind, descriptor: ev as unknown as Record<string, unknown> }),
      });
```

Stamp at the three outcome sites in the pairing loop:

```ts
        if (fromIdx === -1) {
          if (p.ledgerSeq != null) deps.store.stampEvent(deps.sessionId, p.ledgerSeq, 'dropped:no-from-page');
          deps.log(`skip: no from-page for seq ${p.ev.seq}`); continue;
        }
```

```ts
        if (fx) {
          // stamp the step with when the human ACTED, not when this slow loop got to it
          const stepSeq = deps.store.appendActionEffect(deps.sessionId, fx, p.ev.t);
          if (p.ledgerSeq != null && stepSeq != null) deps.store.stampEvent(deps.sessionId, p.ledgerSeq, 'step:' + stepSeq);
          appended++;
          // ... existing onEvent/log lines unchanged ...
        }
        else {
          if (p.ledgerSeq != null) deps.store.stampEvent(deps.sessionId, p.ledgerSeq, 'dropped:unresolved-same-page');
          deps.log(`skip: unresolved same-page click seq ${p.ev.seq}`);
        }
```

- [ ] **Step 4: Pointer glide (one value, `live.ts`)**

In `INSTALLER_JS`'s pointer element style (the `__webnav_ptr` cssText), change
`transition:left .05s linear,top .05s linear` → `transition:left .2s ease-out,top .2s ease-out`
(playwright teleports the mouse; 200ms reads as a visible glide in session videos).

Pin it in `tests/recorder/live.test.ts`:

```ts
it('pointer dot glides (200ms transition) so teleporting agent mouse reads in video', () => {
  expect(INSTALLER_JS).toContain('left .2s ease-out');
});
```

- [ ] **Step 5: Run the recorder suite**

Run: `npx vitest run tests/recorder/`
Expected: PASS. Pre-existing live-record tests use fake stores — add the two new methods to those fakes where TypeScript complains (no-op `appendEvent: () => null, stampEvent: () => {}` is fine for tests not asserting the ledger).

- [ ] **Step 6: Commit**

```bash
git add src/recorder/live-record.ts src/recorder/live.ts tests/recorder/live-record.test.ts tests/recorder/live.test.ts
git commit -m "feat(recorder): ledger every drained human event with its fate; pointer glide"
```

---

### Task 5: Agent-path ledger writes

Agent steps append effects in FOUR places; the two shared ones live in `browse.ts` (so one edit covers agent sessions AND one-shot `use` verbs):
1. `runActionRecorded` (`browse.ts:182`) — click/type from agent-session AND `use click`/`use type`.
2. `recordNavigateEffect` (`browse.ts:110`) — one-shot `use navigate`.
3. agent-session `navigate` branch (`agent-session.ts:123-141`) — appends directly.
4. agent-session `hover` branch (`agent-session.ts:167-190`) — appends directly.

**Files:**
- Modify: `src/router/browse.ts` (ledger in `runActionRecorded` + `recordNavigateEffect`)
- Modify: `src/recorder/agent-session.ts` (ledger in `navigate` + `hover` branches; store dep type)
- Test: `tests/recorder/agent-session.test.ts`, `tests/router/` (wherever `runActionRecorded` is covered — find with `grep -rln runActionRecorded tests/`)

**Interfaces:**
- Consumes: `appendEvent`/`stampEvent`/`appendActionEffect → number | null` (Task 3).
- Produces: agent ledger descriptors (exact shapes — Task 7's replay and Task 9's UI read these):
  - navigate: `{ cmd: 'navigate', url: <target>, fromUrl: <page before> }`
  - click: `{ cmd: 'click', ref, role, name, url: <page url> }`
  - type: `{ cmd: 'type', ref, role, name, url: <page url> }` — **NO text field, ever** (no secret oracle on this path; ledger replay falls back to creds/ask)
  - hover: `{ cmd: 'hover', ref, role, name, url: <page url> }`
  - `ActionRecordedResult` gains `stepSeq?: number | null`.

- [ ] **Step 1: Write the failing tests**

In `tests/recorder/agent-session.test.ts` (extend the file's existing fake store the same way as Task 4's; script stdin with the file's existing command-line helper):

```ts
it('ledgers each action command with its fate; snapshot/eval add nothing; type stores no text', async () => {
  // script: navigate → click e1 → type e2 "hunter2" → snapshot → quit
  // fake adapter: navigate + click succeed & record; type's fill succeeds & records
  await runAgentSession(deps);
  expect(ledger.map(l => l.kind)).toEqual(['navigate', 'click', 'type']);   // no snapshot/eval rows
  expect(ledger[0].source).toBe('agent');
  expect(ledger[0].descriptor.url).toBe('https://x.com/target');
  for (const l of ledger) expect(l.disposition).toMatch(/^step:\d+$/);
  expect(JSON.stringify(ledger[2].descriptor)).not.toContain('hunter2');    // typed text NEVER ledgered
});

it('stamps dropped:failed when the action errors', async () => {
  // fake adapter whose act() throws for the click command
  await runAgentSession(deps);
  const click = ledger.find(l => l.kind === 'click');
  expect(click.disposition).toMatch(/^dropped:failed:/);
});
```

In the `runActionRecorded` test file (find it: `grep -rln runActionRecorded tests/`):

```ts
it('ledgers the action beside the step and returns stepSeq', async () => {
  const s = RecordStore.fromDatabase(new Database(':memory:'));
  s.start('sess');
  const r = await runActionRecorded({ sessionId: 'sess', recordStore: s,
    fromUrl: 'https://x.com/', fromSnapshot: '- button "Go" [ref=e1]',
    action: { role: 'button', name: 'Go', ref: 'e1' }, adapter: fakeAdapter });
  expect(r.stepSeq).toBe(0);
  const evs = s.events('sess');
  expect(evs).toHaveLength(1);
  expect(evs[0]).toMatchObject({ source: 'agent', kind: 'click', disposition: 'step:0' });
  expect(evs[0].descriptor).toMatchObject({ cmd: 'click', ref: 'e1', role: 'button', name: 'Go' });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/recorder/agent-session.test.ts` (and the browse/router test file)
Expected: FAIL.

- [ ] **Step 3: Implement in `browse.ts`**

`runActionRecorded` — ledger first, stamp at both exits:

```ts
export async function runActionRecorded(args: RunActionArgs): Promise<ActionRecordedResult> {
  const adapter = args.adapter ?? newAdapter();
  // Ledger the intent BEFORE acting (spec 2026-07-16): a failed action must still be
  // on the record. NO typed text in the descriptor — this path has no secret oracle.
  const led = args.recordStore.appendEvent(args.sessionId, {
    source: 'agent', kind: args.text != null ? 'type' : 'click',
    descriptor: { cmd: args.text != null ? 'type' : 'click', ref: args.action.ref,
      role: args.action.role, name: args.action.name, url: args.fromUrl },
  });
  try {
    // ... existing body unchanged until the recording block ...
    let recorded = false;
    let stepSeq: number | null = null;
    if (args.recordStore.isActive(args.sessionId)) {
      stepSeq = args.recordStore.appendActionEffect(args.sessionId, { /* existing fields unchanged */ });
      recorded = stepSeq != null;
    }
    if (led != null) args.recordStore.stampEvent(args.sessionId, led,
      stepSeq != null ? 'step:' + stepSeq : 'dropped:not-recorded');
    return { status: 'done', recorded, navigated, stepSeq };
  } catch (e) {
    if (led != null) args.recordStore.stampEvent(args.sessionId, led,
      'dropped:failed:' + String((e as Error).message ?? e).slice(0, 120));
    return { status: 'failed', recorded: false, reason: String(e) };
  }
}
```

`ActionRecordedResult` gains `stepSeq?: number | null;`.

`recordNavigateEffect` — same pattern (append `{ cmd: 'navigate', url, fromUrl: url }` before the settle, stamp `step:<seq>` after; it has no failure branch of its own — the caller's try owns errors, and an un-stamped row honestly reads as `dropped:unprocessed` in coverage).

- [ ] **Step 4: Implement in `agent-session.ts`**

Store dep type (line 81-84) gains:

```ts
  store: {
    isActive(s: string): boolean;
    appendActionEffect(s: string, fx: ActionEffect): number | null;
    appendEvent(s: string, ev: { t?: number; source: 'human' | 'agent'; kind: string; descriptor: Record<string, unknown> }): number | null;
    stampEvent(s: string, seq: number, disposition: string): void;
  };
```

`navigate` branch — ledger before `goto`, stamp beside the existing append; on the branch's failure the outer per-command `catch` fires, so track the pending row:

```ts
        let pendingLedger: number | null = null;   // declared at the top of the command try, reset per command
```

```ts
        if (c.cmd === 'navigate') {
          if (!c.url) { out({ ok: false, error: 'navigate needs url' }); continue; }
          const fromUrl = await deps.adapter.currentUrl().catch(() => '');
          pendingLedger = deps.store.appendEvent(deps.sessionId, {
            source: 'agent', kind: 'navigate', descriptor: { cmd: 'navigate', url: c.url, fromUrl } });
          // ... existing goto/settle unchanged ...
          if (deps.store.isActive(deps.sessionId)) {
            const stepSeq = deps.store.appendActionEffect(deps.sessionId, { /* existing fields */ });
            if (pendingLedger != null && stepSeq != null) deps.store.stampEvent(deps.sessionId, pendingLedger, 'step:' + stepSeq);
            pendingLedger = null;
            steps++; deps.notify('step', 'agent nav: ' + toUrl);
          }
          out({ ok: true, url: toUrl });
        }
```

`hover` branch — same shape (`descriptor: { cmd: 'hover', ref: c.ref, role: action.role, name: action.name, url: fromUrl }`, appended after `recover`, stamped beside its `appendActionEffect`).

`click`/`type` branch — NO ledger call here (Task 5 Step 3 put it inside `runActionRecorded`, which this branch calls).

The outer per-command `catch` stamps the orphan:

```ts
      } catch (e) {
        if (pendingLedger != null) { deps.store.stampEvent(deps.sessionId, pendingLedger,
          'dropped:failed:' + String((e as Error).message ?? e).slice(0, 120)); pendingLedger = null; }
        out({ ok: false, error: String((e as Error).message ?? e) });
      }
```

- [ ] **Step 5: Run the suites**

Run: `npx vitest run tests/recorder/ tests/router/`
Expected: PASS. Pre-existing fakes gain the two no-op methods where TS complains.

- [ ] **Step 6: Commit**

```bash
git add src/router/browse.ts src/recorder/agent-session.ts tests/
git commit -m "feat(recorder): ledger agent actions (sessions + one-shot use verbs) with fates"
```

---

### Task 6: `coverage()` + `dev review` integration

**Files:**
- Create: `src/recorder/coverage.ts`
- Modify: `src/recorder/review.ts` (prompt gains known-drops section; `review.json` gains coverage)
- Modify: `src/cli.ts:689-723` (`dev review` verb: compute + thread + print)
- Test: `tests/recorder/coverage.test.ts` (new), `tests/recorder/review.test.ts`

**Interfaces:**
- Consumes: `RecordStore.events()` (Task 3).
- Produces:
  - `export interface Coverage { total: number; captured: number; dropped: { seq: number; kind: string; label: string | null; reason: string }[] }`
  - `export function coverage(events: StoredLedgerEvent[]): Coverage`
  - `buildReviewPrompt(session, steps, logLines, frames, instructions?, structured?, knownDrops?: Coverage['dropped'])`
  - `ReviewDeps` gains `knownDrops?: Coverage['dropped']` and `coverage?: Coverage` (written into `review.json`).
  - `dev review` output JSON gains `coverage`.

- [ ] **Step 1: Write the failing tests**

Create `tests/recorder/coverage.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { coverage } from '../../src/recorder/coverage.js';

const ev = (seq: number, disposition: string | null, descriptor: Record<string, unknown> = {}) =>
  ({ seq, source: 'human' as const, kind: 'click', descriptor, disposition });

describe('coverage', () => {
  it('splits events into captured vs dropped with human-readable labels', () => {
    const c = coverage([
      ev(0, 'step:0', { leafText: 'Login' }),
      ev(1, 'dropped:unresolved-same-page', { ariaLabel: 'Chart type' }),
      ev(2, null, { name: 'q' }),                       // session ended mid-pair
    ]);
    expect(c.total).toBe(3);
    expect(c.captured).toBe(1);
    expect(c.dropped).toEqual([
      { seq: 1, kind: 'click', label: 'Chart type', reason: 'unresolved-same-page' },
      { seq: 2, kind: 'click', label: 'q', reason: 'unprocessed' },
    ]);
  });
  it('empty ledger → zero coverage, no drops', () => {
    expect(coverage([])).toEqual({ total: 0, captured: 0, dropped: [] });
  });
});
```

In `tests/recorder/review.test.ts` (the prompt builder is pure and already tested there):

```ts
it('prompt includes known assembly drops so the LLM hunts only sensor blindness', () => {
  const p = buildReviewPrompt('s', [], [], [], undefined, false,
    [{ seq: 1, kind: 'click', label: 'Chart type', reason: 'unresolved-same-page' }]);
  expect(p).toContain('ASSEMBLY DROPS (already known');
  expect(p).toContain('Chart type');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/recorder/coverage.test.ts tests/recorder/review.test.ts`
Expected: FAIL — module not found / arity.

- [ ] **Step 3: Implement**

Create `src/recorder/coverage.ts`:

```ts
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
    const label = (desc.ariaLabel ?? desc.leafText ?? desc.name ?? desc.placeholder ?? null) as string | null;
    dropped.push({ seq: e.seq, kind: e.kind, label, reason: d.replace(/^dropped:/, '') });
  }
  return { total: events.length, captured, dropped };
}
```

In `review.ts`:
- `buildReviewPrompt` gains the trailing param `knownDrops?: { seq: number; kind: string; label: string | null; reason: string }[]`; after the FRAMES block insert:

```ts
  const dropTxt = knownDrops?.length
    ? `\nASSEMBLY DROPS (already known — measured deterministically; do NOT re-report these as gaps):\n${
        knownDrops.map((d) => `- seq ${d.seq} ${d.kind}: ${d.label ?? '(unlabeled)'} — ${d.reason}`).join('\n')}\n`
    : '';
```
  and interpolate `${dropTxt}` between the frames block and the instructions.
- `ReviewDeps` gains `knownDrops?: ...` (same type) and `coverage?: Coverage` (import the type). `runSessionReview` passes `deps.knownDrops` into `buildReviewPrompt`, and when `deps.structured` writes `review.json`, include it: `JSON.stringify({ gaps, coverage: deps.coverage ?? null }, null, 2)`.

In `cli.ts` `dev review` (after `const fx = store.actionEffects(...)`):

```ts
    const { coverage } = await import('./recorder/coverage.js');
    const cov = coverage(store.events(args.session));
```
Thread `knownDrops: cov.dropped, coverage: cov` into the `runSessionReview` deps, and add `coverage: cov` to the final `console.log` JSON object.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/recorder/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/recorder/coverage.ts src/recorder/review.ts src/cli.ts tests/recorder/
git commit -m "feat(review): deterministic capture-coverage diff; known drops feed the audit"
```

---

### Task 7: `runLedgerReplay`

**Files:**
- Modify: `src/recorder/replay.ts` (new exported runner + small shared helpers)
- Test: `tests/recorder/replay.test.ts`

**Interfaces:**
- Consumes: `StoredLedgerEvent` (Task 3), descriptor shapes (Tasks 4-5), `resolveEvent`/`LiveEvent` from `./live.js`, `didNavigate`, `COMMIT_WORDS`, `ReplayController`.
- Produces: `export async function runLedgerReplay(events: StoredLedgerEvent[], ctl: ReplayController, deps: ReplayDeps): Promise<ReplayState>` — same never-reject contract as Task 2. `ReplayDeps.adapter` gains `hover(r: string): Promise<unknown>` (add to the interface; `PlaywrightAdapter` already has it — update existing test fakes with a no-op).
- Label rule for controller construction (Task 8 uses it): `descriptor.name ?? descriptor.ariaLabel ?? descriptor.leafText ?? descriptor.placeholder ?? kind`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/recorder/replay.test.ts` (follow the file's fake-adapter conventions):

```ts
const hev = (seq: number, ev: Record<string, unknown>) =>   // human ledger row
  ({ seq, source: 'human' as const, kind: String(ev.kind ?? 'click'), descriptor: ev, disposition: null });

describe('runLedgerReplay', () => {
  it('replays events in order and verifies landings from the NEXT event url', async () => {
    // event 0: click "Products" on /home (next event is on /list → landing must verify)
    // event 1: click "Item" on /list
    const events = [
      hev(0, { kind: 'click', url: 'https://x.com/home', tagName: 'a', leafText: 'Products', role: null }),
      hev(1, { kind: 'click', url: 'https://x.com/list', tagName: 'a', leafText: 'Item', role: null }),
    ];
    // fake adapter: snapshot returns a page holding the expected link; currentUrl
    // returns /list after the first click, /item after the second
    const st = await runLedgerReplay(events as never, new ReplayController('s', [
      { seq: 0, label: 'Products' }, { seq: 1, label: 'Item' }]), deps);
    expect(st.steps.map(s => s.status)).toEqual(['ok', 'ok']);
    expect(st.error).toBeUndefined();
  });

  it('pauses on an unresolvable descriptor (never guesses), Next retries once then fails', async () => {
    // snapshot never contains the element → status fail, note set, mode flipped to step
  });

  it('landing mismatch → fail + pause ("landed elsewhere")', async () => {
    // currentUrl stays /home after the click while next event is on /list
  });

  it('input event: recorded value replays; missing value asks via waitFor', async () => {
    // event: { kind:'input', url:'…', tagName:'input', nameAttr:'user', value:'standard_user' } → fill called with recorded value
    // second run: same event without value and empty creds → ctl.waitFor('value') path (supply() resumes)
  });

  it('agent rows: navigate → goto target; hover → adapter.hover; type asks (no text ledgered)', async () => {
    const events = [
      { seq: 0, source: 'agent', kind: 'navigate', descriptor: { cmd: 'navigate', url: 'https://x.com/a', fromUrl: '' }, disposition: null },
      { seq: 1, source: 'agent', kind: 'hover', descriptor: { cmd: 'hover', ref: 'e9', role: 'button', name: 'Menu', url: 'https://x.com/a' }, disposition: null },
    ];
    // goto called with /a and step 0 'jumped'; hover resolved by role+name and fired
  });

  it('commit-word click waits for confirm; declined → skipped', async () => {
    // event label "Place Order" → ctl.waitFor('confirm'); confirm(false) → status 'skipped'
  });
});
```

(Each `it` body follows the SAME structure as the file's existing `runReplay` tests — scripted adapter, `sleep: async () => {}`, drive `ctl.supply/confirm` from a queued microtask where a wait is expected. Write them out fully; the sketches above fix the behavior under test.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/recorder/replay.test.ts`
Expected: FAIL — `runLedgerReplay` not exported.

- [ ] **Step 3: Implement in `replay.ts`**

Add imports: `resolveEvent, descriptorName, type LiveEvent` from `./live.js`; `StoredLedgerEvent` from `../mapstore/record.js`.

Add `hover(r: string): Promise<unknown>;` to `ReplayDeps['adapter']`.

```ts
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
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/recorder/replay.test.ts`
Expected: PASS (existing `runReplay` fakes gain a no-op `hover`).

- [ ] **Step 5: Commit**

```bash
git add src/recorder/replay.ts tests/recorder/replay.test.ts
git commit -m "feat(replay): ledger replay — exact rerun of the raw event stream"
```

---

### Task 8: Replay mode + events API (server + cli wiring)

**Files:**
- Modify: `src/dashboard/server.ts` (RecordingsDeps: `replay(id, mode)`, new `events(id)`; POST body parse; GET events route)
- Modify: `src/cli.ts` (`rec.replay(id, mode)` picks the runner; `rec.events`)
- Test: `tests/dashboard/server.test.ts`

**Interfaces:**
- Consumes: `runLedgerReplay` (Task 7), `RecordStore.events` (Task 3), `coverage` (Task 6).
- Produces:
  - `RecordingsDeps.replay(id: string, mode?: 'steps' | 'ledger')`
  - `RecordingsDeps.events(id: string): { events: StoredLedgerEvent[]; coverage: Coverage }`
  - `POST /api/recordings/:id/replay` accepts optional JSON body `{ mode: 'steps' | 'ledger' }` (absent/empty body = steps)
  - `GET /api/recordings/:id/events` → `{ events, coverage }`

- [ ] **Step 1: Write the failing tests**

In `tests/dashboard/server.test.ts` (follow its existing fake-`rec` + request-helper pattern):

```ts
it('POST replay passes the mode through (default steps)', async () => {
  // fake rec.replay records (id, mode); POST without body → mode undefined→'steps';
  // POST body {"mode":"ledger"} → 'ledger'
});
it('GET /api/recordings/:id/events returns the ledger with coverage', async () => {
  // fake rec.events('s1') → { events: [...], coverage: { total: 2, captured: 1, dropped: [...] } }
  // assert 200 + round-trip JSON
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/dashboard/server.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement in `server.ts`**

`RecordingsDeps` (line ~33): `replay(id: string, mode?: 'steps' | 'ledger'): Promise<{ ok: true } | { ok: false; error: string }>;` and add `events(id: string): unknown;`.

Replay route (line ~304): parse the optional body

```ts
        if (replayM && method === 'POST') {
          let mode: 'steps' | 'ledger' = 'steps';
          try { const b = JSON.parse(await readBody()); if (b?.mode === 'ledger') mode = 'ledger'; } catch { /* empty body = steps */ }
          const result = await rec.replay(decodeURIComponent(replayM[1]), mode);
          return sendJson(result.ok ? 200 : 409, result);
        }
```

(Use the file's existing body-reading helper — the other POST routes show its name.)

Events route beside the steps route (line ~279):

```ts
        const evM = path.match(/^\/api\/recordings\/([^/]+)\/events$/);
        if (evM && method === 'GET') return sendJson(200, rec.events(decodeURIComponent(evM[1])));
```

- [ ] **Step 4: Implement in `cli.ts`** (dashboard `rec` object)

```ts
      events: (id: string) => {
        const evs = recordStore.events(id);
        // coverage import: add `coverage` to the module-scope dynamic imports the
        // dashboard command already does (same style as ReplayController's import)
        return { events: evs, coverage: coverage(evs) };
      },
      replay: async (id: string, mode: 'steps' | 'ledger' = 'steps') => {
        if (busy) return { ok: false as const, error: 'a driven browser is already open (' + busy + ')' };
        const site = /* unchanged derivation, but from the chosen source's first url */
        if (mode === 'ledger') {
          const events = recordStore.events(id);
          if (!events.length) return { ok: false as const, error: 'no ledger — recorded before the ledger existed; use steps replay' };
          const label = (e: (typeof events)[number]) => {
            const d = e.descriptor as Record<string, unknown>;
            return String(d.name ?? d.ariaLabel ?? d.leafText ?? d.placeholder ?? e.kind);
          };
          busy = 'replay:' + id;
          const ctl = new ReplayController(id, events.map((e) => ({ seq: e.seq, label: label(e) })));
          activeCtl = ctl;
          const adapter = new PlaywrightAdapter('replay-' + id, undefined, undefined, { headed: true });
          void runLedgerReplay(events, ctl, { adapter, creds, site, shotsDir: join(shotsRoot, id) })
            .catch(() => {}).finally(() => { busy = null; });
          return { ok: true as const };
        }
        // ... existing steps branch, unchanged apart from the Task 2 .catch ...
      },
```

(Import `runLedgerReplay` beside `runReplay`, and `coverage` beside them. `site` for ledger mode: derive from the first event's page url — same `new URL(...).host` try/catch as the steps branch.)

- [ ] **Step 5: Run suites**

Run: `npx vitest run tests/dashboard/ && npx tsc --noEmit`
Expected: PASS / clean.

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/server.ts src/cli.ts tests/dashboard/server.test.ts
git commit -m "feat(dashboard): replay mode API (steps|ledger) + session events endpoint"
```

---

### Task 9: Dashboard UI — Ledger tab + two-button replay

**Files:**
- Modify: `src/dashboard/shell.ts` (tab row line ~1167, boxes ~1170-1177, `setSubTab` ~1044, buttons ~1023-1029; new `loadLedger`)
- Test: `tests/dashboard/shell.test.ts`

REMINDER: `shell.ts` is a template literal — follow the surrounding escaping style exactly (client-side `\n` is written `\\n`, backticks via `BT`).

**Interfaces:**
- Consumes: `GET /api/recordings/:id/events`, `POST .../replay {mode}` (Task 8).

- [ ] **Step 1: Write the failing contract tests**

Append to `tests/dashboard/shell.test.ts`:

```ts
it('session detail has a Ledger sub-tab before Logs, and two replay modes', () => {
  const tabs = SHELL_HTML.indexOf('data-sub="ledger"');
  expect(tabs).toBeGreaterThan(-1);
  expect(tabs).toBeLessThan(SHELL_HTML.indexOf('data-sub="logs"'));   // placed BEFORE Logs
  expect(SHELL_HTML).toContain('/events');                            // ledger fetch
  expect(SHELL_HTML).toContain('Replay exact');                       // ledger-mode button
  expect(SHELL_HTML).toContain("mode: 'ledger'");
  expect(SHELL_HTML).toContain('recorded before the ledger existed'); // honest empty state
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/dashboard/shell.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement in `shell.ts`**

Tab row (line ~1167) — insert before logs:

```html
<button data-sub="ledger">Ledger</button>
```

Detail boxes (~1170-1177): create `const ledgerBox = el('<div style="display:none"></div>');`, add `ledgerBox` to `ctx` and to `detail.append(...)` in the same position (after review, before logs).

`setSubTab` (~1044-1055): add

```js
  ctx.ledgerBox.style.display = name === 'ledger' ? '' : 'none';
  if (name === 'ledger') loadLedger(ctx);
```

New loader (beside `loadSteps`, same conventions):

```js
// --- Ledger sub-tab: the RAW event record with each event's fate. This is the
// deterministic capture-coverage view (events → steps); drops are assembly losses.
async function loadLedger(ctx) {
  let d = null;
  try { d = await getJSON('/api/recordings/'+encodeURIComponent(ctx.r.sessionId)+'/events'); } catch { return; }
  ctx.ledgerBox.innerHTML = '';
  if (!d || !d.events || !d.events.length) {
    ctx.ledgerBox.append(el('<div class="muted" style="margin:8px 0">No ledger — this session was recorded before the ledger existed. Steps replay still works.</div>'));
    return;
  }
  const c = d.coverage;
  ctx.ledgerBox.append(el('<div style="margin:8px 0">'+c.total+' events → '+c.captured+' steps'
    + (c.dropped.length ? ' · <span style="color:var(--rec);font-weight:600">'+c.dropped.length+' dropped</span>' : ' · all captured')+'</div>'));
  const rows = d.events.map(e => {
    const desc = e.descriptor || {};
    const label = desc.name || desc.ariaLabel || desc.leafText || desc.placeholder || '';
    const fate = !e.disposition ? '<span class="muted">unprocessed</span>'
      : e.disposition.indexOf('step:') === 0 ? '<td-ok>step '+esc(e.disposition.slice(5))+'</td-ok>'
      : '<span style="color:var(--rec)">'+esc(e.disposition.replace('dropped:',''))+'</span>';
    const t = e.t ? new Date(e.t).toLocaleTimeString() : '';
    return '<tr><td class="muted">'+e.seq+'</td><td>'+t+'</td><td>'+esc(e.source)+'</td><td>'+esc(e.kind)+'</td><td>'+esc(String(label))+'</td><td>'+fate+'</td></tr>';
  }).join('');
  ctx.ledgerBox.append(el('<table><tr><th>#</th><th>time</th><th>src</th><th>kind</th><th>label</th><th>fate</th></tr>'+rows+'</table>'));
}
```

(`<td-ok>` above is a placeholder in this plan only — in the real code use the same styling idiom the Steps table uses for a positive state; copy `stepTable`'s conventions. Text must wrap, not crop — no `overflow:hidden`.)

Replay buttons (~1023-1029): replace the single `repB` with two, POSTing the mode; native `title` tooltips carry the one-line copy:

```js
  const repB = btn('▶ Replay');
  repB.title = 'Replays the cleaned-up route. Finds each element again even if the page changed. Best for repeatable automation.';
  const repXB = btn('▶ Replay exact');
  repXB.title = 'Replays exactly what was done, event by event, nothing skipped. Best for exact reruns and for checking the recording caught everything.';
  const startReplay = async (mode) => {
    const res = await fetch('/api/recordings/'+encodeURIComponent(r.sessionId)+'/replay',
      { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ mode: mode }) });
    if (!res.ok) { toast((await res.json()).error); return; }
    setSubTab(ctx, 'steps');
    pollReplay(ctx.stepsBox, r.sessionId);
  };
  repB.onclick = () => startReplay('steps');
  repXB.onclick = () => { startReplay('ledger'); };   // body literally contains mode: 'ledger'
  head.append(openB, recB, repB, repXB, anB, delB);
```

(Write the fetch body so the source literally contains `mode: 'ledger'` for the contract test — e.g. `body: JSON.stringify({ mode: 'ledger' })` inside `repXB.onclick` instead of the shared helper, if needed.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/dashboard/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/shell.ts tests/dashboard/shell.test.ts
git commit -m "feat(dashboard): Ledger sub-tab (events + fates) and two-mode replay buttons"
```

---

### Task 10: Full-suite + live end-to-end verification (headless)

The user's requirement: **thorough review; the UI must work perfectly.** Nothing in this task is optional.

**Files:** none created in-repo (scratch dir for the test db + artifacts).

- [ ] **Step 1: Full unit suite + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: everything green (~903 pre-existing + all new tests).

- [ ] **Step 2: Generate real ledger data end-to-end (headless agent session)**

From a SCRATCH directory (its own `webnav.db` — never the user's):

```bash
cd <scratchdir>
printf '%s\n' \
  '{"cmd":"navigate","url":"https://www.saucedemo.com/"}' \
  '{"cmd":"snapshot"}' \
  '{"cmd":"quit"}' \
  | webnav use session --session ledger-e2e --url https://www.saucedemo.com/ --headless
```

(Exact verb/flags: check `webnav use --help` — the agent-session command reads JSON-line commands on stdin; run it headless. Then click/type against real refs from the snapshot output in a second pass if refs are needed: read the snapshot result, pick the username/password/login refs, and drive `click`/`type` commands.)

Verify in the db:

```bash
node -e "const D=require('better-sqlite3');const db=new D('webnav.db');console.log(db.prepare('SELECT seq,source,kind,disposition FROM record_events').all())"
```

Expected: one row per action command, each stamped `step:N` (or an honest `dropped:` with a reason). No row may contain typed text: `SELECT descriptor FROM record_events` must not contain any password typed.

- [ ] **Step 3: Dashboard drive-through (headless, scratch port — do NOT touch a running :7777)**

```bash
webnav dev dashboard --port 7817 &   # from the scratch dir (its webnav.db)
```

Drive `http://127.0.0.1:7817` with playwright-cli HEADLESS and verify by snapshot/screenshot:
1. Sessions list shows `ledger-e2e`.
2. Open its detail → tab order is Steps · Session videos · Review · **Ledger** · Logs.
3. Ledger tab: summary line correct against Step 2's SQL counts; every event row shows time/src/kind/label/fate; labels WRAP (no clipping).
4. An OLD session (or a fresh empty one) shows the honest no-ledger message.
5. Both replay buttons present with title tooltips.
6. `GET /api/recordings/ledger-e2e/events` returns `{events, coverage}` matching the SQL.
7. **Both themes**: toggle light/dark (the `themebtn`), screenshot the Ledger tab in each; check the dropped-highlight and muted colors are legible in both.
8. Steps tab still renders (regression).

- [ ] **Step 4: Crash-fix verification (the exact live failure)**

Through the fixed path itself, with yesterday's exact failing name (21 chars):

```bash
npx tsx --eval "
import { PlaywrightAdapter, wireSessionName } from './src/playwright/adapter.js';
console.log(wireSessionName('replay-report-builder'));
const a = new PlaywrightAdapter('replay-report-builder', undefined, undefined, { headed: false });
await a.open('https://www.saucedemo.com/');
console.log('opened:', await a.currentUrl());
await a.close();
"
```

(Run from the repo root so the relative import resolves; `tsx` is already a repo dep — it powers `bin/webnav`.)

Expected: opens and closes cleanly (no EINVAL). Then the rejection guard: POST a replay for a session whose recording has an unreachable first URL (or temporarily rename `playwright-cli` on PATH within the scratch env) → dashboard responds, `GET /api/replay/status` shows `error`, **dashboard process still alive** (curl `/api/recordings` again).

- [ ] **Step 5: Ledger replay live (engine-level, headless)**

Drive `runLedgerReplay` directly against the recorded `ledger-e2e` events with a headless adapter (small `node --input-type=module -e` script mirroring `rec.replay`'s ledger branch but `{ headed: false }`): expect step statuses `ok`/`jumped` end-to-end on saucedemo, screenshots saved under the scratch shots dir.

- [ ] **Step 6: Reap + report**

```bash
webnav dev sessions reap
```

Write the verification evidence (commands run, observed output, screenshots) into the task report. The FINAL headed check — clicking each replay button and watching the browser — is the user's hands-on step; say so explicitly in the handoff (settled preference: user tests headed flows himself).

- [ ] **Step 7: Commit any fixes found, then final review**

Any defect found here gets fixed at its producing stage (fix-upstream rule) with a regression test, then re-verify from Step 1.

---

## Final review gate (after all tasks)

1. `npm test && npx tsc --noEmit` green.
2. Code review over the full branch diff (correctness + the settled rules: no downstream patches, no data values stored, no selector capture, secrets never in the ledger).
3. UI checklist over the dashboard changes: fonts/sizes match; wrap-don't-crop; native controls; both themes audited; no remount-on-keystroke (the Ledger tab has no inputs — confirm the buttons don't re-render `head` on poll).
4. The user's hands-on headed pass (both replay buttons on a real recording).
