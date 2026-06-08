# Saucedemo Affordance Re-seed + Walk Affordance-Pause Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-seed saucedemo in the affordance model (in-page actions are not states) and extend `walkRoute` to pause for an edge's required in-page affordances, so `walk login → checkout-overview` completes on one consistent model.

**Architecture:** Add `requiresAffordances: string[]` to the `Edge` model (declared data; zero-LLM). Rewrite the seeded saucedemo skeleton: page-states + navigation edges only, with `requiresAffordances` on the cart-open and shipping-continue edges. Extend `walkRoute` so that before traversing an edge with non-empty `requiresAffordances`, it pauses (`needs-navigation`) handing the agent the list; the agent fires them and resumes. The walk stays the autopilot — it pauses ONLY where an edge declares required affordances.

**Tech Stack:** TypeScript (strict), Node 18+ (run via Node 24 — `cd node_modules/better-sqlite3 && npx node-gyp rebuild` on ABI errors), `better-sqlite3`, vitest, `playwright-cli` for the gated e2e. Reuses `walkRoute` (already does pathfinding + resume), `makeEdge`/`MapStore`, the existing `migrate()`.

**Spec:** `docs/superpowers/specs/2026-06-08-saucedemo-affordance-reseed-walk-design.md`

---

## Existing shapes this builds on (verified)

- `Edge` (`src/mapstore/types.ts`): `{ fromState, toState, semanticStep, selectorCache, kind, acceptsInput, cost, reliability, successCount, failCount, lastVerified, confidence }`. `makeEdge(init)` spreads defaults then `...init`.
- `edges` table: columns match Edge; `UNIQUE(from_state, to_state, semantic_step)`. `upsertEdge` uses named params; `rowToEdge` maps columns → Edge via `makeEdge`.
- `MapStore.migrate()` already exists (adds `states.node_id`, `goals.site/entry/extractor` idempotently) — extend it for the new edges column.
- `walkRoute` (`src/router/walk.ts`): follows a resolved `path`, picks the edge whose `toState` is the next path entry, supports an `answer` resume (`{kind:'ref'|'classify'}`) applied to the first step, `let firstStep`/`at` counters, returns `needs-navigation`/`needs-classification`/`done`/`failed`.
- `SAUCEDEMO_SKELETON` + `exploreSaucedemo(store)` (`src/explorer/saucedemo-skeleton.ts`) — writes states+edges via upsert; consumed by `seed.ts`, `walk-live.ts`, and tests.
- `editGraph` (`src/graph/edit.ts`) — writes agent edges; its edge JSON currently supports `from,to,via,needsInput,why`.

---

## File structure

- **Modify** `src/mapstore/types.ts` — add `requiresAffordances?: string[]` to `Edge`; `makeEdge` default `[]`.
- **Modify** `src/mapstore/schema.sql` + `src/mapstore/store.ts` — `requires_affordances` column (JSON); migration; `upsertEdge`/`rowToEdge` round-trip.
- **Modify** `src/explorer/saucedemo-skeleton.ts` — affordance-model re-seed; clear `sd:*` edges before re-write.
- **Modify** `src/router/walk.ts` — pause before traversing an edge with `requiresAffordances`.
- **Modify** `src/router/walk-live.ts` — shipping fields fired at the pause (not the old slot); keep credentials.
- **Modify** `src/graph/edit.ts` — accept `requiresAffordances` in edge JSON.
- **Tests** + `docs/STATUS.md`.

---

## Task 1: `Edge.requiresAffordances` — model + persistence — TDD

**Files:**
- Modify: `src/mapstore/types.ts`, `src/mapstore/schema.sql`, `src/mapstore/store.ts`
- Test: `tests/mapstore/edge-affordances.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/mapstore/edge-affordances.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MapStore } from '../../src/mapstore/store.js';
import { makeState, makeEdge } from '../../src/mapstore/types.js';

function store(): MapStore { return MapStore.fromDatabase(new Database(':memory:')); }

describe('Edge.requiresAffordances', () => {
  it('round-trips a non-empty requiresAffordances list', () => {
    const s = store();
    s.upsertState(makeState({ id: 'n:a', nodeId: 'n', semanticName: 'a', urlPattern: '', role: 'detail' }));
    s.upsertState(makeState({ id: 'n:b', nodeId: 'n', semanticName: 'b', urlPattern: '', role: 'detail' }));
    s.upsertEdge(makeEdge({ fromState: 'n:a', toState: 'n:b', semanticStep: 'go', kind: 'navigate',
      requiresAffordances: ['add an item to the cart'] }));
    expect(s.edgesFrom('n:a')[0].requiresAffordances).toEqual(['add an item to the cart']);
  });

  it('defaults to an empty array when absent', () => {
    const s = store();
    s.upsertState(makeState({ id: 'n:a', nodeId: 'n', semanticName: 'a', urlPattern: '', role: 'detail' }));
    s.upsertState(makeState({ id: 'n:b', nodeId: 'n', semanticName: 'b', urlPattern: '', role: 'detail' }));
    s.upsertEdge(makeEdge({ fromState: 'n:a', toState: 'n:b', semanticStep: 'go', kind: 'navigate' }));
    expect(s.edgesFrom('n:a')[0].requiresAffordances).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mapstore/edge-affordances.test.ts`
Expected: FAIL — `requiresAffordances` not on Edge / not persisted.

- [ ] **Step 3: Add the field to `types.ts`**

In `src/mapstore/types.ts`, add to the `Edge` interface (after `acceptsInput`):
```typescript
  requiresAffordances: string[];  // in-page affordances to fire before traversing this edge; [] = none
```
In `makeEdge`'s defaults object (alongside `selectorCache: null, acceptsInput: null, ...`):
```typescript
    requiresAffordances: [],
```

- [ ] **Step 4: Add the column + migration + round-trip in `store.ts`/`schema.sql`**

In `src/mapstore/schema.sql`, add `requires_affordances TEXT` to the `edges` table (before the `UNIQUE` line):
```sql
  last_verified INTEGER, confidence REAL NOT NULL DEFAULT 1,
  requires_affordances TEXT,
  UNIQUE(from_state, to_state, semantic_step)
```

In `src/mapstore/store.ts` `migrate()`, add (after the goals column loop):
```typescript
    const ecols: any[] = this.db.prepare('PRAGMA table_info(edges)').all();
    if (!ecols.some((c) => c.name === 'requires_affordances')) {
      this.db.exec('ALTER TABLE edges ADD COLUMN requires_affordances TEXT');
    }
```

In `upsertEdge`, add the column to the INSERT column list + VALUES + the `.run({...})` object:
- column list: `...last_verified,confidence,requires_affordances)`
- VALUES: `...@lastVerified,@confidence,@requiresAffordances)`
- ON CONFLICT DO UPDATE SET: add `requires_affordances=@requiresAffordances`
- run object: add `requiresAffordances: JSON.stringify(e.requiresAffordances ?? [])`

In `rowToEdge`, add to the `makeEdge({...})` call:
```typescript
    requiresAffordances: r.requires_affordances ? JSON.parse(r.requires_affordances) : [],
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/mapstore/edge-affordances.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Run the existing mapstore tests (back-compat)**

Run: `npx vitest run tests/mapstore`
Expected: PASS — the new column is nullable; legacy edges read back `requiresAffordances: []`.

- [ ] **Step 7: Commit**

```bash
git add src/mapstore/types.ts src/mapstore/schema.sql src/mapstore/store.ts tests/mapstore/edge-affordances.test.ts
git commit -m "feat(mapstore): Edge.requiresAffordances (in-page actions gating an edge)"
```

---

## Task 2: `walkRoute` pauses for required affordances — TDD

**Files:**
- Modify: `src/router/walk.ts`
- Test: `tests/router/walk-affordance.test.ts`

Before traversing an edge with non-empty `requiresAffordances`, return a `needs-navigation` pause listing them. Only on the FIRST step of the call (so a resume — `answer` present — proceeds past it, since the agent has now fired the affordances). Edges with empty `requiresAffordances` traverse as today.

- [ ] **Step 1: Read `walkRoute`**

Note: the loop selects `edge` (path-aware), the `firstStep` flag, the `args.answer` resume block, the `at` counter, and the `needs-navigation` return shape `{ status, at, semanticStep, snapshot, question }`.

- [ ] **Step 2: Write the failing test**

Create `tests/router/walk-affordance.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MapStore } from '../../src/mapstore/store.js';
import { makeState, makeEdge } from '../../src/mapstore/types.js';
import { walkRoute, type WalkBrowser } from '../../src/router/walk.js';

function scripted(pages: string[]): WalkBrowser {
  let idx = 0;
  return { async snapshot() { return pages[idx]; }, async act() { idx++; }, callCount() { return idx; } };
}
function setup() {
  const store = MapStore.fromDatabase(new Database(':memory:'));
  for (const id of ['a', 'b']) store.upsertState(makeState({ id, nodeId: 'n', semanticName: id, urlPattern: '', role: 'detail', fingerprint: [`link:on-${id}`] }));
  return store;
}

describe('walkRoute — requiresAffordances pause', () => {
  it('pauses (needs-navigation listing the affordances) BEFORE traversing a gated edge', async () => {
    const store = setup();
    store.upsertEdge(makeEdge({ fromState: 'a', toState: 'b', semanticStep: 'open cart', kind: 'navigate',
      requiresAffordances: ['add an item to the cart'] }));
    const res = await walkRoute({
      goalName: 'g', startStateId: 'a', goalStateId: 'b', store, states: store.allStates(),
      browser: scripted(['- link "on-a" [ref=e1]', '- link "on-b" [ref=e2]']), path: ['a', 'b'],
    });
    expect(res.status).toBe('needs-navigation');
    expect((res as any).question).toContain('add an item to the cart');
  });

  it('does NOT pause for an edge with no requiresAffordances (autopilot preserved)', async () => {
    const store = setup();
    store.upsertEdge(makeEdge({ fromState: 'a', toState: 'b', semanticStep: 'follow "to-b"', kind: 'navigate' }));
    const res = await walkRoute({
      goalName: 'g', startStateId: 'a', goalStateId: 'b', store, states: store.allStates(),
      browser: scripted(['- link "to-b" [ref=e1]', '- link "on-b" [ref=e2]']), path: ['a', 'b'],
    });
    expect(res.status).toBe('done');
  });

  it('on resume (answer present), proceeds past the gated edge', async () => {
    const store = setup();
    store.upsertEdge(makeEdge({ fromState: 'a', toState: 'b', semanticStep: 'open cart', kind: 'navigate',
      requiresAffordances: ['add an item to the cart'] }));
    const res = await walkRoute({
      goalName: 'g', startStateId: 'a', goalStateId: 'b', store, states: store.allStates(),
      browser: scripted(['- link "on-a" [ref=e1]', '- link "on-b" [ref=e2]']), path: ['a', 'b'],
      answer: { kind: 'ref', ref: 'e1' },
    });
    expect(res.status).toBe('done');
  });
});
```

NOTE on the scripted-browser fingerprint matching: the predict-vs-observe step matches the post-act page against the next state's fingerprint (`link:on-b`). The pages array is `[before-page, after-page]`; the after-page must contain `link "on-b"`. The "does not pause" + "resume" tests rely on `resolveStep` finding the edge's quoted step name on the before-page — for the gated-edge tests the pause happens BEFORE resolveStep, so the before-page only needs the next-state fingerprint after the act. If the predict-vs-observe is brittle in the scripted harness, the KEY assertions are: gated edge + no answer → `needs-navigation` with the affordance text; gated edge + answer → proceeds (not stuck on the pause); ungated edge → no affordance pause. Adjust page tokens to satisfy matchState; do not weaken those three assertions.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/router/walk-affordance.test.ts`
Expected: FAIL — walk doesn't pause on `requiresAffordances`.

- [ ] **Step 4: Implement the pause in `walk.ts`**

In `src/router/walk.ts`, after `edge` is selected and BEFORE the resume-`answer` block (so a fresh first step pauses, but a resume — which carries `answer` — skips the pause because the agent already fired the affordances), insert:

```typescript
    // Gated edge: pause for the agent to fire required in-page affordances FIRST.
    // Only on a fresh first step with no resume answer — on resume the agent has
    // already fired them, so we proceed. Autopilot: ungated edges never pause.
    if (firstStep && !args.answer && edge.requiresAffordances && edge.requiresAffordances.length > 0) {
      const yaml = await browser.snapshot();
      return {
        status: 'needs-navigation', at, semanticStep: edge.semanticStep, snapshot: yaml,
        question: 'before "' + edge.semanticStep + '", fire these in-page affordances on the current page: '
          + edge.requiresAffordances.join('; '),
      };
    }
```

(Place this immediately after the `let edge = ...` path-selection block. The existing `firstStep`/`args.answer` handling that follows is unchanged.)

- [ ] **Step 5: Run test to verify it passes + no regression**

Run: `npx vitest run tests/router/walk-affordance.test.ts tests/router/walk.test.ts tests/router/walk-path.test.ts`
Expected: PASS (new affordance tests + existing walk tests — back-compat: edges without `requiresAffordances` behave exactly as before).

- [ ] **Step 6: Commit**

```bash
git add src/router/walk.ts tests/router/walk-affordance.test.ts
git commit -m "feat(router): walkRoute pauses for an edge's requiresAffordances (autopilot otherwise)"
```

---

## Task 3: Re-seed saucedemo in the affordance model — TDD

**Files:**
- Modify: `src/explorer/saucedemo-skeleton.ts`
- Test: update `tests/explorer/saucedemo-skeleton.test.ts`

Rewrite `SAUCEDEMO_SKELETON` to the affordance shape; clear existing `sd:*` edges on seed (so the old bundled `inventory→cart` edge doesn't linger).

- [ ] **Step 1: Read the current skeleton + its test**

Read `src/explorer/saucedemo-skeleton.ts` (states, edges, `exploreSaucedemo`) and `tests/explorer/saucedemo-skeleton.test.ts` (it asserts state count, the linear chain, the Finish commit edge, etc.).

- [ ] **Step 2: Rewrite the edges in `SAUCEDEMO_SKELETON`**

Keep the 5 states (`sd:login`, `sd:inventory`, `sd:cart`, `sd:checkout-info`, `sd:checkout-overview`) + the `sd:purchase-complete` target. Replace the `edges` array with:

```typescript
  edges: [
    makeEdge({
      fromState: 'sd:login', toState: 'sd:inventory',
      semanticStep: 'log in by clicking "Login"',
      kind: 'safe-reversible', acceptsInput: 'credentials',
    }),
    makeEdge({
      fromState: 'sd:inventory', toState: 'sd:cart',
      semanticStep: 'open the shopping cart',
      kind: 'safe-reversible',
      requiresAffordances: ['add an item to the cart (e.g. the "Add to cart" button on a product)'],
    }),
    makeEdge({
      fromState: 'sd:cart', toState: 'sd:checkout-info',
      semanticStep: 'click "Checkout"', kind: 'safe-reversible',
    }),
    makeEdge({
      fromState: 'sd:checkout-info', toState: 'sd:checkout-overview',
      semanticStep: 'click "Continue"', kind: 'safe-reversible',
      requiresAffordances: ['enter First Name', 'enter Last Name', 'enter Zip/Postal Code'],
    }),
    makeEdge({
      fromState: 'sd:checkout-overview', toState: 'sd:purchase-complete',
      semanticStep: 'click "Finish"', kind: 'unclassified',
    }),
  ],
```

(Note: the `sd:inventory → sd:cart` edge's `semanticStep` is now `'open the shopping cart'`, not the old bundled `'add ... and open cart'`. The shipping `acceptsInput:'shipping'` is removed — shipping is now required affordances. Login keeps `acceptsInput:'credentials'`.)

- [ ] **Step 3: Clear stale `sd:*` edges on seed**

In `exploreSaucedemo(store)`, before writing the new edges, delete any existing saucedemo edges so the old bundled edge can't linger. Since `MapStore` has no `deleteEdge`, add a minimal one OR clear within the transaction. Simplest: add a one-liner in `exploreSaucedemo` that removes edges whose `fromState` starts with `sd:`:

In `src/mapstore/store.ts`, add to `IMapStore` + `MapStore`:
```typescript
  deleteEdgesFromPrefix(prefix: string): void;
```
```typescript
  deleteEdgesFromPrefix(prefix: string): void {
    this.db.prepare("DELETE FROM edges WHERE from_state LIKE ? || '%'").run(prefix);
  }
```
Then in `exploreSaucedemo`, inside its transaction, call `store.deleteEdgesFromPrefix('sd:')` before upserting the new states+edges.

- [ ] **Step 4: Update the skeleton test**

In `tests/explorer/saucedemo-skeleton.test.ts`:
- States unchanged (5 fingerprinted + target). Keep those assertions.
- The `sd:inventory → sd:cart` edge now has `semanticStep: 'open the shopping cart'` and `requiresAffordances: ['add an item to the cart...']`. Update any assertion about that edge's semanticStep. Add an assertion:
```typescript
  it('the cart-open edge requires the add-to-cart affordance', () => {
    const e = SAUCEDEMO_SKELETON.edges.find((x) => x.fromState === 'sd:inventory' && x.toState === 'sd:cart')!;
    expect(e.requiresAffordances.length).toBeGreaterThan(0);
    expect(e.requiresAffordances.join(' ')).toMatch(/add/i);
  });
  it('the shipping-continue edge requires the three shipping affordances', () => {
    const e = SAUCEDEMO_SKELETON.edges.find((x) => x.fromState === 'sd:checkout-info')!;
    expect(e.requiresAffordances.length).toBe(3);
  });
```
- The Finish commit edge (`sd:checkout-overview → sd:purchase-complete`, kind `unclassified`) is unchanged — keep that assertion.
- Remove/replace any assertion referencing the old `acceptsInput:'shipping'` on the checkout-info edge.

- [ ] **Step 5: Run the skeleton test + seed test**

Run: `npx vitest run tests/explorer/saucedemo-skeleton.test.ts tests/graph/seed.test.ts tests/explorer/skeleton-nodeid.test.ts`
Expected: PASS. (If `walk.test.ts` or `walk.live.test.ts` assert the old shape, fix them in Task 4.)

- [ ] **Step 6: Commit**

```bash
git add src/explorer/saucedemo-skeleton.ts src/mapstore/store.ts tests/explorer/saucedemo-skeleton.test.ts
git commit -m "feat(explorer): re-seed saucedemo in the affordance model (requiresAffordances, no bundled edge)"
```

---

## Task 4: Live wiring — fire shipping affordances at the pause — manual verify

**Files:**
- Modify: `src/router/walk-live.ts`
- Update: `tests/router/walk.test.ts` and `tests/e2e/walk.live.test.ts` if they assert the old shape

The walk now PAUSES at `inventory→cart` (add-to-cart) and `checkout-info→checkout-overview` (shipping). `runWalkLive`'s old inline `act` had a bespoke add-to-cart step and a `shipping` slot; under the new model those become agent-fired affordances at pauses. For the live demo the controller (not a committed test) drives the resume loop; `runWalkLive` itself can stay as a single-shot that now naturally pauses at the first gated edge.

- [ ] **Step 1: Read `runWalkLive` + the gated `walk.live.test.ts`**

Note how `runWalkLive` builds its WalkBrowser and what `walk.live.test.ts` asserts (it expects a `needs-navigation` after login at the add-to-cart step — still true, now with the affordance question).

- [ ] **Step 2: Update `walk.live.test.ts` expectation**

The first pause is now the `requiresAffordances` pause at `sd:inventory→sd:cart`. Update the assertion to expect `needs-navigation` whose `question` mentions the add affordance (was the old "ambiguous add-to-cart" escalation). Concretely change the `semanticStep`/`question` assertion to:
```typescript
    expect(r.status).toBe('needs-navigation');
    expect(r.question).toMatch(/add/i);   // the requiresAffordances pause at inventory->cart
```

- [ ] **Step 3: Update `walk.test.ts` if it referenced the old bundled edge / shipping slot**

Run `grep -n "shipping\|and open cart\|inventory.*cart" tests/router/walk.test.ts`. If any test wires the old `acceptsInput:'shipping'` or the bundled semanticStep, update it to the new shape (cart edge requires affordances; the unit walk tests can use the `answer` resume to proceed past the gated edge, mirroring `walk-affordance.test.ts`). If `walk.test.ts` doesn't touch saucedemo specifics, leave it.

- [ ] **Step 4: Build + run the affected suites**

Run: `npm run build` — Expected: tsc OK.
Run: `npx vitest run tests/router tests/explorer` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/router/walk-live.ts tests/router/walk.test.ts tests/e2e/walk.live.test.ts
git commit -m "feat(router): walk-live + tests reflect affordance-pause saucedemo shape"
```

---

## Task 5: `graph-edit` accepts `requiresAffordances` — TDD

**Files:**
- Modify: `src/graph/edit.ts`
- Test: extend `tests/graph/edit.test.ts`

So an agent building a graph (the mapping flow) can author gated edges too.

- [ ] **Step 1: Write the failing test**

Add to `tests/graph/edit.test.ts`:

```typescript
  it('persists requiresAffordances on an edge', () => {
    const store = MapStore.fromDatabase(new Database(':memory:'));
    editGraph(store, 'example.com', {
      states: [{ label: 'inventory' }, { label: 'cart' }],
      edges: [{ from: 'inventory', to: 'cart', via: 'open cart', requiresAffordances: ['add an item'] }],
    });
    const e = store.edgesFrom('example.com:inventory')[0];
    expect(e.requiresAffordances).toEqual(['add an item']);
  });
```

(Match the existing test file's import style — `MapStore.fromDatabase`, `editGraph`, `Database`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/graph/edit.test.ts`
Expected: FAIL — `requiresAffordances` not passed through.

- [ ] **Step 3: Implement in `edit.ts`**

In `src/graph/edit.ts`, the `EditEdge` interface: add `requiresAffordances?: string[]`. In the `makeEdge({...})` call that builds each edge, add:
```typescript
        requiresAffordances: e.requiresAffordances ?? [],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/graph/edit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/graph/edit.ts tests/graph/edit.test.ts
git commit -m "feat(graph): graph-edit accepts requiresAffordances on edges"
```

---

## Task 6: Gated live e2e — the saucedemo walk completes — verify

**Files:**
- Create: `tests/e2e/walk-affordance.live.test.ts`

`walk sd:login → sd:checkout-overview` on real saucedemo: pauses at add-to-cart (supply ref), pauses at shipping (fill), reaches checkout-overview. Gated by `WEBNAV_LIVE=1`. Uses `runWalkLive`/`walkRoute` + resume; if driving the full multi-pause loop in one test is brittle, assert the FIRST pause is the affordance pause and a resume proceeds (the controller will run the full loop manually as the acceptance demo).

- [ ] **Step 1: Write the gated test**

Create `tests/e2e/walk-affordance.live.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MapStore } from '../../src/mapstore/store.js';
import { seedGraph } from '../../src/graph/seed.js';
import { findPath } from '../../src/router/path.js';
import { walkRoute } from '../../src/router/walk.js';
import { PlaywrightAdapter } from '../../src/playwright/adapter.js';
import { makeLiveWalkBrowser } from '../../src/router/walk-live.js';

const live = process.env.WEBNAV_LIVE === '1';

describe.skipIf(!live)('live: saucedemo walk pauses at the add-to-cart affordance', () => {
  it('reaches the inventory page then pauses for the required add-to-cart affordance', async () => {
    const store = MapStore.fromDatabase(new Database(':memory:'));
    seedGraph(store);
    const path = findPath(store, 'sd:login', 'sd:checkout-overview')!;
    expect(path[0]).toBe('sd:login');
    const adapter = new PlaywrightAdapter('aff-walk-' + Date.now());
    await adapter.open('https://www.saucedemo.com/');
    const browser = makeLiveWalkBrowser(adapter, { username: 'standard_user', password: 'secret_sauce' });
    const res = await walkRoute({
      goalName: 'sd', startStateId: 'sd:login', goalStateId: 'sd:checkout-overview',
      store, states: store.statesForNode('saucedemo'), browser, path,
    });
    await adapter.close().catch(() => {});
    // login resolves (needsInput credentials) then the walk pauses at the
    // inventory->cart edge for the add-to-cart affordance.
    expect(res.status).toBe('needs-navigation');
    expect((res as any).question).toMatch(/add/i);
  }, 120_000);
});
```

(NOTE: this proves the affordance pause fires live after login. The FULL completion to checkout-overview — resume through add-to-cart + shipping — is the controller-run acceptance demo, since it needs the multi-pause resume loop with live refs. If you can wire the full loop here reliably, do so and assert `done`; otherwise this first-pause assertion + the controller demo is the bar.)

- [ ] **Step 2: Confirm skipped, then run live**

Run: `npx vitest run tests/e2e/walk-affordance.live.test.ts` — Expected: skipped.
Run: `WEBNAV_LIVE=1 npx vitest run tests/e2e/walk-affordance.live.test.ts` — Expected: PASS (login → pause at add-to-cart affordance). If `makeLiveWalkBrowser`'s credentials fill or the pause doesn't fire, debug against the real page; do not weaken the assertion.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/walk-affordance.live.test.ts
git commit -m "test(e2e): gated live saucedemo walk pauses at the add-to-cart affordance"
```

---

## Task 7: STATUS.md + full suite green

**Files:**
- Modify: `docs/STATUS.md`

- [ ] **Step 1: Update the walk note + add the re-seed note**

In `docs/STATUS.md`, change the "Interactive walk — ENGINE DONE, demo pending" note to reflect completion, and add:

```markdown
### Saucedemo affordance re-seed + walk affordance-pause (DONE, 2026-06-08)

Saucedemo is re-seeded in the affordance model (page-states + navigation edges
only; add-to-cart is an in-page affordance, not a state — the old page=state
bundled `inventory→cart` edge is retired). New edge field `requiresAffordances:
string[]` (declared data) lets a navigation edge declare in-page actions that must
be fired first. `walkRoute` pauses (`needs-navigation` listing the affordances)
before traversing a gated edge; the agent fires them and resumes; ungated edges
traverse deterministically (autopilot preserved — see the walk-vs-use note in
CLAUDE.md). `graph-edit` accepts `requiresAffordances` so agent-built graphs can
gate edges too. Verified live: the saucedemo walk reaches inventory then pauses
for the add-to-cart affordance. Spec/plan:
`docs/superpowers/specs/2026-06-08-saucedemo-affordance-reseed-walk-design.md`,
`docs/superpowers/plans/2026-06-08-saucedemo-affordance-reseed-walk.md`.
```

Bump the test-count line.

- [ ] **Step 2: Build + full suite**

Run: `npm run build` — Expected: OK.
Run: `npx vitest run` — Expected: all pass, gated e2e skipped. (ABI error → rebuild better-sqlite3.)

- [ ] **Step 3: Commit**

```bash
git add docs/STATUS.md
git commit -m "docs: saucedemo affordance re-seed + walk affordance-pause done"
```

---

## Self-review notes (for the implementer)

- **Autopilot preserved is the invariant:** the walk pauses ONLY for edges with non-empty `requiresAffordances`. Ungated edges must traverse without pausing (a test asserts this). Don't add a pause-at-every-page.
- **The pause is BEFORE the resume block + gated on `!args.answer`:** a fresh walk pauses at a gated edge; a resume (answer present) proceeds (the agent already fired the affordances). Verify both in the unit test.
- **requiresAffordances is declared data, not a judgment:** webnav never decides necessity — it reads the list off the edge. The graph author (the agent, or the seed) declares it.
- **Migration is additive** (nullable `requires_affordances`); legacy edges read back `[]`. Existing mapstore/walk tests stay green.
- **Stale-edge clear:** `exploreSaucedemo` deletes `sd:*` edges before re-writing (the old bundled edge had a different semanticStep, so upsert alone would leave it). `deleteEdgesFromPrefix('sd:')` handles it.
- **Login stays on `needsInput`/credentials; only shipping migrates to affordances** (per spec — full slot removal is out of scope).
- **Native module:** ABI mass-fail → `cd node_modules/better-sqlite3 && npx node-gyp rebuild && cd ../..`.
```
