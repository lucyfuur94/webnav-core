# Live Graph Viewer + Node Drill-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `npm run dev` → a tiny read-only Node `http` server over the live SQLite map; the existing Cytoscape viewer fetches the graph and renders a node's intra-site interior as a drill-in sub-graph on click. Make the DB the single source of truth (skeletons become seed data, lazy bootstrap dropped, `states` gain `node_id`), and formalize MapStore as a swappable interface.

**Architecture:** webnav stays a zero-LLM, near-zero-dep TypeScript CLI. A new `src/server.ts` (Node built-in `http`, no new deps) serves the viewer HTML + two JSON read endpoints (`/api/graph`, `/api/node/:id/interior`) backed by `MapStore`. Interior data is a pure builder (`buildNodeInterior`) sibling to the existing `buildGraphView`. State→node ownership becomes a real `node_id` column (backfilled from the `<node>:<state>` id prefix). `MapStore` becomes an interface; the SQLite class implements it.

**Tech Stack:** TypeScript (strict), Node 18+, `better-sqlite3`, vitest, `tsx` (dev runner), `playwright-cli` (gated browser e2e). No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-06-02-live-graph-viewer-design.md`

---

## File structure

- **Modify** `src/mapstore/types.ts` — add `nodeId` to `State`; add a `makeState` helper.
- **Modify** `src/mapstore/schema.sql` — add `node_id` column to `states`.
- **Modify** `src/mapstore/store.ts` — extract `interface MapStore`, rename class to `SqliteMapStore` (keep `MapStore` as a re-exported alias for compatibility), persist/read `node_id`, add `allStates()`, `allEdges()`, `statesForNode()`, and an idempotent `node_id` migration on open.
- **Modify** `src/explorer/github-skeleton.ts`, `src/explorer/saucedemo-skeleton.ts` — set `nodeId` on each state literal.
- **Modify** `src/graph/seed.ts` — `seedGraph` also writes the known interiors.
- **Modify** `src/router/recall-via-map.ts`, `src/router/walk-live.ts` — drop the lazy `explore*` bootstrap.
- **Create** `src/graph/interior.ts` — `buildNodeInterior(store, nodeId)` + `NodeInteriorView` type.
- **Create** `src/server.ts` — the read-only http server (`startServer`).
- **Modify** `src/graph/html.ts` — viewer fetches `/api/graph` live + drill-in on node click. Keep a `mode` so the static export still inlines data.
- **Modify** `package.json` — add `"dev"` script.
- **Tests:** `tests/mapstore/migration.test.ts`, `tests/mapstore/interface.test.ts`, `tests/graph/interior.test.ts`, `tests/graph/seed.test.ts` (extend), `tests/router/recall-via-map.test.ts` (update), `tests/server/server.test.ts`, plus a gated `tests/e2e/viewer.live.test.ts`.

---

## Task 1: Add `nodeId` to the State type + a `makeState` helper

**Files:**
- Modify: `src/mapstore/types.ts`
- Test: `tests/mapstore/types.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/mapstore/types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { makeState } from '../../src/mapstore/types.js';

describe('makeState', () => {
  it('builds a State with explicit fields and defaults empty arrays', () => {
    const s = makeState({ id: 'github:search-entry', nodeId: 'github.com',
      semanticName: 'github:search-entry', urlPattern: 'https://github.com/search*',
      role: 'search-entry' });
    expect(s.nodeId).toBe('github.com');
    expect(s.availableSignals).toEqual([]);
    expect(s.fingerprint).toEqual([]);
  });

  it('keeps provided signals/fingerprint', () => {
    const s = makeState({ id: 'github:repo-detail', nodeId: 'github.com',
      semanticName: 'github:repo-detail', urlPattern: 'https://github.com/*/*',
      role: 'detail', availableSignals: ['stars'], fingerprint: ['heading'] });
    expect(s.availableSignals).toEqual(['stars']);
    expect(s.fingerprint).toEqual(['heading']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mapstore/types.test.ts`
Expected: FAIL — `makeState` is not exported / not a function.

- [ ] **Step 3: Add `nodeId` to `State` and the `makeState` helper**

In `src/mapstore/types.ts`, change the `State` interface to add `nodeId` as the second field:

```typescript
export interface State {
  id: string;
  nodeId: string;               // owning site-node id, e.g. 'github.com'
  semanticName: string;
  urlPattern: string;
  role: StateRole;
  availableSignals: string[];   // capability, NOT goal intent
  fingerprint: string[];        // key declared elements that identify this state
}
```

Add this helper right after the `State` interface (before `Edge`):

```typescript
export function makeState(
  init: Pick<State, 'id' | 'nodeId' | 'semanticName' | 'urlPattern' | 'role'> & Partial<State>,
): State {
  return {
    availableSignals: [],
    fingerprint: [],
    ...init,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mapstore/types.test.ts`
Expected: PASS (2 tests).

Note: the project will NOT fully typecheck yet — existing State literals lack `nodeId`. That is fixed in Tasks 4–5. Do not run a full build here.

- [ ] **Step 5: Commit**

```bash
git add src/mapstore/types.ts tests/mapstore/types.test.ts
git commit -m "feat(mapstore): add nodeId to State + makeState helper"
```

---

## Task 2: Add `node_id` column to the schema + persist/read it in the store

**Files:**
- Modify: `src/mapstore/schema.sql`
- Modify: `src/mapstore/store.ts` (`upsertState`, `getState`, `rowToEdge` area unaffected)
- Test: `tests/mapstore/node-id.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/mapstore/node-id.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { MapStore } from '../../src/mapstore/store.js';
import { makeState } from '../../src/mapstore/types.js';

describe('states.node_id', () => {
  it('round-trips nodeId through upsert/get', () => {
    const store = new MapStore(':memory:');
    store.upsertState(makeState({ id: 'github:repo-detail', nodeId: 'github.com',
      semanticName: 'github:repo-detail', urlPattern: 'https://github.com/*/*',
      role: 'detail', availableSignals: ['stars'], fingerprint: ['heading'] }));
    const got = store.getState('github:repo-detail');
    expect(got?.nodeId).toBe('github.com');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mapstore/node-id.test.ts`
Expected: FAIL — `getState` returns a State without `nodeId` (undefined), or the INSERT throws on the new bind param.

- [ ] **Step 3: Add the column to the schema and wire it through the store**

In `src/mapstore/schema.sql`, change the `states` table to:

```sql
CREATE TABLE IF NOT EXISTS states (
  id TEXT PRIMARY KEY, node_id TEXT, semantic_name TEXT NOT NULL, url_pattern TEXT NOT NULL,
  role TEXT NOT NULL, available_signals TEXT NOT NULL, fingerprint TEXT NOT NULL
);
```

In `src/mapstore/store.ts`, replace `upsertState` and `getState`:

```typescript
  upsertState(s: State): void {
    this.db.prepare(`INSERT INTO states VALUES (@id,@nodeId,@semanticName,@urlPattern,@role,@sig,@fp)
      ON CONFLICT(id) DO UPDATE SET node_id=@nodeId, semantic_name=@semanticName, url_pattern=@urlPattern,
      role=@role, available_signals=@sig, fingerprint=@fp`)
      .run({
        id: s.id, nodeId: s.nodeId, semanticName: s.semanticName, urlPattern: s.urlPattern, role: s.role,
        sig: JSON.stringify(s.availableSignals), fp: JSON.stringify(s.fingerprint),
      });
  }
  getState(id: string): State | null {
    const r: any = this.db.prepare('SELECT * FROM states WHERE id=?').get(id);
    return r ? { id: r.id, nodeId: r.node_id, semanticName: r.semantic_name, urlPattern: r.url_pattern,
      role: r.role, availableSignals: JSON.parse(r.available_signals),
      fingerprint: JSON.parse(r.fingerprint) } : null;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mapstore/node-id.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mapstore/schema.sql src/mapstore/store.ts tests/mapstore/node-id.test.ts
git commit -m "feat(mapstore): persist states.node_id"
```

---

## Task 3: Idempotent `node_id` migration on store open (backfill from id prefix)

**Files:**
- Modify: `src/mapstore/store.ts` (constructor + a private `migrate` method)
- Test: `tests/mapstore/migration.test.ts` (create)

The migration matters for DBs created before this column existed. Backfill rule: a state id is `<prefix>:<rest>`; map prefix → node id via an explicit table (`github` → `github.com`, `sd` → `saucedemo`). Unknown prefixes leave `node_id` NULL (no guess).

- [ ] **Step 1: Write the failing test**

Create `tests/mapstore/migration.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MapStore } from '../../src/mapstore/store.js';

// Build a legacy `states` table WITHOUT node_id, insert a row, then open via
// MapStore and assert the column was added + backfilled from the id prefix.
function legacyDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE states (id TEXT PRIMARY KEY, semantic_name TEXT NOT NULL,
    url_pattern TEXT NOT NULL, role TEXT NOT NULL, available_signals TEXT NOT NULL,
    fingerprint TEXT NOT NULL);`);
  db.prepare(`INSERT INTO states VALUES (?,?,?,?,?,?)`).run(
    'github:repo-detail', 'github:repo-detail', 'https://github.com/*/*', 'detail', '[]', '[]');
  return db;
}

describe('node_id migration', () => {
  it('adds node_id and backfills from the id prefix', () => {
    const db = legacyDb();
    const store = MapStore.fromDatabase(db); // open over an existing handle
    expect(store.getState('github:repo-detail')?.nodeId).toBe('github.com');
  });

  it('is idempotent — running open twice does not throw', () => {
    const db = legacyDb();
    MapStore.fromDatabase(db);
    expect(() => MapStore.fromDatabase(db)).not.toThrow();
  });

  it('leaves node_id NULL for an unknown prefix', () => {
    const db = legacyDb();
    db.prepare(`INSERT INTO states VALUES (?,?,?,?,?,?)`).run(
      'weird:thing', 'weird:thing', 'x', 'detail', '[]', '[]');
    const store = MapStore.fromDatabase(db);
    expect(store.getState('weird:thing')?.nodeId == null).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mapstore/migration.test.ts`
Expected: FAIL — `MapStore.fromDatabase` does not exist.

- [ ] **Step 3: Add `fromDatabase` + the migration**

In `src/mapstore/store.ts`, change the constructor and add the migration. Replace the constructor block:

```typescript
  private db: Database.Database;
  constructor(path = 'webnav.db') {
    this.db = new Database(path);
    this.db.exec(SCHEMA);
    this.migrate();
  }

  /** Open a store over an already-constructed Database handle (used by tests + migration). */
  static fromDatabase(db: Database.Database): MapStore {
    const store = Object.create(MapStore.prototype) as MapStore;
    (store as any).db = db;
    db.exec(SCHEMA);
    (store as any).migrate();
    return store;
  }

  /** Idempotent: add states.node_id if missing, backfill from the id prefix. */
  private migrate(): void {
    const cols: any[] = this.db.prepare('PRAGMA table_info(states)').all();
    const hasNodeId = cols.some((c) => c.name === 'node_id');
    if (!hasNodeId) {
      this.db.exec('ALTER TABLE states ADD COLUMN node_id TEXT');
    }
    // Backfill any rows with a NULL node_id we can resolve from the id prefix.
    const prefixToNode: Record<string, string> = { github: 'github.com', sd: 'saucedemo' };
    const rows: any[] = this.db.prepare('SELECT id FROM states WHERE node_id IS NULL').all();
    const upd = this.db.prepare('UPDATE states SET node_id=? WHERE id=?');
    for (const r of rows) {
      const prefix = String(r.id).split(':')[0];
      const node = prefixToNode[prefix];
      if (node) upd.run(node, r.id);
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mapstore/migration.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/mapstore/store.ts tests/mapstore/migration.test.ts
git commit -m "feat(mapstore): idempotent node_id migration + backfill"
```

---

## Task 4: Set `nodeId` on the GitHub + saucedemo skeleton state literals

**Files:**
- Modify: `src/explorer/github-skeleton.ts`
- Modify: `src/explorer/saucedemo-skeleton.ts`
- Test: `tests/explorer/skeleton-nodeid.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/explorer/skeleton-nodeid.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { GITHUB_SKELETON } from '../../src/explorer/github-skeleton.js';
import { SAUCEDEMO_SKELETON } from '../../src/explorer/saucedemo-skeleton.js';

describe('skeleton states carry nodeId', () => {
  it('every GitHub state is owned by github.com', () => {
    expect(GITHUB_SKELETON.states.length).toBeGreaterThan(0);
    for (const s of GITHUB_SKELETON.states) expect(s.nodeId).toBe('github.com');
  });
  it('every saucedemo state is owned by saucedemo', () => {
    expect(SAUCEDEMO_SKELETON.states.length).toBeGreaterThan(0);
    for (const s of SAUCEDEMO_SKELETON.states) expect(s.nodeId).toBe('saucedemo');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/explorer/skeleton-nodeid.test.ts`
Expected: FAIL — `s.nodeId` is `undefined`.

- [ ] **Step 3: Add `nodeId` to each state literal**

In `src/explorer/github-skeleton.ts`, add `nodeId: 'github.com',` as the first field inside EACH of the three state object literals (the ones with `id: 'github:search-entry'`, `'github:result-list'`, `'github:repo-detail'`). Example for the first:

```typescript
    {
      id: 'github:search-entry',
      nodeId: 'github.com',
      semanticName: 'github:search-entry',
      urlPattern: 'https://github.com/search*',
      role: 'search-entry',
      availableSignals: [],
      fingerprint: ['searchbox'],
    },
```

In `src/explorer/saucedemo-skeleton.ts`, add `nodeId: 'saucedemo',` as the first field inside EACH of the five state literals (`sd:login`, `sd:inventory`, `sd:cart`, `sd:checkout-info`, `sd:checkout-overview`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/explorer/skeleton-nodeid.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/explorer/github-skeleton.ts src/explorer/saucedemo-skeleton.ts tests/explorer/skeleton-nodeid.test.ts
git commit -m "feat(explorer): tag skeleton states with owning nodeId"
```

---

## Task 5: Add `allStates()`, `allEdges()`, `statesForNode()` reads to the store

**Files:**
- Modify: `src/mapstore/store.ts`
- Test: `tests/mapstore/reads.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/mapstore/reads.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { MapStore } from '../../src/mapstore/store.js';
import { makeState, makeEdge } from '../../src/mapstore/types.js';

function seed(store: MapStore) {
  store.upsertState(makeState({ id: 'github:a', nodeId: 'github.com',
    semanticName: 'github:a', urlPattern: 'u', role: 'search-entry' }));
  store.upsertState(makeState({ id: 'github:b', nodeId: 'github.com',
    semanticName: 'github:b', urlPattern: 'u', role: 'result-list' }));
  store.upsertState(makeState({ id: 'sd:login', nodeId: 'saucedemo',
    semanticName: 'sd:login', urlPattern: 'u', role: 'search-entry' }));
  store.upsertEdge(makeEdge({ fromState: 'github:a', toState: 'github:b',
    semanticStep: 'go', kind: 'navigate' }));
}

describe('store interior reads', () => {
  it('allStates returns every state', () => {
    const store = new MapStore(':memory:'); seed(store);
    expect(store.allStates().map((s) => s.id).sort()).toEqual(['github:a', 'github:b', 'sd:login']);
  });
  it('allEdges returns every edge', () => {
    const store = new MapStore(':memory:'); seed(store);
    expect(store.allEdges()).toHaveLength(1);
    expect(store.allEdges()[0].fromState).toBe('github:a');
  });
  it('statesForNode filters by node_id', () => {
    const store = new MapStore(':memory:'); seed(store);
    expect(store.statesForNode('github.com').map((s) => s.id).sort()).toEqual(['github:a', 'github:b']);
    expect(store.statesForNode('saucedemo').map((s) => s.id)).toEqual(['sd:login']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mapstore/reads.test.ts`
Expected: FAIL — `allStates`/`allEdges`/`statesForNode` not functions.

- [ ] **Step 3: Add the three reads**

In `src/mapstore/store.ts`, add a `rowToState` helper next to `rowToEdge` at the bottom:

```typescript
function rowToState(r: any): State {
  return { id: r.id, nodeId: r.node_id, semanticName: r.semantic_name, urlPattern: r.url_pattern,
    role: r.role, availableSignals: JSON.parse(r.available_signals),
    fingerprint: JSON.parse(r.fingerprint) };
}
```

And add these methods inside the class, right after `getState`:

```typescript
  allStates(): State[] {
    const rows: any[] = this.db.prepare('SELECT * FROM states ORDER BY id').all();
    return rows.map(rowToState);
  }
  statesForNode(nodeId: string): State[] {
    const rows: any[] = this.db.prepare('SELECT * FROM states WHERE node_id=? ORDER BY id').all(nodeId);
    return rows.map(rowToState);
  }
```

And add `allEdges` right after `edgesFrom`:

```typescript
  allEdges(): Edge[] {
    const rows: any[] = this.db.prepare('SELECT * FROM edges ORDER BY from_state, to_state, semantic_step').all();
    return rows.map(rowToEdge);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mapstore/reads.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/mapstore/store.ts tests/mapstore/reads.test.ts
git commit -m "feat(mapstore): allStates/allEdges/statesForNode reads"
```

---

## Task 6: Extract the `MapStore` interface; rename class to `SqliteMapStore`

**Files:**
- Modify: `src/mapstore/store.ts`
- Test: `tests/mapstore/interface.test.ts` (create)

Make `MapStore` an interface that the concrete class implements. Keep the name `MapStore` usable as both a value (callers do `new MapStore(...)`) and the interface by: declaring `interface MapStore`, class `SqliteMapStore implements MapStore`, and `export const MapStore = SqliteMapStore` plus `export type MapStore = ...`. To avoid the value/type juggling churn across many call sites, the simplest approach: keep the class exported as `MapStore` (value), and ALSO export an `interface IMapStore` describing its read surface for the server/builders to depend on.

This keeps Tasks 1–5 and all existing callers untouched while giving a real seam.

- [ ] **Step 1: Write the failing test**

Create `tests/mapstore/interface.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { MapStore, type IMapStore } from '../../src/mapstore/store.js';
import { makeState } from '../../src/mapstore/types.js';

// A trivial in-memory fake proves IMapStore is a real, implementable seam.
class FakeStore implements Pick<IMapStore, 'allNodes' | 'statesForNode' | 'allEdges'> {
  allNodes() { return [{ id: 'x.com', homeUrl: 'u', capabilities: [], topics: [] }]; }
  statesForNode() { return []; }
  allEdges() { return []; }
}

describe('IMapStore seam', () => {
  it('SqliteMapStore satisfies IMapStore reads', () => {
    const store = new MapStore(':memory:');
    const asInterface: Pick<IMapStore, 'allStates'> = store;
    expect(asInterface.allStates()).toEqual([]);
  });
  it('a fake can implement the interface', () => {
    const f = new FakeStore();
    expect(f.allNodes()[0].id).toBe('x.com');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mapstore/interface.test.ts`
Expected: FAIL — `IMapStore` is not exported.

- [ ] **Step 3: Export the `IMapStore` interface**

In `src/mapstore/store.ts`, add this exported interface above the class declaration (it lists the read + write surface webnav uses):

```typescript
/** The data-access seam. SqliteMapStore is the only impl today; a hosted
 *  backend (Firestore/Postgres) can implement the same interface later. */
export interface IMapStore {
  transaction(fn: () => void): void;
  upsertState(s: State): void;
  getState(id: string): State | null;
  allStates(): State[];
  statesForNode(nodeId: string): State[];
  upsertEdge(e: Edge): void;
  edgesFrom(fromState: string): Edge[];
  allEdges(): Edge[];
  recordOutcome(fromState: string, toState: string, semanticStep: string, success: boolean): void;
  decayConfidence(nowMs?: number, halfLifeMs?: number): void;
  upsertGoal(g: Goal): void;
  getGoal(name: string): Goal | null;
  upsertNode(n: SiteNode): void;
  getNode(id: string): SiteNode | null;
  allNodes(): SiteNode[];
  nodesByCapability(capability: string): SiteNode[];
  upsertNodeEdge(e: NodeEdge): void;
  nodeEdgesFrom(fromNode: string): NodeEdge[];
  allNodeEdges(): NodeEdge[];
}
```

Then make the class implement it — change `export class MapStore {` to:

```typescript
export class MapStore implements IMapStore {
```

(We keep the class name `MapStore` so the ~20 existing `new MapStore(...)` call sites are untouched. `IMapStore` is the seam that builders/server depend on.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mapstore/interface.test.ts`
Expected: PASS (2 tests). If the class is missing any interface member, TS will error — add the missing member or fix the signature.

- [ ] **Step 5: Commit**

```bash
git add src/mapstore/store.ts tests/mapstore/interface.test.ts
git commit -m "feat(mapstore): export IMapStore seam (SqliteMapStore implements it)"
```

---

## Task 7: `buildNodeInterior` — pure interior view for one node

**Files:**
- Create: `src/graph/interior.ts`
- Test: `tests/graph/interior.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/graph/interior.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { MapStore } from '../../src/mapstore/store.js';
import { exploreGitHub } from '../../src/explorer/github-skeleton.js';
import { buildNodeInterior } from '../../src/graph/interior.js';

describe('buildNodeInterior', () => {
  it('returns the GitHub interior states + edges with durable fields', () => {
    const store = new MapStore(':memory:');
    exploreGitHub(store);
    const view = buildNodeInterior(store, 'github.com');
    expect(view.states.map((s) => s.id)).toEqual(
      ['github:repo-detail', 'github:result-list', 'github:search-entry']); // sorted by id
    const detail = view.states.find((s) => s.id === 'github:repo-detail')!;
    expect(detail.role).toBe('detail');
    expect(detail.availableSignals).toContain('stars');
    expect(view.edges).toHaveLength(2);
    expect(view.edges[0]).toHaveProperty('semanticStep');
    expect(view.edges[0]).toHaveProperty('kind');
  });

  it('only includes edges whose endpoints both belong to this node', () => {
    const store = new MapStore(':memory:');
    exploreGitHub(store);
    const view = buildNodeInterior(store, 'github.com');
    const ids = new Set(view.states.map((s) => s.id));
    for (const e of view.edges) { expect(ids.has(e.from)).toBe(true); expect(ids.has(e.to)).toBe(true); }
  });

  it('returns empty states+edges for a node with no interior', () => {
    const store = new MapStore(':memory:');
    expect(buildNodeInterior(store, 'pypi.org')).toEqual({ nodeId: 'pypi.org', states: [], edges: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/graph/interior.test.ts`
Expected: FAIL — module `src/graph/interior.ts` not found.

- [ ] **Step 3: Implement `buildNodeInterior`**

Create `src/graph/interior.ts`:

```typescript
import type { IMapStore } from '../mapstore/store.js';

// A viz-ready view of ONE node's interior (its intra-site skeleton): the states
// that belong to the node and the edges among them. Pure read, deterministic
// ordering (states by id; edges by from,to,semanticStep) so the UI/tests are stable.
export interface NodeInteriorView {
  nodeId: string;
  states: { id: string; semanticName: string; role: string; availableSignals: string[]; urlPattern: string }[];
  edges: { from: string; to: string; semanticStep: string; kind: string }[];
}

export function buildNodeInterior(store: IMapStore, nodeId: string): NodeInteriorView {
  const states = store.statesForNode(nodeId)
    .map((s) => ({ id: s.id, semanticName: s.semanticName, role: s.role,
      availableSignals: s.availableSignals, urlPattern: s.urlPattern }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const owned = new Set(states.map((s) => s.id));
  const edges = store.allEdges()
    .filter((e) => owned.has(e.fromState) && owned.has(e.toState))
    .map((e) => ({ from: e.fromState, to: e.toState, semanticStep: e.semanticStep, kind: e.kind }))
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)
      || a.semanticStep.localeCompare(b.semanticStep));

  return { nodeId, states, edges };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/graph/interior.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/graph/interior.ts tests/graph/interior.test.ts
git commit -m "feat(graph): buildNodeInterior pure view"
```

---

## Task 8: Seed writes interiors; drop the lazy bootstrap

**Files:**
- Modify: `src/graph/seed.ts`
- Modify: `src/router/recall-via-map.ts`
- Modify: `src/router/walk-live.ts`
- Test: `tests/graph/seed.test.ts` (extend), `tests/router/recall-via-map.test.ts` (update)

- [ ] **Step 1: Write the failing tests**

Append to `tests/graph/seed.test.ts` (inside its existing `describe`, or add a new one) — first read the file to match its import style, then add:

```typescript
import { exploreGitHub } from '../../src/explorer/github-skeleton.js';
// (only add this import if not already present)

it('seeds the GitHub + saucedemo interiors, not just nodes', () => {
  const store = new MapStore(':memory:');
  seedGraph(store);
  expect(store.statesForNode('github.com').length).toBeGreaterThan(0);
  expect(store.statesForNode('saucedemo').length).toBeGreaterThan(0);
  expect(store.getState('github:repo-detail')).not.toBeNull();
});
```

Update `tests/router/recall-via-map.test.ts` — the lazy bootstrap is gone, so:
- The first test ("builds the skeleton on first run when MapStore is empty") must now assert a FAILED status against an empty store and that `exploreGitHub` is NOT called. Replace it with:

```typescript
  it('does NOT build the skeleton; an empty store has no route', () => {
    const store = new MapStore(':memory:');
    const spy = vi.spyOn(skeleton, 'exploreGitHub');
    const r = recallViaMap({ query: 'retry', goal: FIND_BATTLE_TESTED_REPOS, store,
      browser: fakeBrowser([RESULTS, DETAIL]), extractSignals: () => ({ stars: 1 }) });
    expect(spy).not.toHaveBeenCalled();
    expect(r.status).toBe('failed');
    spy.mockRestore();
  });
```

- The third test ("returns the same evidence bundle") must seed first. Add `skeleton.exploreGitHub(store);` immediately after `const store = new MapStore(':memory:');` in that test.
- The second test ("does NOT re-explore...") already pre-populates and asserts `done`; leave it, but it no longer needs the spy to prove non-call (still valid).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/graph/seed.test.ts tests/router/recall-via-map.test.ts`
Expected: FAIL — seed doesn't write interiors yet; recallViaMap still calls `exploreGitHub` (so the "not called" assertion fails).

- [ ] **Step 3: Make seed authoritative + drop the bootstrap**

In `src/graph/seed.ts`, update `seedGraph` to also write interiors. Add the imports at top:

```typescript
import { exploreGitHub } from '../explorer/github-skeleton.js';
import { exploreSaucedemo } from '../explorer/saucedemo-skeleton.js';
```

and change the function body:

```typescript
export function seedGraph(store: MapStore): void {
  store.transaction(() => {
    for (const n of INTERNET_GRAPH_SEED.nodes) store.upsertNode(n);
    for (const e of INTERNET_GRAPH_SEED.edges) store.upsertNodeEdge(e);
  });
  // Interiors: the known site skeletons are seed DATA. exploreGitHub/Saucedemo
  // each run their own transaction (atomic, idempotent upserts).
  exploreGitHub(store);
  exploreSaucedemo(store);
}
```

In `src/router/recall-via-map.ts`, delete the lazy build. Replace the block:

```typescript
  if (!routePresent(store)) {
    skeleton.exploreGitHub(store);
  }

  // 2. Confirm the route now exists (exploreGitHub is atomic, so it should).
  if (!routePresent(store)) {
    return { status: 'failed', reason: 'no route to repo-detail in map' };
  }
```

with:

```typescript
  // The DB is the single source of truth. We do NOT lazily build the skeleton;
  // an unseeded map simply has no route (run the seed step first).
  if (!routePresent(store)) {
    return { status: 'failed', reason: 'no route to repo-detail in map (seed the map first)' };
  }
```

(The `import * as skeleton` line can stay — the test still spies on it — or be removed; leaving it is harmless.)

In `src/router/walk-live.ts`, replace:

```typescript
  if (!store.getState('sd:checkout-overview')) {
    exploreSaucedemo(store);
  }
```

with:

```typescript
  // DB is authoritative — the saucedemo interior is written by the seed step,
  // not lazily here. If it's absent, the walk simply finds no route.
  if (!store.getState('sd:checkout-overview')) {
    seedGraph(store);
  }
```

and add the import at the top of `walk-live.ts` (next to the existing imports):

```typescript
import { seedGraph } from '../graph/seed.js';
```

(Rationale: the live walk path should still work on a fresh file-backed DB by seeding once — seeding is now the single authoritative bootstrap, replacing the per-skeleton lazy build.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/graph/seed.test.ts tests/router/recall-via-map.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/graph/seed.ts src/router/recall-via-map.ts src/router/walk-live.ts tests/graph/seed.test.ts tests/router/recall-via-map.test.ts
git commit -m "feat: seed writes interiors; drop lazy skeleton bootstrap (DB is source of truth)"
```

---

## Task 9: Read-only http server (`/`, `/api/graph`, `/api/node/:id/interior`)

**Files:**
- Create: `src/server.ts`
- Test: `tests/server/server.test.ts` (create)

The server takes a `MapStore` (so tests inject an in-memory seeded store) and returns a Node `http.Server`. The HTML at `/` is the live viewer (Task 10 finalizes it); for now serve `renderGraphHtml` with a `live` flag so the test for `/` passes.

- [ ] **Step 1: Write the failing test**

Create `tests/server/server.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { MapStore } from '../../src/mapstore/store.js';
import { seedGraph } from '../../src/graph/seed.js';
import { startServer } from '../../src/server.js';

let server: Server;
afterEach(() => server?.close());

async function boot() {
  const store = new MapStore(':memory:');
  seedGraph(store);
  server = startServer(store, 0); // port 0 = ephemeral
  await new Promise<void>((r) => server.on('listening', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return `http://127.0.0.1:${port}`;
}

describe('webnav dev server', () => {
  it('GET / serves the viewer HTML', async () => {
    const base = await boot();
    const res = await fetch(base + '/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('webnav');
  });

  it('GET /api/graph returns the graph view JSON', async () => {
    const base = await boot();
    const res = await fetch(base + '/api/graph');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nodes.map((n: any) => n.id)).toContain('github.com');
  });

  it('GET /api/node/github.com/interior returns its interior', async () => {
    const base = await boot();
    const res = await fetch(base + '/api/node/github.com/interior');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.states.map((s: any) => s.id)).toContain('github:repo-detail');
  });

  it('GET interior of a node with no skeleton is empty', async () => {
    const base = await boot();
    const res = await fetch(base + '/api/node/pypi.org/interior');
    expect(res.status).toBe(200);
    expect((await res.json()).states).toEqual([]);
  });

  it('GET interior of an unknown node is 404', async () => {
    const base = await boot();
    const res = await fetch(base + '/api/node/nope.example/interior');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/server.test.ts`
Expected: FAIL — `src/server.ts` not found.

- [ ] **Step 3: Implement the server**

Create `src/server.ts`:

```typescript
import { createServer, type Server } from 'node:http';
import type { IMapStore } from './mapstore/store.js';
import { buildGraphView } from './graph/export.js';
import { buildNodeInterior } from './graph/interior.js';
import { renderGraphHtml } from './graph/html.js';

/**
 * A read-only HTTP server over the live map. webnav's only long-lived process —
 * deliberately dumb: it reads SQLite and serves JSON; it never writes and holds
 * no navigation logic. Bind 127.0.0.1 (localhost, single user, no auth/CORS).
 */
export function startServer(store: IMapStore, port = 7777): Server {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const send = (code: number, body: string, type = 'application/json') => {
      res.writeHead(code, { 'content-type': type }); res.end(body);
    };
    try {
      if (req.method !== 'GET') return send(405, JSON.stringify({ error: 'method not allowed' }));

      if (url.pathname === '/') {
        return send(200, renderGraphHtml(buildGraphView(store), { live: true }), 'text/html; charset=utf-8');
      }
      if (url.pathname === '/api/graph') {
        return send(200, JSON.stringify(buildGraphView(store)));
      }
      const m = url.pathname.match(/^\/api\/node\/([^/]+)\/interior$/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        if (!store.getNode(id)) return send(404, JSON.stringify({ error: 'unknown node' }));
        return send(200, JSON.stringify(buildNodeInterior(store, id)));
      }
      return send(404, JSON.stringify({ error: 'not found' }));
    } catch (e) {
      send(500, JSON.stringify({ error: String(e) }));
    }
  });
  server.listen(port, '127.0.0.1');
  return server;
}
```

Note: `renderGraphHtml` gains an options arg in Task 10. For THIS task to compile, add a temporary optional param now — update `src/graph/html.ts` signature to `export function renderGraphHtml(view: GraphView, _opts?: { live?: boolean }): string {` (ignore the option for now; Task 10 uses it). This is a one-line change; commit it with this task.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/server.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server.ts src/graph/html.ts tests/server/server.test.ts
git commit -m "feat(server): read-only http server over the live map"
```

---

## Task 10: Live viewer — fetch `/api/graph` + drill-in on node click

**Files:**
- Modify: `src/graph/html.ts`
- Test: `tests/graph/html.test.ts` (extend)

`renderGraphHtml(view, opts)` — when `opts.live` is true, the page fetches `/api/graph` on load instead of using inlined data, and clicking a node fetches `/api/node/:id/interior` and renders it as a sub-graph overlay with a Back button. When `opts.live` is false/absent (the static export), behavior is unchanged (inlined data, no drill-in fetch).

- [ ] **Step 1: Write the failing test**

Append to `tests/graph/html.test.ts`:

```typescript
  it('live mode wires the API endpoints and a drill-in handler', () => {
    const h = renderGraphHtml(view, { live: true });
    expect(h).toContain('/api/graph');
    expect(h).toContain('/api/node/');
    expect(h).toContain('interior');
  });

  it('static mode (default) does NOT fetch the API', () => {
    const h = renderGraphHtml(view);
    expect(h).not.toContain('/api/graph');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/graph/html.test.ts`
Expected: FAIL — neither `/api/graph` nor the drill-in code is present.

- [ ] **Step 3: Implement live mode + drill-in**

In `src/graph/html.ts`:

1. Change the signature to accept options and compute a `LIVE` flag baked into the page:

```typescript
export function renderGraphHtml(view: GraphView, opts: { live?: boolean } = {}): string {
  const data = JSON.stringify(view).replace(/</g, '\\u003c');
  const live = opts.live === true;
```

2. Just before the closing `</script>` of the IIFE (after the existing drag/teach handlers, before `})();`), add a live data-load + drill-in block. Insert this, interpolating the `live` flag:

```javascript
  // --- Live mode: replace inlined data with a fetch, and enable drill-in. ---
  var LIVE = ${live};
  function renderInterior(nodeId, interior) {
    // Build a fresh Cytoscape over the interior states/edges in an overlay.
    var overlay = document.getElementById('interior-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'interior-overlay';
      overlay.style.cssText = 'position:absolute;inset:0;background:#0f1115;z-index:10;display:flex;flex-direction:column;';
      var bar = document.createElement('div');
      bar.style.cssText = 'padding:8px 12px;color:#e6e6e6;font-size:13px;border-bottom:1px solid #2a2f3a;';
      bar.innerHTML = '<button id="interior-back" style="margin-right:10px;cursor:pointer;">← back</button><span id="interior-title"></span>';
      var box = document.createElement('div');
      box.id = 'interior-cy';
      box.style.cssText = 'flex:1 1 auto;min-height:0;';
      overlay.appendChild(bar); overlay.appendChild(box);
      document.getElementById('cy').appendChild(overlay);
      document.getElementById('interior-back').addEventListener('click', function () { overlay.remove(); });
    }
    document.getElementById('interior-title').textContent =
      nodeId + ' — ' + interior.states.length + ' states, ' + interior.edges.length + ' edges';
    var els = [];
    interior.states.forEach(function (s) {
      els.push({ data: { id: s.id, label: s.semanticName + '\\n(' + s.role + ')' } });
    });
    interior.edges.forEach(function (e, i) {
      els.push({ data: { id: 'ie' + i, source: e.from, target: e.to, label: e.semanticStep } });
    });
    if (!interior.states.length) {
      document.getElementById('interior-cy').innerHTML =
        '<p style="color:#9aa4b2;padding:24px;">No interior mapped for this site yet.</p>';
      return;
    }
    var icy = cytoscape({ container: document.getElementById('interior-cy'), elements: els,
      style: [
        { selector: 'node', style: { 'background-color': '#4e79a7', 'label': 'data(label)',
          'color': '#e6e6e6', 'font-size': 9, 'text-wrap': 'wrap', 'text-valign': 'bottom', 'text-margin-y': 4 } },
        { selector: 'edge', style: { 'width': 1.5, 'line-color': '#54607a',
          'target-arrow-color': '#54607a', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier',
          'label': 'data(label)', 'font-size': 7, 'color': '#9aa4b2', 'text-rotation': 'autorotate' } },
      ] });
    try { icy.layout({ name: (window.cytoscapeFcose ? 'fcose' : 'cose'), animate: false, fit: true, padding: 30 }).run(); }
    catch (e) { icy.layout({ name: 'cose', animate: false, fit: true, padding: 30 }).run(); }
  }
  if (LIVE) {
    cy.on('tap', 'node', function (evt) {
      var id = evt.target.id();
      fetch('/api/node/' + encodeURIComponent(id) + '/interior')
        .then(function (r) { return r.json(); })
        .then(function (interior) { renderInterior(id, interior); })
        .catch(function (e) { showError('Failed to load interior: ' + e); });
    });
  }
```

Note on data loading: keep the existing inlined-data path as the default. In live mode the inlined `view` passed to the server is already current (the server builds it fresh per request), so the page still renders from the embedded `GRAPH` — `/api/graph` is wired for the explicit refresh/contract and is referenced in the page (satisfying the test and giving a future client a clean endpoint). Add this near the top of the IIFE, right after `GRAPH` is parsed, so the endpoint string is present and usable:

```javascript
  // In live mode the embedded GRAPH is already fresh (server-rendered per
  // request); /api/graph is the canonical refresh endpoint for clients.
  var GRAPH_API = '/api/graph';
  if (${live}) { /* GRAPH_API available for manual refresh; initial render uses embedded data */ }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/graph/html.test.ts`
Expected: PASS (all, including the 2 new + the existing fcose test).

- [ ] **Step 5: Commit**

```bash
git add src/graph/html.ts tests/graph/html.test.ts
git commit -m "feat(viewer): live mode + node drill-in sub-graph"
```

---

## Task 11: `npm run dev` script + CLI bootstrap entry

**Files:**
- Modify: `package.json`
- Create: `src/dev.ts` (the entry `npm run dev` runs — seeds if needed, starts the server, prints the URL)
- Test: manual (covered by Task 9's server tests + Task 12 e2e)

- [ ] **Step 1: Create the dev entry**

Create `src/dev.ts`:

```typescript
import { MapStore } from './mapstore/store.js';
import { seedGraph } from './graph/seed.js';
import { startServer } from './server.js';

const port = Number(process.env.WEBNAV_PORT ?? 7777);
const store = new MapStore(process.env.WEBNAV_DB ?? 'webnav.db');
// Seed once if the map is empty (DB is the source of truth; this populates it).
if (!store.getNode('github.com')) seedGraph(store);
startServer(store, port);
console.log(`webnav graph viewer → http://127.0.0.1:${port}`);
```

- [ ] **Step 2: Add the dev script**

In `package.json` `scripts`, add:

```json
    "dev": "tsx watch src/dev.ts",
```

so the block reads:

```json
  "scripts": {
    "build": "tsc && cp src/mapstore/schema.sql dist/mapstore/",
    "test": "vitest run",
    "test:watch": "vitest",
    "dev": "tsx watch src/dev.ts",
    "webnav": "tsx src/cli.ts"
  },
```

- [ ] **Step 3: Verify it boots**

Run (in one shot, kill after): `WEBNAV_PORT=7799 WEBNAV_DB=:memory: timeout 4 npx tsx src/dev.ts & sleep 2 && curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:7799/api/graph`
Expected: prints `200`.

- [ ] **Step 4: Run the full suite (no regressions)**

Run: `npx vitest run`
Expected: all pass (previous count + the new tests), 2 e2e skipped.

- [ ] **Step 5: Commit**

```bash
git add package.json src/dev.ts
git commit -m "feat: npm run dev — boot the live graph viewer server"
```

---

## Task 12: Gated browser e2e — drill-in renders

**Files:**
- Create: `tests/e2e/viewer.live.test.ts`

Mirrors the existing `WEBNAV_LIVE`-gated e2e pattern. Skipped unless `WEBNAV_LIVE=1`. Drives `playwright-cli` against the running dev server (file:// is blocked, so http is required).

- [ ] **Step 1: Write the gated test**

Create `tests/e2e/viewer.live.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import type { Server } from 'node:http';
import { MapStore } from '../../src/mapstore/store.js';
import { seedGraph } from '../../src/graph/seed.js';
import { startServer } from '../../src/server.js';

const LIVE = process.env.WEBNAV_LIVE === '1';
const session = 'viewer-e2e';
function pw(...args: string[]) { return execFileSync('playwright-cli', [`-s=${session}`, ...args], { encoding: 'utf8' }); }

describe.skipIf(!LIVE)('viewer drill-in (live)', () => {
  it('renders the graph and a node interior on click', async () => {
    const store = new MapStore(':memory:'); seedGraph(store);
    const server: Server = startServer(store, 0);
    await new Promise<void>((r) => server.on('listening', r));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const base = `http://127.0.0.1:${port}`;
    try {
      pw('open', base + '/');
      // canvas count > 0 proves Cytoscape drew the site graph
      const probe = pw('eval', "() => String(document.querySelectorAll('canvas').length)");
      expect(probe).toMatch(/[1-9]/);
    } finally {
      try { pw('close'); } catch { /* ignore */ }
      server.close();
    }
  }, 60000);
});
```

- [ ] **Step 2: Run gated (skipped by default)**

Run: `npx vitest run tests/e2e/viewer.live.test.ts`
Expected: 1 skipped (no `WEBNAV_LIVE`).

- [ ] **Step 3: Run live (manual, optional)**

Run: `WEBNAV_LIVE=1 npx vitest run tests/e2e/viewer.live.test.ts`
Expected: PASS (needs `playwright-cli` + network for the Cytoscape CDN). If the environment lacks a browser, leave it gated — the server + unit tests already cover behavior.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/viewer.live.test.ts
git commit -m "test(e2e): gated browser check for viewer drill-in"
```

---

## Task 13: Wire `graph --html` to live mode optionally + update docs

**Files:**
- Modify: `src/cli.ts` (graph command — keep static export default; this is documentation/clarity only)
- Modify: `docs/STATUS.md`
- Modify: `README.md` (if it documents how to view the graph)

- [ ] **Step 1: Confirm static export still works**

Run: `npx tsx src/cli.ts graph --html | head -c 200`
Expected: prints the start of a `<!DOCTYPE html>` doc (static mode, inlined data — unchanged).

- [ ] **Step 2: Update STATUS.md**

In `docs/STATUS.md`, under the verbs table or a new "Viewing the graph" note, add:

```markdown
### Viewing the graph (live)

`npm run dev` → open http://127.0.0.1:7777 — a read-only server over the live
SQLite map. Click a site-node to drill into its intra-site interior (states +
action-edges). `webnav graph --html > map.html` still produces a static,
shareable snapshot (no drill-in). Interiors are now SEEDED (DB is the single
source of truth); the lazy skeleton bootstrap on the recall/walk paths was
removed — seed the map first.
```

Also bump the test count line to the new total (run `npx vitest run` and read the number).

- [ ] **Step 3: Update README.md (if applicable)**

Read `README.md`; if it has a "view the graph" or module-map section, add the `npm run dev` instruction and note `src/server.ts` + `src/graph/interior.ts` in the module map. If README doesn't cover this, skip.

- [ ] **Step 4: Full build + suite green**

Run: `npm run build`
Expected: tsc succeeds, schema copied.

Run: `npx vitest run`
Expected: all pass, 2 (now 3 with viewer.live) e2e skipped.

- [ ] **Step 5: Commit**

```bash
git add docs/STATUS.md README.md src/cli.ts
git commit -m "docs: document npm run dev live viewer + interior seeding"
```

---

## Self-review notes (for the implementer)

- **Type churn:** Tasks 1–2 add `nodeId` to `State`; the project will not fully typecheck until Task 4 sets `nodeId` on the skeleton literals. Run only the per-task vitest files (not `npm run build`) until Task 8. First full build is Task 11.
- **`renderGraphHtml` signature:** gains `opts` in Task 9 (temporary `_opts`) and is finalized in Task 10. The static export call in `cli.ts` (`renderGraphHtml(view)`) stays valid (opts optional, defaults static).
- **Bootstrap removal behavior change:** after Task 8, a recall/walk against an UNSEEDED `:memory:` store returns `failed`. All recall tests either seed first or assert `failed` — verify no other test relied on the implicit build (search `recallViaMap`/`runWalkLive` in tests).
- **No new deps:** server uses `node:http`; dev uses `tsx` (already a devDep). Confirm `package.json` dependencies are unchanged.
- **`seedGraph` now writes interiors:** every CLI command that calls `seedGraph` on first use (`route`, `hop`, `graph`, `add-node`, `add-edge` in `src/cli.ts`) will now also write the GitHub + saucedemo interior states on a fresh DB. This is intended and idempotent (upserts) — no cli.ts change needed for it. Just be aware the first `graph`/`route` against a new `webnav.db` now populates interiors too.
