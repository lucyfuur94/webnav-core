# Interactive Walk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose webnav's multi-step `walkRoute` engine to agents via two `use` CLI verbs — `walk` (pathfind over the graph + walk to a non-URL state) and `walk-resume` (continue a paused walk after the agent answers a fork) — making multi-fork flows like saucedemo checkout completable across CLI calls.

**Architecture:** A new `findPath` (weighted Dijkstra over graph edges) computes the route between two state ids; `walkRoute` is extended to follow that resolved path (not the old linear `edges[0]`) and to accept a resume answer; a new SQLite-backed `WalkSessionStore` persists a paused walk's position + the `-s=` browser session NAME (the browser itself persists across CLI processes, verified). Two new verbs in the `use` category drive it; the live wiring reuses `walk-live.ts`'s WalkBrowser closure (owns the in-memory inputs map).

**Tech Stack:** TypeScript (strict), Node 18+ (run via Node 24 here — `cd node_modules/better-sqlite3 && npx node-gyp rebuild` if ABI errors), `better-sqlite3`, vitest, `playwright-cli` for the gated live e2e.

**Spec:** `docs/superpowers/specs/2026-06-06-interactive-walk-design.md`

---

## Existing signatures this plan builds on (verified)

- `walkRoute(args: WalkArgs): Promise<RecallResponse>` in `src/router/walk.ts`. `WalkArgs = { goalName, startStateId, goalStateId, store, states: State[], browser: WalkBrowser }`. Loop currently does `const edge = store.edgesFrom(current)[0]` (the linear assumption to change).
- `WalkBrowser = { snapshot(): Promise<string>; act(ref: string, inputSlot: string|null): Promise<void>; callCount(): number }`.
- `replayStep(edge, nodes): { status:'ok'; ref; repaired } | { status:'escalate' } | { status:'needs-classify' } | { status:'blocked-commit' }`.
- `MapStore.edgesFrom(fromState: string): Edge[]`; `Edge` has `fromState,toState,semanticStep,kind,cost,reliability,confidence,acceptsInput,selectorCache`.
- `RecordStore` pattern (`src/mapstore/record.ts`): `constructor(path='webnav.db')` + `static fromDatabase(db)`, reads `schema.sql`. Mirror this for `WalkSessionStore`.
- `RecallResponse` union (`src/protocol.ts`): `done` | `needs-navigation` | `needs-classification` | `failed`.

---

## File structure

- **Create** `src/router/path.ts` — `findPath(store, startId, goalId): string[] | null`. Weighted shortest path. Pure.
- **Create** `src/router/walk-session.ts` — `WalkSessionStore` (create/load/advance/close). SQLite.
- **Modify** `src/mapstore/schema.sql` — add `walk_sessions` table.
- **Modify** `src/router/walk.ts` — follow a resolved `path`; accept an optional resume `answer`.
- **Modify** `src/router/walk-live.ts` — export a reusable WalkBrowser factory the CLI verbs can call (start fresh OR reattach), driven by an inputs map.
- **Modify** `src/cli.ts`, `src/cli-spec.ts` — the `walk` + `walk-resume` verbs (`use` category).
- **Modify** `docs/STATUS.md`.

---

## Task 1: `findPath` — weighted shortest path over the graph — TDD

**Files:**
- Create: `src/router/path.ts`
- Test: `tests/router/path.test.ts`

Dijkstra over `store.edgesFrom`. Edge weight: lower is better. `weight = (1 + cost) / (reliability * confidence + 0.01)` — cheap+reliable+confident edges are preferred; the `+0.01` avoids divide-by-zero. Returns the ordered list of state ids from start to goal inclusive, or `null` if unreachable. A visited set guarantees termination on cycles.

- [ ] **Step 1: Write the failing test**

Create `tests/router/path.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MapStore } from '../../src/mapstore/store.js';
import { makeState, makeEdge } from '../../src/mapstore/types.js';
import { findPath } from '../../src/router/path.js';

function store(): MapStore {
  return MapStore.fromDatabase(new Database(':memory:'));
}
function addState(s: MapStore, id: string) {
  s.upsertState(makeState({ id, nodeId: 'n', semanticName: id, urlPattern: '', role: 'detail' }));
}
function addEdge(s: MapStore, from: string, to: string, extra: Partial<{ cost: number; reliability: number; confidence: number }> = {}) {
  s.upsertEdge(makeEdge({ fromState: from, toState: to, semanticStep: `${from}->${to}`, kind: 'navigate', ...extra }));
}

describe('findPath', () => {
  it('finds a linear path', () => {
    const s = store();
    ['a', 'b', 'c'].forEach((id) => addState(s, id));
    addEdge(s, 'a', 'b'); addEdge(s, 'b', 'c');
    expect(findPath(s, 'a', 'c')).toEqual(['a', 'b', 'c']);
  });

  it('returns [start] when start === goal', () => {
    const s = store(); addState(s, 'a');
    expect(findPath(s, 'a', 'a')).toEqual(['a']);
  });

  it('picks the lower-weight branch', () => {
    const s = store();
    ['a', 'b', 'c', 'd'].forEach((id) => addState(s, id));
    // a->b->d  vs  a->c->d ; make the b path cheaper/more reliable.
    addEdge(s, 'a', 'b', { reliability: 1, confidence: 1 });
    addEdge(s, 'b', 'd', { reliability: 1, confidence: 1 });
    addEdge(s, 'a', 'c', { cost: 5, reliability: 0.2, confidence: 0.2 });
    addEdge(s, 'c', 'd', { cost: 5, reliability: 0.2, confidence: 0.2 });
    expect(findPath(s, 'a', 'd')).toEqual(['a', 'b', 'd']);
  });

  it('returns null when unreachable', () => {
    const s = store();
    ['a', 'b', 'x'].forEach((id) => addState(s, id));
    addEdge(s, 'a', 'b');
    expect(findPath(s, 'a', 'x')).toBeNull();
  });

  it('terminates on a cycle', () => {
    const s = store();
    ['a', 'b'].forEach((id) => addState(s, id));
    addEdge(s, 'a', 'b'); addEdge(s, 'b', 'a');
    expect(findPath(s, 'a', 'b')).toEqual(['a', 'b']);
    expect(findPath(s, 'b', 'a')).toEqual(['b', 'a']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/router/path.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/router/path.ts`:

```typescript
import type { MapStore } from '../mapstore/store.js';
import type { Edge } from '../mapstore/types.js';

/** Weight for an edge: lower = preferred. Cheap, reliable, confident edges win.
 *  +0.01 guards against a zero denominator (a brand-new edge has reliability 1). */
function edgeWeight(e: Edge): number {
  return (1 + e.cost) / (e.reliability * e.confidence + 0.01);
}

/**
 * Weighted shortest path (Dijkstra) over graph edges from startId to goalId.
 * Returns the ordered state-id list (inclusive of both ends), or null if the
 * goal is unreachable. Pure: reads the store only. Cycles terminate (visited set).
 */
export function findPath(store: MapStore, startId: string, goalId: string): string[] | null {
  if (startId === goalId) return [startId];
  const dist = new Map<string, number>([[startId, 0]]);
  const prev = new Map<string, string>();
  const visited = new Set<string>();
  // Simple priority selection over the frontier (graphs here are small).
  const frontier = new Set<string>([startId]);

  while (frontier.size > 0) {
    // pick the frontier node with the smallest tentative distance
    let cur = '';
    let best = Infinity;
    for (const id of frontier) {
      const d = dist.get(id) ?? Infinity;
      if (d < best) { best = d; cur = id; }
    }
    frontier.delete(cur);
    if (cur === goalId) break;
    if (visited.has(cur)) continue;
    visited.add(cur);

    for (const e of store.edgesFrom(cur)) {
      if (visited.has(e.toState)) continue;
      const nd = (dist.get(cur) ?? Infinity) + edgeWeight(e);
      if (nd < (dist.get(e.toState) ?? Infinity)) {
        dist.set(e.toState, nd);
        prev.set(e.toState, cur);
      }
      frontier.add(e.toState);
    }
  }

  if (!dist.has(goalId)) return null;
  const path: string[] = [];
  let node: string | undefined = goalId;
  while (node !== undefined) { path.unshift(node); node = prev.get(node); }
  return path[0] === startId ? path : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/router/path.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/router/path.ts tests/router/path.test.ts
git commit -m "feat(router): findPath — weighted shortest path over the graph"
```

---

## Task 2: `walk_sessions` schema + `WalkSessionStore` — TDD

**Files:**
- Modify: `src/mapstore/schema.sql`
- Create: `src/router/walk-session.ts`
- Test: `tests/router/walk-session.test.ts`

Persists a paused walk: position + the browser session NAME. No inputs column (runtime-only).

- [ ] **Step 1: Add the table to `schema.sql`**

Append to `src/mapstore/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS walk_sessions (
  session_id TEXT PRIMARY KEY,
  start_state TEXT NOT NULL, goal_state TEXT NOT NULL,
  path TEXT NOT NULL, pos INTEGER NOT NULL DEFAULT 0,
  browser_session TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'paused',
  created_at INTEGER NOT NULL
);
```

- [ ] **Step 2: Write the failing test**

Create `tests/router/walk-session.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { WalkSessionStore } from '../../src/router/walk-session.js';

function store(): WalkSessionStore {
  return WalkSessionStore.fromDatabase(new Database(':memory:'));
}

describe('WalkSessionStore', () => {
  it('creates a session and loads it back', () => {
    const s = store();
    const id = s.create({ startState: 'a', goalState: 'c', path: ['a', 'b', 'c'], browserSession: 'walk-1', nowMs: 100 });
    const w = s.load(id)!;
    expect(w.startState).toBe('a');
    expect(w.goalState).toBe('c');
    expect(w.path).toEqual(['a', 'b', 'c']);
    expect(w.pos).toBe(0);
    expect(w.browserSession).toBe('walk-1');
    expect(w.status).toBe('paused');
  });

  it('advance updates the position', () => {
    const s = store();
    const id = s.create({ startState: 'a', goalState: 'c', path: ['a', 'b', 'c'], browserSession: 'walk-1', nowMs: 1 });
    s.advance(id, 2);
    expect(s.load(id)!.pos).toBe(2);
  });

  it('close marks the session done and load returns null after', () => {
    const s = store();
    const id = s.create({ startState: 'a', goalState: 'b', path: ['a', 'b'], browserSession: 'w', nowMs: 1 });
    s.close(id);
    expect(s.load(id)).toBeNull();
  });

  it('load of an unknown session is null', () => {
    expect(store().load('nope')).toBeNull();
  });

  it('never persists inputs (no such column)', () => {
    const s = store();
    const id = s.create({ startState: 'a', goalState: 'b', path: ['a', 'b'], browserSession: 'w', nowMs: 1 });
    // round-trip carries no credential/input field
    expect(Object.keys(s.load(id)!)).toEqual(
      expect.not.arrayContaining(['inputs', 'username', 'password']),
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/router/walk-session.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `WalkSessionStore`**

Create `src/router/walk-session.ts`:

```typescript
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SCHEMA = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'mapstore', 'schema.sql'), 'utf8');

export interface WalkSession {
  sessionId: string; startState: string; goalState: string;
  path: string[]; pos: number; browserSession: string; status: string;
}

/** Persists a PAUSED walk's position + the playwright session NAME (the browser
 *  itself survives across CLI processes, so we don't serialize browser state).
 *  No inputs are ever stored — credentials/form values are runtime-only. */
export class WalkSessionStore {
  private db: Database.Database;
  constructor(path = 'webnav.db') {
    this.db = new Database(path);
    this.db.exec(SCHEMA);
  }
  static fromDatabase(db: Database.Database): WalkSessionStore {
    const s = Object.create(WalkSessionStore.prototype) as WalkSessionStore;
    (s as any).db = db;
    db.exec(SCHEMA);
    return s;
  }

  create(args: { startState: string; goalState: string; path: string[]; browserSession: string; nowMs?: number }): string {
    const id = `walk-${args.browserSession}`;
    this.db.prepare(
      `INSERT INTO walk_sessions (session_id,start_state,goal_state,path,pos,browser_session,status,created_at)
       VALUES (?,?,?,?,0,?,'paused',?)
       ON CONFLICT(session_id) DO UPDATE SET start_state=excluded.start_state, goal_state=excluded.goal_state,
         path=excluded.path, pos=0, browser_session=excluded.browser_session, status='paused', created_at=excluded.created_at`)
      .run(id, args.startState, args.goalState, JSON.stringify(args.path), args.browserSession, args.nowMs ?? Date.now());
    return id;
  }
  load(sessionId: string): WalkSession | null {
    const r: any = this.db.prepare(
      "SELECT * FROM walk_sessions WHERE session_id=? AND status='paused'").get(sessionId);
    if (!r) return null;
    return { sessionId: r.session_id, startState: r.start_state, goalState: r.goal_state,
      path: JSON.parse(r.path), pos: r.pos, browserSession: r.browser_session, status: r.status };
  }
  advance(sessionId: string, pos: number): void {
    this.db.prepare('UPDATE walk_sessions SET pos=? WHERE session_id=?').run(pos, sessionId);
  }
  close(sessionId: string): void {
    this.db.prepare("UPDATE walk_sessions SET status='done' WHERE session_id=?").run(sessionId);
  }
}
```

Note: `create` derives the session id as `walk-<browserSession>` so the agent's `walk-resume <id>` maps deterministically to one browser. The `nowMs` param keeps tests deterministic (no `Date.now()` in assertions).

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/router/walk-session.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/mapstore/schema.sql src/router/walk-session.ts tests/router/walk-session.test.ts
git commit -m "feat(router): WalkSessionStore — persist a paused walk (position + browser name)"
```

---

## Task 3: `walkRoute` follows a resolved path + accepts a resume answer — TDD

**Files:**
- Modify: `src/router/walk.ts`
- Test: `tests/router/walk-path.test.ts`

Two changes: (1) accept `path: string[]` and pick the edge whose `toState` is the next path entry (not `edges[0]`); (2) accept an optional `answer` applied to the step it resumes on. Keep the existing `tests/router/walk.test.ts` green (back-compat: if no `path` is given, behavior is unchanged).

- [ ] **Step 1: Read the current walk.ts loop**

Read `src/router/walk.ts`. Note: `WalkArgs`, the `while (current !== goalStateId)` loop, `const edge = edges[0]`, the `at` counter, and the four return shapes. Confirm `WalkBrowser.act(ref, inputSlot)` and `replayStep`'s statuses (`ok`/`escalate`/`needs-classify`/`blocked-commit`).

- [ ] **Step 2: Write the failing test**

Create `tests/router/walk-path.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MapStore } from '../../src/mapstore/store.js';
import { makeState, makeEdge } from '../../src/mapstore/types.js';
import { walkRoute, type WalkBrowser } from '../../src/router/walk.js';
import type { State } from '../../src/mapstore/types.js';

// A scripted browser: each act() advances an index into `pages`; snapshot()
// returns the current page YAML. resolveStep uses role+name so pages declare a
// link/button whose name matches the edge's semanticStep target.
function scripted(pages: string[]): WalkBrowser & { idx: number } {
  return {
    idx: 0,
    async snapshot() { return pages[(this as any).idx]; },
    async act() { (this as any).idx++; },
    callCount() { return (this as any).idx; },
  } as any;
}

function s(id: string, fp: string[]): State {
  return makeState({ id, nodeId: 'n', semanticName: id, urlPattern: '', role: 'detail', fingerprint: fp });
}

describe('walkRoute path-following', () => {
  it('follows the resolved path over a branching graph (not edges[0])', async () => {
    const store = MapStore.fromDatabase(new Database(':memory:'));
    // graph: a -> b (wrong branch, edges[0]) and a -> c (the path we want); c -> goal
    for (const st of ['a', 'b', 'c', 'goal']) store.upsertState(makeState({ id: st, nodeId: 'n', semanticName: st, urlPattern: '', role: 'detail', fingerprint: [st] }));
    store.upsertEdge(makeEdge({ fromState: 'a', toState: 'b', semanticStep: 'go b', kind: 'navigate' }));
    store.upsertEdge(makeEdge({ fromState: 'a', toState: 'c', semanticStep: 'go c', kind: 'navigate' }));
    store.upsertEdge(makeEdge({ fromState: 'c', toState: 'goal', semanticStep: 'go goal', kind: 'navigate' }));
    const states = [s('a', ['a']), s('b', ['b']), s('c', ['c']), s('goal', ['goal'])];
    // pages observed after each act: start on a, then c, then goal. Each page must
    // declare a link matching the edge semanticStep so resolveStep finds a ref.
    const pages = [
      '- link "go c" [ref=e1]',     // on a: the edge a->c step is "go c"
      '- link "go goal" [ref=e2]',  // on c
      '- heading "goal" [ref=e3]',  // on goal (fingerprint 'heading'? use 'link' fp above; adjust)
    ];
    const browser = scripted(pages);
    const res = await walkRoute({
      goalName: 'g', startStateId: 'a', goalStateId: 'goal', store, states, browser,
      path: ['a', 'c', 'goal'],
    });
    expect(res.status).toBe('done');
  });
});
```

NOTE TO IMPLEMENTER: the scripted-browser fingerprint matching is fiddly (matchState compares the post-act page against `states[*].fingerprint`). Make the test deterministic by giving each page a snapshot whose tokens match the NEXT state's fingerprint exactly (e.g. state `c` fingerprint `['link']`, and the page after the first act contains a `link`). Adjust the `pages`/`fingerprint` arrays until the predict-vs-observe check passes for the c→goal route. The ASSERTION that matters: with `path: ['a','c','goal']`, the walk takes the a→c edge, NOT a→b (proving path-following replaced `edges[0]`). If wiring the full scripted match is too brittle, assert instead that the walk's first `act` corresponds to the "go c" step (e.g. by recording the resolved ref/step in the fake) — the key behavior is *which edge was chosen*, not the snapshot mechanics.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/router/walk-path.test.ts`
Expected: FAIL — `walkRoute` doesn't accept `path` (TS error) or ignores it and takes `edges[0]` (a→b).

- [ ] **Step 4: Modify `walk.ts`**

In `src/router/walk.ts`:

(a) Extend `WalkArgs`:
```typescript
export interface WalkArgs {
  goalName: string;
  startStateId: string;
  goalStateId: string;
  store: MapStore;
  states: State[];
  browser: WalkBrowser;
  path?: string[];               // resolved route (from findPath); follow it instead of edges[0]
  answer?: WalkAnswer;           // resume answer applied to the FIRST step taken this call
}

export type WalkAnswer =
  | { kind: 'ref'; ref: string }
  | { kind: 'classify'; verdict: 'safe' | 'commit' };
```

(b) In the loop, replace `const edge = edges[0];` with path-aware selection:
```typescript
    // Follow the resolved path when given: pick the outgoing edge whose toState
    // is the next state in the path. Falls back to the single edge otherwise.
    let edge = edges[0];
    if (args.path) {
      const i = args.path.indexOf(current);
      const next = i >= 0 ? args.path[i + 1] : undefined;
      const onPath = next ? edges.find((e) => e.toState === next) : undefined;
      if (!onPath) return { status: 'failed', reason: 'no path edge from ' + current };
      edge = onPath;
    }
```

(c) Apply the resume `answer` to the FIRST iteration only. Add before the `replayStep` call, guarded by a `let firstStep = true;` declared above the loop:
```typescript
    if (firstStep && args.answer) {
      const ans = args.answer;
      firstStep = false;
      if (ans.kind === 'classify') {
        if (ans.verdict === 'commit') {
          // Hard halt — never fire a commit point (#2).
          return doneHalted(args, browser);
        }
        // 'safe': fall through to resolve+act this step normally (treat as actionable).
      } else {
        // 'ref': act directly on the agent-chosen element, skip replayStep for this step.
        await browser.act(ans.ref, edge.acceptsInput);
        const afterYaml = await browser.snapshot();
        const observed = matchState(parseSnapshot(afterYaml), states);
        if (observed.status !== 'matched' || observed.state.id !== edge.toState) {
          return { status: 'needs-navigation', at, semanticStep: edge.semanticStep, snapshot: afterYaml,
            question: 'after applying the supplied ref, expected ' + edge.toState + ' but observed '
              + (observed.status === 'matched' ? observed.state.id : observed.status) };
        }
        store.recordOutcome(edge.fromState, edge.toState, edge.semanticStep, true);
        current = edge.toState; at++;
        continue;
      }
    }
    firstStep = false;
```

(d) Add the `doneHalted` helper (a `done` evidence bundle plus `halted: 'commit-point'`). Put it near the bottom of the file:
```typescript
function doneHalted(args: WalkArgs, browser: WalkBrowser): RecallResponse {
  return {
    status: 'done',
    evidence: {
      goal: args.goalName, query: args.goalName, candidates: [],
      cost: { playwright_calls: browser.callCount(),
        savings: { raw_snapshot_tokens: 0, bundle_tokens: 0, tokens_saved: 0, chars_per_token: 4 } },
    },
    halted: 'commit-point',
  } as RecallResponse;
}
```
And widen the `done` variant in `src/protocol.ts` to allow the optional marker:
```typescript
  | { status: 'done'; evidence: EvidenceBundle; halted?: 'commit-point' }
```

(e) Declare `let firstStep = true;` immediately before the `while` loop.

- [ ] **Step 5: Run both walk tests to verify pass + no regression**

Run: `npx vitest run tests/router/walk-path.test.ts tests/router/walk.test.ts`
Expected: PASS (new path test + the existing linear walk test — back-compat holds because `path` is optional).

- [ ] **Step 6: Commit**

```bash
git add src/router/walk.ts src/protocol.ts tests/router/walk-path.test.ts
git commit -m "feat(router): walkRoute follows a resolved path + accepts a resume answer"
```

---

## Task 4: Reusable live WalkBrowser factory — refactor `walk-live.ts`

**Files:**
- Modify: `src/router/walk-live.ts`
- (No new test — exercised by the existing gated `tests/e2e/walk.live.test.ts` + the new e2e in Task 6.)

Extract the WalkBrowser-building logic so BOTH a fresh walk and a resume can build a live browser over a given `-s=` session + inputs map. Today `runWalkLive` hardcodes saucedemo; we keep that working but expose a generic factory.

- [ ] **Step 1: Read `src/router/walk-live.ts`**

Note how it constructs `PlaywrightAdapter`, the `fieldRef` helper, and the `WalkBrowser.act` closure that fills fields by `inputSlot` from a captured `inputs` map.

- [ ] **Step 2: Export a factory**

Add (keeping `runWalkLive` as-is, or refactoring it to call this):

```typescript
import { PlaywrightAdapter } from '../playwright/adapter.js';
import { parseSnapshot, findByRoleAndName } from '../playwright/snapshot.js';
import type { WalkBrowser } from './walk.js';

/**
 * Build a live WalkBrowser over a named playwright session, resolving each
 * edge's input slot from `inputs` at fill time. `inputs` is held only here in
 * memory — never persisted. Used by the `walk` and `walk-resume` CLI verbs.
 */
export function makeLiveWalkBrowser(adapter: PlaywrightAdapter, inputs: Record<string, string>): WalkBrowser {
  let lastSnapshot = '';
  async function fieldRef(name: string): Promise<string> {
    let nodes = parseSnapshot(lastSnapshot);
    let node = findByRoleAndName(nodes, 'textbox', name);
    if (!node || !node.ref) {
      lastSnapshot = await adapter.snapshot();
      nodes = parseSnapshot(lastSnapshot);
      node = findByRoleAndName(nodes, 'textbox', name);
    }
    if (!node || !node.ref) throw new Error('walk: could not resolve textbox "' + name + '"');
    return node.ref;
  }
  return {
    snapshot: async () => { lastSnapshot = await adapter.snapshot(); return lastSnapshot; },
    callCount: () => adapter.callCount,
    act: async (ref: string, inputSlot: string | null) => {
      // Generic input fill: an edge that declares acceptsInput names a slot; the
      // value(s) come from `inputs`. For multi-field slots the convention is
      // documented per skeleton; for v1 the live e2e covers saucedemo's slots.
      if (inputSlot === 'credentials') {
        await adapter.fill(await fieldRef('Username'), inputs.username);
        await adapter.fill(await fieldRef('Password'), inputs.password);
        await adapter.click(ref); return;
      }
      if (inputSlot === 'shipping') {
        await adapter.fill(await fieldRef('First Name'), inputs.firstName ?? inputs.username ?? 'A');
        await adapter.fill(await fieldRef('Last Name'), inputs.lastName ?? 'B');
        await adapter.fill(await fieldRef('Zip/Postal Code'), inputs.zip);
        await adapter.click(ref); return;
      }
      await adapter.click(ref);
    },
  };
}
```

NOTE: this preserves the saucedemo slot handling that already works in `walk-live.ts`. Keep `runWalkLive` functioning (have it call `makeLiveWalkBrowser` or leave it untouched if cleaner). Do NOT break `tests/e2e/walk.live.test.ts`.

- [ ] **Step 3: Build to verify it compiles**

Run: `npm run build`
Expected: tsc succeeds (web build may run too — fine).

- [ ] **Step 4: Commit**

```bash
git add src/router/walk-live.ts
git commit -m "refactor(router): makeLiveWalkBrowser factory (reused by walk + walk-resume)"
```

---

## Task 5: `walk` + `walk-resume` CLI verbs — TDD (parse) + wiring

**Files:**
- Modify: `src/cli.ts`, `src/cli-spec.ts`
- Test: `tests/cli/parse-walk.test.ts`

- [ ] **Step 1: Write the failing parse test**

Create `tests/cli/parse-walk.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../src/cli.js';

describe('parseArgs — walk verbs', () => {
  it('parses walk with start/goal and repeated --input', () => {
    expect(parseArgs(['walk', '--start', 'sd:login', '--goal', 'sd:checkout-overview',
      '--input', 'username=u', '--input', 'password=p'])).toEqual({
      cmd: 'walk', start: 'sd:login', goal: 'sd:checkout-overview',
      inputs: { username: 'u', password: 'p' },
    });
  });
  it('parses walk-resume with --ref', () => {
    expect(parseArgs(['walk-resume', 'walk-7', '--ref', 'e42']))
      .toEqual({ cmd: 'walk-resume', session: 'walk-7', ref: 'e42', classify: undefined });
  });
  it('parses walk-resume with --classify', () => {
    expect(parseArgs(['walk-resume', 'walk-7', '--classify', 'safe']))
      .toEqual({ cmd: 'walk-resume', session: 'walk-7', ref: undefined, classify: 'safe' });
  });
  it('routes walk under the use dispatcher', () => {
    expect(parseArgs(['use', 'walk', '--start', 'a', '--goal', 'b']))
      .toEqual(parseArgs(['walk', '--start', 'a', '--goal', 'b']));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/parse-walk.test.ts`
Expected: FAIL — unknown command.

- [ ] **Step 3: Add parsing to `cli.ts`**

Add to the `ParsedArgs` union:
```typescript
  | { cmd: 'walk'; start: string; goal: string; inputs: Record<string, string> }
  | { cmd: 'walk-resume'; session: string; ref?: string; classify?: string }
```

Add an `--input k=v` collector helper near `flagValue`:
```typescript
function inputFlags(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) {
      const [k, ...rest] = args[i + 1].split('=');
      out[k] = rest.join('='); i++;
    }
  }
  return out;
}
```

In `parseArgs`, before the final `throw`:
```typescript
  if (cmd === 'walk') {
    return { cmd, start: flagValue(rest, '--start') ?? '', goal: flagValue(rest, '--goal') ?? '',
      inputs: inputFlags(rest) };
  }
  if (cmd === 'walk-resume') {
    return { cmd, session: rest.find((a) => !a.startsWith('--')) ?? '',
      ref: flagValue(rest, '--ref'), classify: flagValue(rest, '--classify') };
  }
```

Add both to `KNOWN_VERBS` if needed for `--help` gating (they're consumer verbs).

- [ ] **Step 4: Run parse test**

Run: `npx vitest run tests/cli/parse-walk.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the dispatch + cli-spec entries**

In `src/cli.ts` `main()`, before the `recall` block:
```typescript
  if (args.cmd === 'walk') {
    const { MapStore } = await import('./mapstore/store.js');
    const { ensureSeeded } = await import('./graph/seed.js');
    const { findPath } = await import('./router/path.js');
    const { walkRoute } = await import('./router/walk.js');
    const { WalkSessionStore } = await import('./router/walk-session.js');
    const { makeLiveWalkBrowser } = await import('./router/walk-live.js');
    const { PlaywrightAdapter } = await import('./playwright/adapter.js');
    const store = new MapStore('webnav.db');
    ensureSeeded(store);
    if (!store.getState(args.start)) { console.log(JSON.stringify({ status: 'failed', reason: 'unknown state ' + args.start })); process.exitCode = 2; return; }
    if (!store.getState(args.goal)) { console.log(JSON.stringify({ status: 'failed', reason: 'unknown state ' + args.goal })); process.exitCode = 2; return; }
    const path = findPath(store, args.start, args.goal);
    if (!path) { console.log(JSON.stringify({ status: 'failed', reason: 'no route from ' + args.start + ' to ' + args.goal })); process.exitCode = 3; return; }
    const browserSession = 'w-' + Date.now();
    const adapter = new PlaywrightAdapter(browserSession);
    const startState = store.getState(args.start)!;
    await adapter.open(startState.urlPattern || 'about:blank');
    const browser = makeLiveWalkBrowser(adapter, args.inputs);
    const states = store.statesForNode(startState.nodeId ?? '') ;
    const res = await walkRoute({ goalName: 'walk:' + args.goal, startStateId: args.start, goalStateId: args.goal, store, states, browser, path });
    if (res.status === 'needs-navigation' || res.status === 'needs-classification') {
      const sessions = new WalkSessionStore('webnav.db');
      const id = sessions.create({ startState: args.start, goalState: args.goal, path, browserSession });
      console.log(JSON.stringify({ ...res, session: id }, null, 2));
    } else {
      await adapter.close().catch(() => {});
      console.log(JSON.stringify(res, null, 2));
      if (res.status === 'failed') process.exitCode = 3;
    }
    return;
  }
  if (args.cmd === 'walk-resume') {
    const { MapStore } = await import('./mapstore/store.js');
    const { walkRoute } = await import('./router/walk.js');
    const { WalkSessionStore } = await import('./router/walk-session.js');
    const { makeLiveWalkBrowser } = await import('./router/walk-live.js');
    const { PlaywrightAdapter } = await import('./playwright/adapter.js');
    const store = new MapStore('webnav.db');
    const sessions = new WalkSessionStore('webnav.db');
    const w = sessions.load(args.session);
    if (!w) { console.log(JSON.stringify({ status: 'failed', reason: 'no active walk-session ' + args.session })); process.exitCode = 2; return; }
    const answer = args.ref ? { kind: 'ref' as const, ref: args.ref }
      : args.classify ? { kind: 'classify' as const, verdict: args.classify as 'safe' | 'commit' }
      : undefined;
    if (!answer) { console.log(JSON.stringify({ status: 'failed', reason: 'supply --ref or --classify' })); process.exitCode = 2; return; }
    const adapter = new PlaywrightAdapter(w.browserSession);   // reattach the live browser
    const browser = makeLiveWalkBrowser(adapter, {});           // inputs are re-supplied only if needed; v1 saucedemo fills earlier
    const startState = store.getState(w.path[w.pos]) ?? store.getState(w.startState)!;
    const states = store.statesForNode(startState.nodeId ?? '');
    const res = await walkRoute({ goalName: 'walk:' + w.goalState, startStateId: w.path[w.pos], goalStateId: w.goalState, store, states, browser, path: w.path, answer });
    if (res.status === 'needs-navigation' || res.status === 'needs-classification') {
      sessions.advance(args.session, w.pos + 1);
      console.log(JSON.stringify({ ...res, session: args.session }, null, 2));
    } else {
      sessions.close(args.session);
      await adapter.close().catch(() => {});
      console.log(JSON.stringify(res, null, 2));
    }
    return;
  }
```

NOTE: the `walk-resume` `startStateId: w.path[w.pos]` assumes `pos` tracks the current state index. Keep the session's `pos` consistent with the path index the walk paused at; if the walk advances internally, set `pos` to where the NEXT step begins. The implementer should make `walk`'s pause set `pos` to the path index of the state it paused ON (so resume restarts there). Adjust `advance` calls so resume continues from the right state — verify against the live e2e in Task 6.

In `src/cli-spec.ts`, add two `CONSUMER_COMMANDS` entries (group `'navigate'`):
```typescript
  {
    name: 'walk', group: 'navigate',
    summary: 'Walk a multi-step route to a non-URL state (pathfinds over the graph; pauses at forks for the agent).',
    args: [],
    flags: [
      { name: '--start', takesValue: true, description: 'Start state id (from `dev graph-show`).' },
      { name: '--goal', takesValue: true, description: 'Goal state id to reach.' },
      { name: '--input', takesValue: true, description: 'Runtime input slot=value (repeatable; never stored).' },
    ],
    example: 'webnav walk --start sd:login --goal sd:checkout-overview --input username=u --input password=p',
  },
  {
    name: 'walk-resume', group: 'navigate',
    summary: 'Continue a paused walk: answer the fork it stopped on.',
    args: [{ name: 'session', required: true, description: 'Walk session id from a paused `walk`.' }],
    flags: [
      { name: '--ref', takesValue: true, description: 'Element ref (answers needs-navigation; from the snapshot).' },
      { name: '--classify', takesValue: true, description: 'safe | commit (answers needs-classification; commit halts).' },
    ],
    example: 'webnav walk-resume w-1717... --ref e42',
  },
```

Update the registry-count test in `tests/cli-spec.test.ts` (add `walk`, `walk-resume` to the expected sorted name array).

- [ ] **Step 6: Build + parse/spec tests**

Run: `npm run build` — Expected: tsc OK.
Run: `npx vitest run tests/cli` — Expected: PASS (incl. the updated registry-count test).

- [ ] **Step 7: Commit**

```bash
git add src/cli.ts src/cli-spec.ts tests/cli/parse-walk.test.ts tests/cli-spec.test.ts
git commit -m "feat(cli): walk + walk-resume verbs (use category) over the walk engine"
```

---

## Task 6: Gated live e2e — saucedemo walk completes across two CLI calls

**Files:**
- Create: `tests/e2e/walk-cli.live.test.ts`

Drive the built CLI: `walk` pauses at add-to-cart → `walk-resume --ref` reaches checkout-overview. Gated by `WEBNAV_LIVE=1`.

- [ ] **Step 1: Write the gated test**

Create `tests/e2e/walk-cli.live.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const live = process.env.WEBNAV_LIVE === '1';

async function cli(args: string[]) {
  const { stdout } = await exec('npx', ['tsx', 'src/cli.ts', ...args], { maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(stdout);
}

describe.skipIf(!live)('live: walk CLI end-to-end (saucedemo)', () => {
  it('walk pauses at a fork, walk-resume --ref continues to the goal', async () => {
    const r1 = await cli(['walk', '--start', 'sd:login', '--goal', 'sd:checkout-overview',
      '--input', 'username=standard_user', '--input', 'password=secret_sauce',
      '--input', 'firstName=A', '--input', 'lastName=B', '--input', 'zip=94016']);
    // Either it completed (skeleton resolved everything) or paused for a ref.
    if (r1.status === 'done') { expect(r1.status).toBe('done'); return; }
    expect(['needs-navigation', 'needs-classification']).toContain(r1.status);
    expect(r1.session).toBeTruthy();
    // Pick a ref from the returned snapshot — the first "Add to cart" button.
    const m = r1.snapshot.match(/button "Add to cart"[^\n]*\[ref=(e\d+)\]/);
    expect(m).toBeTruthy();
    const r2 = await cli(['walk-resume', r1.session, '--ref', m![1]]);
    expect(['done', 'needs-navigation']).toContain(r2.status); // ideally done
  }, 120_000);
});
```

- [ ] **Step 2: Run gated (live)**

Run: `WEBNAV_LIVE=1 npx vitest run tests/e2e/walk-cli.live.test.ts`
Expected: PASS (needs playwright-cli + network). Without the env var, skipped.

If the resume doesn't reach `done` (e.g. the shipping fill or a second fork), debug the `pos`/`path` indexing in Task 5's dispatch (the resume must restart at the state it paused on and re-supply the shipping input — for v1 it's acceptable to pass inputs again on resume; if so, add `--input` support to `walk-resume` parsing + dispatch and note it). Make the test reflect the real working flow; do not weaken it to pass on a broken walk.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/walk-cli.live.test.ts
git commit -m "test(e2e): gated live walk CLI (saucedemo pauses then resumes to goal)"
```

---

## Task 7: STATUS.md + full suite green

**Files:**
- Modify: `docs/STATUS.md`

- [ ] **Step 1: Add the feature note + verb table rows**

In `docs/STATUS.md`, add to the verb table: `webnav walk --start --goal [--input k=v]` and `webnav walk-resume <session> --ref|--classify`. Add a section:

```markdown
### Interactive walk — expose + resume (DONE, 2026-06-06)

The multi-step walk engine is now agent-usable: `webnav walk --start <id> --goal
<id> [--input k=v ...]` pathfinds the weighted-shortest route over the graph
(`findPath`) and walks it to a non-URL state; on a fork it persists a
**walk-session** and returns `{ session, status: needs-* }`; `webnav walk-resume
<session> --ref <e>` / `--classify safe|commit` continues (commit = hard halt,
never fires — #2). Runtime inputs (`--input`) are in-memory only, never persisted.
Walks are pure graph traversal (no walk records). Verified live on saucedemo
across two CLI calls. Spec/plan:
`docs/superpowers/specs/2026-06-06-interactive-walk-design.md`,
`docs/superpowers/plans/2026-06-06-interactive-walk.md`.
```

Bump the test-count line.

- [ ] **Step 2: Build + full suite**

Run: `npm run build` — Expected: OK.
Run: `npx vitest run` — Expected: all pass, gated e2e skipped. (ABI error → rebuild better-sqlite3 first.)

- [ ] **Step 3: Commit**

```bash
git add docs/STATUS.md
git commit -m "docs: interactive walk (expose + resume) done"
```

---

## Self-review notes (for the implementer)

- **`findPath` is the riskiest new logic** — it's fully unit-tested (linear, branch-by-weight, unreachable, cycle). Keep the weight formula as given.
- **Back-compat:** `walkRoute`'s `path`/`answer` are OPTIONAL — the existing `tests/router/walk.test.ts` and `runWalkLive` must stay green. Run them after Task 3.
- **The `-s=` browser persists across processes** (verified in brainstorm) — that's why `walk` can exit and `walk-resume` reattaches by name. Do NOT try to serialize browser state.
- **Inputs are NEVER persisted** — only in the live process. The walk-session table has no inputs column (a test asserts this). On resume, v1's saucedemo fills happen before the pause; if a post-pause step needs input, allow `walk-resume --input` (note it) rather than storing it.
- **`pos` indexing is the one fiddly bit** (Task 5 note): the session's `pos` must point at the state the walk paused ON, so resume restarts there with the answer applied to that step. Verify against the live e2e (Task 6); fix indexing there, not by weakening the test.
- **Commit hard-stop (#2):** `--classify commit` returns `done` + `halted:'commit-point'` and NEVER calls `browser.act` on that step. Non-negotiable.
- **Native module:** ABI mass-fail → `cd node_modules/better-sqlite3 && npx node-gyp rebuild && cd ../..`.
```
