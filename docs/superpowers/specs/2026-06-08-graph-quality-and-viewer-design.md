# Graph Quality + Viewer (affordances, core path, node hygiene) — Design

**Date:** 2026-06-08 · **Status:** approved (brainstorm complete) · **Increment:** graph-quality-and-viewer

## Problem

After an agent exhaustively mapped saucedemo, three issues surfaced in the live graph + viewer:

1. **Affordances are invisible.** In-page actions (add-to-cart, menu, sort, Remove) were authored as **self-loop edges** (`inventory→inventory`) — they don't show in the viewer, render badly as loops, and pollute the navigation graph the walk/pathfinder traverse.
2. **The viewer graph is hard to read.** No emphasis on the main journey — every edge looks equal, so the core path (login→checkout) is lost among back-edges and branches. The node boxes also show stray connection **dots** (xyflow `Handle`s).
3. **Duplicate/blank saucedemo node.** Two saucedemo sites appear: the hand-seeded `saucedemo` (vanity id, with `sd:*` skeleton) and the agent-built `www.saucedemo.com` (host id, but **blank capabilities/topics**). Root cause: (a) no canonical node-id rule (seed uses vanity names, agent derives the host), and (b) the agent never authored node metadata (`editGraph` creates bare nodes).

## Decisions (settled in brainstorm)

- **Q1=A** — the **agent declares the core path** (it knows the main journey). 
- **Q2=A** — in-page affordances appear as **badges on the node**, not self-loop edges.
- **Q3=A** — affordances are a real **`State.affordances: string[]`** field (node's repertoire), not edges. No self-loops in the graph.
- **Q4=A** — the core path is a **`Edge.core: boolean`** flag on each main-journey edge (the path emerges from core edges; no separate stored path entity).
- **Q5=A** — the **agent re-authors saucedemo** into the new model (dogfood), not a migration script.
- **Q6=A** — the **agent-built graph is canonical**; the hand-seeded `saucedemo`/`sd:*` skeleton is **removed**. Saucedemo graduates from hand-seeded to a learned site.
- **Q7=B** — node id = **the full host as-is** (`www.saucedemo.com`, `github.com`, `pypi.org`) — exactly what `graph-analyse` derives from a URL. No vanity ids, no `www.`-stripping rule. The seed stops inventing ids.

## Scope

This is a cohesive "graph quality + viewer" increment touching: State/Edge schema (`affordances`, `core`), `graph-edit` (author node metadata + the new fields), the interior API (expose them), the viewer (badges, core-path emphasis, remove dots), and the agent re-authoring saucedemo as the single canonical `www.saucedemo.com` node.

**In scope (decided in review — Q-followup=B):** removing the seeded `saucedemo`/`sd:*` skeleton breaks tests that depend on it, so this increment also: (a) **deletes `SAUCEDEMO_SKELETON` + its seeding**; (b) **rewrites `tests/router/walk.test.ts`** onto a self-contained fixture graph (the pattern `walk-affordance.test.ts`/`walk-path.test.ts` already use — build states/edges inline, no seeded skeleton); (c) **re-points the gated walk e2es** (`walk.live.test.ts`, `walk-affordance.live.test.ts`) to the agent-built `www.saucedemo.com` graph in `webnav.db` (or seeds a tiny inline saucedemo fixture for them). Saucedemo becomes purely a learned site — no hand-authored skeleton anywhere. The walk *engine* is unchanged; only the test fixtures + which graph the live demos walk change.

## Invariants

- **Zero-LLM / agent decides (#5a):** node capabilities/topics, affordances, and which edges are "core" are all **judgment** → authored by the agent via `graph-edit`, never inferred by webnav. The viewer only *renders* what's authored.
- **Affordance model:** in-page actions are a node's repertoire (`State.affordances`); navigation edges stay edges; the pathfinder/walk see only navigation edges (no self-loops).
- **Node id = host:** one site = one node id = its host. webnav never invents vanity ids.

## Architecture

```
State gains `affordances: string[]`   ── in-page actions (badges); default []
Edge gains  `core: boolean`           ── on the main journey; default false
graph-edit  authors them + node capabilities/topics
interior API exposes affordances (per state) + core (per edge)
viewer:  node box shows affordance badges, no Handle dots;
         core edges + their nodes rendered prominent, non-core faded
agent re-authors saucedemo → single www.saucedemo.com node (caps/topics set,
         states carry affordances, core edges flagged, NO self-loops);
         old `saucedemo` node + `sd:*` states/edges removed.
```

## Components

**Schema + model (`src/mapstore/types.ts`, `schema.sql`, `store.ts`):**
- `State.affordances: string[]` — new column `affordances TEXT` (JSON), idempotent migration, `makeState` default `[]`, round-trip in `upsertState`/`rowToState`.
- `Edge.core: boolean` — new column `core INTEGER` (0/1), idempotent migration, `makeEdge` default `false`, round-trip in `upsertEdge`/`rowToEdge`.
- (These mirror the `requiresAffordances` column added in the prior increment.)

**`graph-edit` (`src/graph/edit.ts`):**
- `EditState` gains `affordances?: string[]` → set on the State.
- `EditEdge` gains `core?: boolean` → set on the Edge.
- Node metadata: the graph JSON gains an optional top-level `node: { capabilities?: string[], topics?: string[] }` (or `--capabilities`/`--topics` flags) so the agent authors them; `editGraph` upserts the node with those instead of bare `[]`. (When creating a new node, use the supplied caps/topics; default `[]` only if unset.)

**Interior API (`src/graph/interior.ts`):**
- `NodeInteriorView.states[]` includes `affordances`.
- `NodeInteriorView.edges[]` includes `core`.

**Viewer (`web/src/...`):**
- `StateNode.tsx`: remove the two `<Handle>` components (the dots); render `affordances` as small badge chips inside the box.
- `layout.ts` / `InteriorView.tsx`: pass `affordances` into node data; pass `core` into edge data. Style **core edges** solid/bold + a distinct color and **non-core** edges thin/faded; optionally emphasize core-path nodes. (Build the non-core edges/nodes "around" the highlighted core path.)
- `SiteNode.tsx` (top-level cluster view): also remove `Handle` dots for visual consistency.

**Node-id cleanup + agent re-author:**
- Remove the seeded `saucedemo` node + `sd:*` states/edges (delete from `seed.ts`/`saucedemo-skeleton.ts` seeding; clear the rows on seed). The canonical saucedemo is `www.saucedemo.com`, agent-built.
- A Haiku agent re-runs the saucedemo map into the new model: one `www.saucedemo.com` node with `capabilities`/`topics` set, page-states each carrying `affordances`, navigation edges with `core: true` on the login→inventory→cart→checkout-info→checkout-overview journey, NO self-loop edges. Persisted to `webnav.db`. (This is the acceptance demo; verified by `graph-show` + the viewer.)

## Data flow (viewer rendering the re-authored saucedemo)

```
npm run dev → / → React app → /api/node/www.saucedemo.com/interior
  → { states:[{semanticName, affordances:[...]}], edges:[{from,to,core,...}] }
  → InteriorView: nodes render label + affordance badges (no dots);
    core edges bold/colored, non-core edges faded → core journey stands out,
    branches (product-detail, menu) arranged around it.
```

## Error handling

- **Legacy edges/states without the new columns:** migration adds nullable columns; `rowToState`/`rowToEdge` default `affordances: []` / `core: false`. Existing graphs render unchanged (no badges, no emphasis) — no break.
- **graph-edit with node metadata for an existing node:** upsert updates caps/topics (last author wins); omitting them leaves existing values (don't clobber to `[]` on update — only default `[]` when the node is newly created and none supplied).
- **Viewer with no affordances / no core flags** (an older graph): renders plain (no badges, all edges equal) — graceful.
- **Removing `saucedemo`/`sd:*`:** `seedGraph` no longer seeds them. `walk.test.ts` is rewritten onto an inline fixture (no dependency on the seeded skeleton); the gated walk e2es are re-pointed to the agent-built `www.saucedemo.com` graph (or a tiny inline saucedemo fixture). `runWalkLive`/`walk-live.ts` references to `sd:*` are updated or removed as part of the e2e re-point. After this, nothing references the old seeded skeleton.

## Testing strategy

- **Schema round-trip (unit):** `State.affordances` and `Edge.core` persist + default correctly; legacy rows read back `[]`/`false`.
- **`graph-edit` (unit):** authors `affordances` on a state, `core` on an edge, and node `capabilities`/`topics` (new node gets them; existing node update doesn't clobber when omitted). 
- **Interior API (unit):** `buildNodeInterior` returns `affordances` per state + `core` per edge.
- **Viewer (unit where pure):** `layout.ts` passes `affordances`/`core` into node/edge data; a fork/core edge gets the core style. (Component rendering verified live, per project pattern.)
- **Live viewer render (acceptance, playwright-cli headless):** load the re-authored saucedemo interior; assert node boxes show affordance text, NO `.react-flow__handle` dots, core edges visually distinct. Same headless approach used for prior viewer work.
- **Agent re-author (acceptance, not committed CI):** Haiku agent builds the new-model saucedemo; `graph-show` confirms one `www.saucedemo.com` node with caps/topics, states with affordances, core edges, no self-loops; the old `saucedemo`/`sd:*` are gone.

## Out of scope

- Ordered/named core paths (a boolean `core` per edge suffices — YAGNI).
- Auto-inferring capabilities/affordances (always agent-authored — #5a).
- Re-authoring the *other* seeded sites (github/pypi) into the agent model — they stay as-is (already host-ids).

## Files

- **Modify:** `src/mapstore/types.ts`, `src/mapstore/schema.sql`, `src/mapstore/store.ts` (affordances + core columns/round-trip/migration), `src/graph/edit.ts` (author the new fields + node metadata), `src/graph/interior.ts` (expose them), `web/src/nodes/StateNode.tsx` + `web/src/nodes/SiteNode.tsx` (remove dots, affordance badges), `web/src/InteriorView.tsx` + `web/src/layout.ts` (pass core/affordances, style core path), `docs/STATUS.md`.
- **Remove:** `src/explorer/saucedemo-skeleton.ts` + its seeding in `src/graph/seed.ts` + its skeleton test `tests/explorer/saucedemo-skeleton.test.ts`.
- **Rewrite:** `tests/router/walk.test.ts` onto an inline fixture; re-point `tests/e2e/walk.live.test.ts` + `tests/e2e/walk-affordance.live.test.ts` to the agent-built `www.saucedemo.com` graph (or inline fixture); update/remove `src/router/walk-live.ts` `sd:*` references.
- **Tests:** schema round-trip, graph-edit, interior; gated live viewer render; agent re-author acceptance.
- No changes to: the walk *engine* (`walkRoute`/`findPath`/`walk-session`), the interactive verbs, analyse.
