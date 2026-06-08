# Graph Quality + Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make in-page affordances first-class node data (badges, not self-loop edges), let the agent mark a core path (`Edge.core`) and author node capabilities/topics, render all of it cleanly in the viewer (affordance badges, emphasized core path, no connection dots), and remove the duplicate hand-seeded `saucedemo`/`sd:*` so saucedemo is a single agent-built `www.saucedemo.com` node.

**Architecture:** Add `State.affordances: string[]` + `Edge.core: boolean` (mirroring the prior `requiresAffordances` column work). `graph-edit` authors them + node `capabilities`/`topics`. The interior API exposes them; the viewer renders affordance badges in node boxes, styles core edges prominently, and drops the xyflow `Handle` dots. Delete `saucedemo-skeleton.ts` + its seeding; rewrite `walk.test.ts` onto an inline fixture; re-point the gated walk e2es to the agent-built graph. A Haiku agent re-authors saucedemo in the new model.

**Tech Stack:** TypeScript (strict), Node 18+ (run via Node 24 — `cd node_modules/better-sqlite3 && npx node-gyp rebuild` on ABI errors), `better-sqlite3`, vitest; `web/` Vite+React+@xyflow/react+elkjs; `playwright-cli` for gated e2e + the live viewer render. `webnav` is on PATH (`npm link`).

**Spec:** `docs/superpowers/specs/2026-06-08-graph-quality-and-viewer-design.md`

---

## Existing shapes this builds on (verified)

- `State` (`src/mapstore/types.ts`): `{id,nodeId,semanticName,urlPattern,role,availableSignals,fingerprint}`; `makeState` spreads `{availableSignals:[],fingerprint:[]}` then `...init`. `states` table columns match; `upsertState` uses named params; `rowToState` maps columns→State.
- `Edge` already has `requiresAffordances: string[]` (prior increment) with column `requires_affordances`, migration, round-trip — mirror that exactly for `core`.
- `MapStore.migrate()` already does idempotent `ALTER TABLE … ADD COLUMN` for states/goals/edges — extend it.
- `NodeInteriorView` (`src/graph/interior.ts`): `states:[{id,semanticName,role,availableSignals,urlPattern}]`, `edges:[{from,to,semanticStep,kind}]`.
- `editGraph` (`src/graph/edit.ts`): `EditState{label,urlPattern?,fingerprint?}`, `EditEdge{from,to,via,needsInput?,why?,requiresAffordances?}`; creates the node via `upsertNode({id,homeUrl:`https://${node}`,capabilities:[],topics:[]})`.
- Viewer: `InteriorView.tsx` builds `ln`/`le` from `iv`, calls `layoutGraph(ln,le,'interior')`, merges per-state meta into node data. `layout.ts` `LayoutEdge` + `rfEdges` styling (fork→dashed orange, associative→dotted). `StateNode.tsx`/`SiteNode.tsx` have `<Handle>` dots.
- `seed.ts`: imports `exploreSaucedemo`, has a `saucedemo` node literal (line ~23), calls `exploreSaucedemo(store)` (line ~44). `SAUCEDEMO_SKELETON`/`exploreSaucedemo` live in `src/explorer/saucedemo-skeleton.ts`.

---

## Task 1: `State.affordances` + `Edge.core` — model + persistence — TDD

**Files:**
- Modify: `src/mapstore/types.ts`, `src/mapstore/schema.sql`, `src/mapstore/store.ts`
- Test: `tests/mapstore/state-affordances-edge-core.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/mapstore/state-affordances-edge-core.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MapStore } from '../../src/mapstore/store.js';
import { makeState, makeEdge } from '../../src/mapstore/types.js';

function store(): MapStore { return MapStore.fromDatabase(new Database(':memory:')); }

describe('State.affordances + Edge.core', () => {
  it('round-trips State.affordances', () => {
    const s = store();
    s.upsertState(makeState({ id: 'n:a', nodeId: 'n', semanticName: 'a', urlPattern: '', role: 'detail',
      affordances: ['add to cart', 'open menu'] }));
    expect(s.getState('n:a')!.affordances).toEqual(['add to cart', 'open menu']);
  });

  it('State.affordances defaults to [] when absent', () => {
    const s = store();
    s.upsertState(makeState({ id: 'n:b', nodeId: 'n', semanticName: 'b', urlPattern: '', role: 'detail' }));
    expect(s.getState('n:b')!.affordances).toEqual([]);
  });

  it('round-trips Edge.core true/false', () => {
    const s = store();
    s.upsertState(makeState({ id: 'n:a', nodeId: 'n', semanticName: 'a', urlPattern: '', role: 'detail' }));
    s.upsertState(makeState({ id: 'n:b', nodeId: 'n', semanticName: 'b', urlPattern: '', role: 'detail' }));
    s.upsertEdge(makeEdge({ fromState: 'n:a', toState: 'n:b', semanticStep: 'go', kind: 'navigate', core: true }));
    s.upsertEdge(makeEdge({ fromState: 'n:a', toState: 'n:b', semanticStep: 'go2', kind: 'navigate' }));
    const edges = s.edgesFrom('n:a');
    expect(edges.find((e) => e.semanticStep === 'go')!.core).toBe(true);
    expect(edges.find((e) => e.semanticStep === 'go2')!.core).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mapstore/state-affordances-edge-core.test.ts`
Expected: FAIL — fields not on the model / not persisted.

- [ ] **Step 3: Add fields to `types.ts`**

`State` interface — add after `fingerprint`:
```typescript
  affordances: string[];        // in-page actions available here (node repertoire); [] = none
```
`makeState` defaults — add `affordances: []`:
```typescript
  return {
    availableSignals: [],
    fingerprint: [],
    affordances: [],
    ...init,
  };
```
`Edge` interface — add after `requiresAffordances`:
```typescript
  core: boolean;                // on the main/core path (agent-declared); default false
```
`makeEdge` defaults — add `core: false` (alongside `requiresAffordances: []`).

- [ ] **Step 4: Add columns + migration + round-trip in `schema.sql`/`store.ts`**

`schema.sql` — `states` table: add `, affordances TEXT` after `fingerprint TEXT`:
```sql
  role TEXT NOT NULL, available_signals TEXT NOT NULL, fingerprint TEXT NOT NULL, affordances TEXT
```
`edges` table: add `core INTEGER` (before `UNIQUE(...)`):
```sql
  requires_affordances TEXT, core INTEGER,
  UNIQUE(from_state, to_state, semantic_step)
```

`store.ts` `migrate()` — add (alongside the existing edges-column block):
```typescript
    const scols: any[] = this.db.prepare('PRAGMA table_info(states)').all();
    if (!scols.some((c) => c.name === 'affordances')) {
      this.db.exec('ALTER TABLE states ADD COLUMN affordances TEXT');
    }
    const ecols2: any[] = this.db.prepare('PRAGMA table_info(edges)').all();
    if (!ecols2.some((c) => c.name === 'core')) {
      this.db.exec('ALTER TABLE edges ADD COLUMN core INTEGER');
    }
```

`upsertState` — add `affordances` to columns/VALUES/SET + run object:
- columns: `...available_signals,fingerprint,affordances)`
- VALUES: `...@sig,@fp,@aff)`
- ON CONFLICT SET: add `, affordances=@aff`
- run object: add `aff: JSON.stringify(s.affordances ?? [])`

`rowToState` — add: `affordances: r.affordances ? JSON.parse(r.affordances) : [],`

`upsertEdge` — add `core` to columns/VALUES/SET + run object:
- columns: `...requires_affordances,core)`
- VALUES: `...@requiresAffordances,@core)`
- ON CONFLICT SET: add `, core=@core`
- run object: add `core: e.core ? 1 : 0`

`rowToEdge` — add to the `makeEdge({...})` init: `core: r.core === 1,`

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/mapstore/state-affordances-edge-core.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Run existing mapstore tests (back-compat)**

Run: `npx vitest run tests/mapstore`
Expected: PASS — new columns nullable; legacy rows default `[]`/`false`.

- [ ] **Step 7: Commit**

```bash
git add src/mapstore/types.ts src/mapstore/schema.sql src/mapstore/store.ts tests/mapstore/state-affordances-edge-core.test.ts
git commit -m "feat(mapstore): State.affordances + Edge.core (node repertoire + core-path flag)"
```

---

## Task 2: `graph-edit` authors affordances, core, and node metadata — TDD

**Files:**
- Modify: `src/graph/edit.ts`
- Test: extend `tests/graph/edit.test.ts`

- [ ] **Step 1: Read `src/graph/edit.ts`**

Note `EditState`, `EditEdge`, `EditGraph`, and the `editGraph(store, node, graph)` body: where it `upsertNode(...)` (creating the node) and the `for` loops that `upsertState(makeState({...}))` / `upsertEdge(makeEdge({...}))`.

- [ ] **Step 2: Write the failing test**

Add to `tests/graph/edit.test.ts` (match existing imports — `MapStore.fromDatabase`, `editGraph`, `Database`):

```typescript
  it('authors affordances on a state, core on an edge, and node capabilities/topics', () => {
    const store = MapStore.fromDatabase(new Database(':memory:'));
    editGraph(store, 'shop.example', {
      node: { capabilities: ['shopping-demo'], topics: ['shopping', 'demo'] },
      states: [{ label: 'inventory', affordances: ['add to cart', 'open menu'] }, { label: 'cart' }],
      edges: [{ from: 'inventory', to: 'cart', via: 'open cart', core: true }],
    });
    expect(store.getState('shop.example:inventory')!.affordances).toEqual(['add to cart', 'open menu']);
    expect(store.edgesFrom('shop.example:inventory')[0].core).toBe(true);
    const node = store.getNode('shop.example')!;
    expect(node.capabilities).toEqual(['shopping-demo']);
    expect(node.topics).toEqual(['shopping', 'demo']);
  });

  it('does not clobber existing node capabilities when node metadata is omitted', () => {
    const store = MapStore.fromDatabase(new Database(':memory:'));
    editGraph(store, 'shop.example', { node: { capabilities: ['x'], topics: ['y'] }, states: [{ label: 'a' }], edges: [] });
    editGraph(store, 'shop.example', { states: [{ label: 'b' }], edges: [] }); // no node block
    expect(store.getNode('shop.example')!.capabilities).toEqual(['x']);
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/graph/edit.test.ts`
Expected: FAIL — `affordances`/`core`/`node` not handled.

- [ ] **Step 4: Implement in `edit.ts`**

- `EditState`: add `affordances?: string[]`.
- `EditEdge`: add `core?: boolean`.
- `EditGraph`: add `node?: { capabilities?: string[]; topics?: string[] }`.
- In the state loop's `makeState({...})`: add `affordances: s.affordances ?? []`.
- In the edge loop's `makeEdge({...})`: add `core: e.core ?? false`.
- Node creation/metadata: replace the bare `upsertNode` with one that honors supplied metadata without clobbering on update:
```typescript
    const existing = store.getNode(node);
    store.upsertNode({
      id: node,
      homeUrl: existing?.homeUrl ?? `https://${node}`,
      capabilities: graph.node?.capabilities ?? existing?.capabilities ?? [],
      topics: graph.node?.topics ?? existing?.topics ?? [],
    });
```
(Place this where the node is currently created — it now runs whether or not the node exists, so the node always reflects supplied metadata, and omitting `node` preserves existing values.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/graph/edit.test.ts`
Expected: PASS (existing + 2 new).

- [ ] **Step 6: Commit**

```bash
git add src/graph/edit.ts tests/graph/edit.test.ts
git commit -m "feat(graph): graph-edit authors affordances, core flag, and node capabilities/topics"
```

---

## Task 3: Interior API exposes `affordances` + `core` — TDD

**Files:**
- Modify: `src/graph/interior.ts`
- Test: extend `tests/graph/interior.test.ts` (or create if absent)

- [ ] **Step 1: Read `src/graph/interior.ts`**

Note `NodeInteriorView` + `buildNodeInterior` (maps states→{id,semanticName,role,availableSignals,urlPattern}, edges→{from,to,semanticStep,kind}).

- [ ] **Step 2: Write the failing test**

Add to `tests/graph/interior.test.ts` (match its imports; uses `MapStore.fromDatabase`, `buildNodeInterior`, and likely `editGraph` or direct upserts):

```typescript
  it('exposes affordances per state and core per edge', () => {
    const store = MapStore.fromDatabase(new Database(':memory:'));
    store.upsertNode({ id: 'shop.example', homeUrl: 'https://shop.example', capabilities: [], topics: [] });
    store.upsertState(makeState({ id: 'shop.example:inv', nodeId: 'shop.example', semanticName: 'inv', urlPattern: '', role: 'detail', affordances: ['add to cart'] }));
    store.upsertState(makeState({ id: 'shop.example:cart', nodeId: 'shop.example', semanticName: 'cart', urlPattern: '', role: 'detail' }));
    store.upsertEdge(makeEdge({ fromState: 'shop.example:inv', toState: 'shop.example:cart', semanticStep: 'open cart', kind: 'navigate', core: true }));
    const iv = buildNodeInterior(store, 'shop.example');
    expect(iv.states.find((s) => s.semanticName === 'inv')!.affordances).toEqual(['add to cart']);
    expect(iv.edges[0].core).toBe(true);
  });
```

(Ensure `makeState`/`makeEdge` are imported in the test.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/graph/interior.test.ts`
Expected: FAIL — `affordances`/`core` not in the interior view.

- [ ] **Step 4: Implement in `interior.ts`**

- `NodeInteriorView.states[]` type: add `affordances: string[]`.
- `NodeInteriorView.edges[]` type: add `core: boolean`.
- In `buildNodeInterior`, the states `.map`: add `affordances: s.affordances`.
- The edges `.map`: add `core: e.core`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/graph/interior.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/graph/interior.ts tests/graph/interior.test.ts
git commit -m "feat(graph): interior view exposes state affordances + edge core flag"
```

---

## Task 4: Viewer — affordance badges, core-path emphasis, remove dots

**Files:**
- Modify: `web/src/nodes/StateNode.tsx`, `web/src/nodes/SiteNode.tsx`, `web/src/InteriorView.tsx`, `web/src/layout.ts`
- Test: `web/src/layout.test.ts` (extend — pure mapping); live render is the visual gate

- [ ] **Step 1: Extend `layout.ts` to carry `core` on edges**

In `web/src/layout.ts`, `LayoutEdge` interface — add `core?: boolean;`. In `rfEdges` mapping, style core edges prominently and non-core faded. Replace the existing `rfEdges` block with:
```typescript
  const rfEdges: Edge[] = edges.map((e) => {
    const core = e.core === true;
    const color = e.fork ? '#c2410c' : core ? '#1d4ed8' : '#94a3b8';
    const dashed = e.fork ? '6 4' : e.associative ? '2 4' : undefined;
    return {
      id: e.id, source: e.source, target: e.target,
      data: { fork: e.fork, core },
      animated: e.fork,
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 18, height: 18 },
      style: { stroke: color, strokeWidth: core ? 2.5 : 1, opacity: core || e.fork ? 1 : 0.55,
        ...(dashed ? { strokeDasharray: dashed } : {}) },
    };
  });
```
(Core = thick blue, full opacity; non-core = thin grey, faded — the core path stands out, branches recede.)

- [ ] **Step 2: Add a `layout.test.ts` assertion for core styling**

Add to `web/src/layout.test.ts`:
```typescript
  it('styles a core edge thicker/full-opacity vs a faded non-core edge', async () => {
    const nodes = [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }, { id: 'c', label: 'c' }];
    const edges = [
      { id: 'e1', source: 'a', target: 'b', fork: false, core: true },
      { id: 'e2', source: 'a', target: 'c', fork: false, core: false },
    ];
    const out = await layoutGraph(nodes, edges as any, 'interior');
    const core = out.edges.find((e) => e.id === 'e1')!;
    const non = out.edges.find((e) => e.id === 'e2')!;
    expect((core.style as any).strokeWidth).toBeGreaterThan((non.style as any).strokeWidth);
    expect((non.style as any).opacity).toBeLessThan(1);
  });
```

- [ ] **Step 3: Run the layout test**

Run: `cd web && npx vitest run src/layout.test.ts && cd ..`
Expected: PASS (existing + new).

- [ ] **Step 4: Remove dots + render affordance badges in `StateNode.tsx`**

Replace `web/src/nodes/StateNode.tsx` with:
```tsx
import { type NodeProps } from '@xyflow/react';

export function StateNode({ data }: NodeProps) {
  const d = data as { label: string; role?: string; signals?: string[]; affordances?: string[] };
  return (
    <div style={{ border: '1px solid #475569', borderRadius: 8, background: '#f8fafc',
      padding: '8px 12px', minWidth: 150, fontFamily: 'sans-serif' }}>
      <div style={{ fontWeight: 600, fontSize: 13 }}>{d.label}</div>
      {d.role ? <div style={{ fontSize: 10, color: '#64748b' }}>{d.role}</div> : null}
      {d.affordances?.length ? (
        <div style={{ marginTop: 4, display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          {d.affordances.map((a) => (
            <span key={a} style={{ fontSize: 9, background: '#e0e7ff', color: '#3730a3',
              borderRadius: 4, padding: '1px 5px' }}>{a}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```
(Removed both `<Handle>` imports/elements — no more dots; added affordance chips. Edges still render between nodes via xyflow's default connection even without explicit handles.)

NOTE: if edges fail to render without handles in @xyflow/react v12, restore the two `<Handle>` elements but add `style={{ opacity: 0 }}` to each so the dots are invisible but connection points remain. Try the no-handle version first; if the live render (Step 7) shows no edges, switch to invisible handles. Report which you used.

- [ ] **Step 5: Remove dots in `SiteNode.tsx`**

In `web/src/nodes/SiteNode.tsx`, do the same: remove the `<Handle>` elements (or make them `opacity:0` if edges disappear). Keep the rest (capability chips).

- [ ] **Step 6: Pass `affordances` + `core` into the view data in `InteriorView.tsx`**

In `web/src/InteriorView.tsx`, update the `le` and node-meta merge:
```typescript
      const le = iv.edges.map((e, i) => ({ id: `e${i}`, source: e.from, target: e.to, fork: isForkEdge(e), core: (e as any).core === true }));
      const laid = await layoutGraph(ln, le, 'interior');
      const meta = new Map(iv.states.map((s) => [s.id, s]));
      setNodes(laid.nodes.map((nd) => {
        const s = meta.get(nd.id);
        return { ...nd, data: { ...nd.data, role: s?.role, signals: (s as any)?.availableSignals, affordances: (s as any)?.affordances } };
      }));
```
(Also: the `web/src/types.ts` re-exported `NodeInteriorView` now carries `affordances`/`core` from Task 3 — the `as any` casts can be dropped if types flow through; keep them if tsc complains about the web-side type lag.)

- [ ] **Step 7: Build web + live render gate (playwright-cli headless)**

Run: `cd web && npm run build && cd ..`
Expected: builds clean.

Then verify the render against a graph that HAS affordances + a core edge. Use the agent-built saucedemo if present, else a quick `graph-edit` to seed one:
```bash
export WEBNAV_DB=/tmp/viewer-check.db; rm -f "$WEBNAV_DB"
webnav dev graph-edit --node shop.example --graph '{"node":{"capabilities":["shopping-demo"],"topics":["shop"]},"states":[{"label":"login"},{"label":"inventory","affordances":["add to cart","open menu","sort"]},{"label":"cart"}],"edges":[{"from":"login","to":"inventory","via":"login","core":true},{"from":"inventory","to":"cart","via":"open cart","core":true,"requiresAffordances":["add to cart"]}]}'
WEBNAV_DB=/tmp/viewer-check.db WEBNAV_PORT=7799 node dist/dev.js >/dev/null 2>&1 &  # or `webnav` has no server; use node dist/dev.js (needs build) OR npm run dev
sleep 2
playwright-cli -s=vq open "http://127.0.0.1:7799/" >/dev/null 2>&1; sleep 2
# drill into shop.example, then assert: affordance text present, no handle dots
playwright-cli -s=vq eval "() => { const n=[...document.querySelectorAll('.react-flow__node')].find(e=>/shop\.example/i.test(e.textContent||'')); n&&n.click(); return !!n }" >/dev/null 2>&1; sleep 1.5
playwright-cli -s=vq eval "() => JSON.stringify({ affordanceText: document.body.innerText.includes('add to cart'), handleDots: document.querySelectorAll('.react-flow__handle').length, edges: document.querySelectorAll('.react-flow__edge').length })"
playwright-cli -s=vq close >/dev/null 2>&1; kill %1 2>/dev/null; rm -f "$WEBNAV_DB"
```
Expected: `affordanceText:true`, `handleDots:0` (or low if invisible-handle fallback), `edges` > 0. The server needs `dist/` — run `npm run build` first (the `dev.js` server uses dist). If edges are 0 with no handles, switch StateNode/SiteNode to invisible handles (Step 4 note) and re-verify. Inspect once more if unsure.

- [ ] **Step 8: Commit**

```bash
git add web/src/nodes/StateNode.tsx web/src/nodes/SiteNode.tsx web/src/InteriorView.tsx web/src/layout.ts web/src/layout.test.ts
git commit -m "feat(web): affordance badges in nodes, core-path emphasis, remove connection dots"
```

---

## Task 5: Remove the seeded saucedemo/`sd:*` + rebuild walk tests on fixtures

**Files:**
- Modify: `src/graph/seed.ts` (remove saucedemo node + exploreSaucedemo)
- Delete: `src/explorer/saucedemo-skeleton.ts`, `tests/explorer/saucedemo-skeleton.test.ts`
- Modify: `tests/router/walk.test.ts` (inline fixture), `src/router/walk-live.ts` + `tests/e2e/walk.live.test.ts` + `tests/e2e/walk-affordance.live.test.ts` (re-point), `tests/explorer/skeleton-nodeid.test.ts` (if it references sd:*)

- [ ] **Step 1: Find every reference to the seeded saucedemo**

Run: `grep -rln "SAUCEDEMO_SKELETON\|exploreSaucedemo\|saucedemo-skeleton\|'saucedemo'\|sd:login\|sd:inventory\|sd:cart\|sd:checkout" src tests`
Note each. The consumers: `seed.ts`, `walk-live.ts`, `walk.test.ts`, `walk.live.test.ts`, `walk-affordance.live.test.ts`, `skeleton-nodeid.test.ts`, and the skeleton + its test.

- [ ] **Step 2: Remove from `seed.ts`**

In `src/graph/seed.ts`: delete the `import { exploreSaucedemo }` line, delete the `{ id: 'saucedemo', homeUrl: 'https://www.saucedemo.com', ... }` node literal from the seed nodes array, and delete the `exploreSaucedemo(store)` call. (Leave github.com/pypi.org/marginalia/duckduckgo nodes.)

- [ ] **Step 3: Delete the skeleton + its test**

Run: `git rm src/explorer/saucedemo-skeleton.ts tests/explorer/saucedemo-skeleton.test.ts`

- [ ] **Step 4: Rewrite `tests/router/walk.test.ts` onto an inline fixture**

Replace its `SAUCEDEMO_SKELETON`/`exploreSaucedemo` usage with a self-contained fixture built inline (mirror `tests/router/walk-affordance.test.ts`'s `setup()` pattern: `MapStore.fromDatabase(new Database(':memory:'))`, `upsertState`/`upsertEdge` a small login→inventory→cart→checkout chain with fingerprints and a `requiresAffordances` gate, and a scripted `WalkBrowser`). Keep the SAME behavioral assertions the file currently makes (e.g. the affordance-gate pause, the no-pause case) but against the inline fixture, NOT the seeded skeleton. Read the current file first; preserve each test's intent, swap the graph source. If a test specifically asserted seeded `sd:*` ids, change them to the fixture's ids.

- [ ] **Step 5: Re-point `walk-live.ts` + the gated walk e2es**

- `src/router/walk-live.ts`: it imports `SAUCEDEMO_SKELETON` and references `sd:*`. Since the skeleton is gone, `runWalkLive` must seed its own inline saucedemo states/edges into the store (move the minimal needed states+edges inline into `walk-live.ts`, OR have `runWalkLive` accept a pre-seeded store). Simplest: inline a `seedSaucedemoForWalk(store)` helper in `walk-live.ts` that upserts the `www.saucedemo.com` page-states + edges (login→inventory→cart→checkout-info→checkout-overview, with the add-to-cart `requiresAffordances` gate and login `needsInput`), node id `www.saucedemo.com`, state ids `www.saucedemo.com:login` etc. Use that instead of the deleted skeleton.
- `tests/e2e/walk.live.test.ts` + `tests/e2e/walk-affordance.live.test.ts`: update the start/goal state ids from `sd:login`/`sd:checkout-overview` to `www.saucedemo.com:login`/`www.saucedemo.com:checkout-overview` and seed via the new `walk-live.ts` helper (or `seedGraph` no longer has saucedemo, so they must seed the inline fixture). Keep the assertions (login → pause at add-to-cart affordance).
- `tests/explorer/skeleton-nodeid.test.ts`: if it asserts `sd:*` node-id backfill, update it to not depend on the removed skeleton (it may test github states only — check; adjust minimally).

- [ ] **Step 6: Run the affected suites**

Run: `npx vitest run tests/router tests/explorer tests/graph/seed.test.ts`
Expected: PASS. (`grep -rn "sd:login\|SAUCEDEMO_SKELETON" src tests` should now return nothing except possibly walk-live's inline helper if you named states differently — verify no dangling import.)

- [ ] **Step 7: Full suite + build**

Run: `npx vitest run` — Expected: all pass, gated e2e skipped.
Run: `npm run build` — Expected: tsc OK (no import of the deleted skeleton).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: remove seeded saucedemo/sd:* skeleton; walk tests use inline fixtures (saucedemo is now agent-built only)"
```

---

## Task 6: Agent re-authors saucedemo in the new model (acceptance) + STATUS

**Files:**
- Modify: `docs/STATUS.md`
- (The agent run mutates `webnav.db` — controller-run, not committed code.)

- [ ] **Step 1: Clear the old agent graph + re-author via a Haiku subagent**

The controller dispatches a Haiku subagent (per the subagent-model rule) to re-map saucedemo into the new model, persisting to `webnav.db`. The agent: `record-start` → drive saucedemo via `webnav use navigate/snapshot/click/type` → `record-stop` → `graph-analyse` → author with `graph-edit --node www.saucedemo.com --graph '<json>'` where the JSON has: `node.capabilities`/`topics` set; each state's `affordances` (inventory: add-to-cart/menu/sort; product-detail: remove; etc.); navigation `edges` with `core: true` on login→inventory→cart→checkout-info→checkout-overview; NO self-loop edges. Then `graph-show --node www.saucedemo.com` to confirm. (First clear any prior `www.saucedemo.com` states/edges so it's a clean re-author.)

- [ ] **Step 2: Verify the persisted graph (controller)**

Run: `webnav dev graph-show --node www.saucedemo.com` and confirm: one node with capabilities/topics; states carry `affordances`; the login→…→checkout edges have `core:true`; no `from===to` self-loop edges; old `saucedemo`/`sd:*` are gone (`webnav dev graph` lists only `www.saucedemo.com` for saucedemo).

- [ ] **Step 3: Live viewer confirmation (controller)**

`npm run build` (server uses dist) → start the viewer over `webnav.db` → playwright-cli headless: drill into `www.saucedemo.com`, assert affordance badges show, no handle dots, core edges visually distinct. Screenshot/eval as in Task 4 Step 7.

- [ ] **Step 4: Update STATUS.md**

Add a section noting: affordances are node-data badges; `Edge.core` marks the agent-declared core path; viewer shows badges + emphasized core path + no dots; the hand-seeded saucedemo/`sd:*` is removed (saucedemo is agent-built `www.saucedemo.com`); walk tests use inline fixtures. Bump the test count. Note the remaining: a fresh clone's `webnav.db` has no saucedemo until an agent maps it (seed no longer ships it).

- [ ] **Step 5: Full suite + build green, commit**

Run: `npx vitest run` + `npm run build` — Expected: green.
```bash
git add docs/STATUS.md
git commit -m "docs: graph quality + viewer done (affordances, core path, node hygiene, saucedemo agent-built)"
```

---

## Self-review notes (for the implementer)

- **`Edge.core` mirrors `requiresAffordances` exactly** (column, migration, round-trip) — the prior increment is the template; follow it.
- **Don't clobber node metadata on update** (Task 2): `editGraph` preserves existing `capabilities`/`topics` when the `node` block is omitted; only sets/creates with supplied values.
- **Zero-LLM held:** affordances, core, and node caps/topics are all authored by the agent via `graph-edit` — webnav never infers them. The viewer only renders.
- **No self-loops:** the re-authored saucedemo (Task 6) must NOT emit `from===to` edges — in-page actions go in `State.affordances`. The pathfinder/walk stay edge-only.
- **Viewer handles caveat** (Task 4): try removing `<Handle>` outright; if edges vanish in @xyflow/react v12, use invisible (`opacity:0`) handles instead. The live render (Step 7) is the gate.
- **The walk engine is untouched** — only test fixtures + `walk-live.ts`'s seed helper + the start/goal ids in the gated e2es change. `walkRoute`/`findPath`/`walk-session` unchanged.
- **Native module:** ABI mass-fail → `cd node_modules/better-sqlite3 && npx node-gyp rebuild && cd ../..`.
```
