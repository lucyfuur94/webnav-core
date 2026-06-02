# Live graph viewer + node drill-in — design

**Date:** 2026-06-02 · **Status:** approved (brainstorm), pending spec review

## Problem

The graph viewer today shows only the **internet graph** (site-nodes + the
edges between them). It cannot show the **inside of a site** — a node's
intra-site navigation skeleton (states + action-edges, e.g. GitHub's
`search-entry → result-list → repo-detail`). Users want to drill into a node
and see its interior.

Two real obstacles surfaced while scoping this:

1. **The viewer is a baked static file.** `webnav graph --html` reads SQLite
   once and inlines the data into a self-contained `.html`. That is right for
   *sharing a snapshot*, but wrong for a *live, drill-into-the-data* experience —
   the snapshot is stale the moment it is written, and "look at the graph"
   should just mean "open a URL," not "regenerate a file."
2. **Interiors are not in the DB.** The skeletons (`GITHUB_SKELETON`,
   `SAUCEDEMO_SKELETON`) live as hardcoded TypeScript constants. They only reach
   the DB when a **live recall** runs and lazily copies them in
   (`recall-via-map.ts` → `exploreGitHub`). The seed step writes only the node
   graph, so the current `webnav.db` has **5 nodes and 0 interior states**.

## Decisions (settled in brainstorm)

- **Live local dev server.** Add `npm run dev` → a tiny Node built-in-`http`
  server that reads the live SQLite map and serves the viewer + JSON APIs. Open
  `http://localhost:7777`. No hosted infra, no CLI verb to manage, no baked file.
- **Server scope: READ-ONLY.** It only reads SQLite and serves graph + interior
  data. Teach (add-node/add-edge) stays as CLI-command generation, unchanged.
  The server contains zero navigation logic and cannot mutate the map.
- **Tiny Node `http`, zero new deps.** Matches webnav's minimal stack
  (`better-sqlite3` + `yaml` only). Reuses the existing, verified Cytoscape
  viewer (`src/graph/html.ts`) — it just fetches live instead of reading inlined
  data. The `/api` JSON contract is storage-agnostic, so a future hosted
  frontend (Next.js/Firestore) can consume the same API without rework.
- **DB is the single source of truth.** Skeleton constants become **seed-only
  data**. The seed step writes interiors (reusing `exploreGitHub` /
  `exploreSaucedemo`). The lazy `if (!routePresent) exploreGitHub(store)`
  bootstrap in `recall-via-map.ts` (and the equivalent in `walk-live.ts`) is
  **dropped** — runtime reads only the DB; an unseeded DB simply has no route
  (seeding is a prerequisite, like running migrations).
- **`states` gain a `node_id` column.** Ownership of a state by its site becomes
  data, not a string convention. Backfilled from the existing `<node>:<state>`
  ID-prefix convention.
- **MapStore becomes a swappable interface.** Extract `interface MapStore`; the
  current class becomes `SqliteMapStore implements MapStore`. Keeps SQLite (it
  fits the shallow, 1–2-hop, tiny-graph access patterns and the zero-services
  ethos) while making a future hosted/Postgres/Firestore backend a clean swap.
- **Static `graph --html` export stays** for shareable snapshots; it does NOT
  gain drill-in (that needs the live server). Two clearly-scoped modes.

### Why NOT a graph DB / Postgres now (recorded rationale)

The graph is 5 nodes; every query is a 1–2-hop indexed lookup (route = filter by
capability; hop = edges-from; drill-in = states where `node_id = X`). There is no
deep traversal, scale, or concurrency pressure, and v1 scope excludes background
crawl + multi-site scale. Migrating now would reverse a settled CLAUDE.md
principle ("zero running services", embedded SQLite), rewrite the data layer +
~190 test fixtures, and add a server/dependency — for zero current functional
gain. The swappable interface gives the future-proofing without the premature
cost.

## Architecture — components

1. **`MapStore` interface + `SqliteMapStore`** (`src/mapstore/`).
   Extract the data-access surface into `interface MapStore`
   (reads: `allNodes`, `allNodeEdges`, `allStates`, `allEdges`, `getState`,
   `edgesFrom`, `statesForNode`; writes: the `upsert*` family, `transaction`).
   The current class implements it. Everything depends on the interface.

2. **Schema + reads.** Add `node_id TEXT` to `states`. Add `allStates()`,
   `allEdges()`, `statesForNode(nodeId)` reads.

3. **`buildNodeInterior(store, nodeId)`** (`src/graph/interior.ts`).
   Pure, viz-ready view of one node's interior — its states (by `node_id`) and
   the edges among them, carrying the durable semantic fields (`semanticName`,
   `role`, `availableSignals`; edge `semanticStep`, `kind`). Sibling to
   `buildGraphView`. Deterministic ordering.

4. **Seed authoritative** (`src/graph/seed.ts`). `seedGraph` also writes the
   known interiors by reusing `exploreGitHub` / `exploreSaucedemo`. Drop the
   lazy bootstrap in `recall-via-map.ts` + `walk-live.ts`.

5. **`src/server.ts`** — Node `http`, read-only, binds `127.0.0.1`. Routes:
   - `GET /` → viewer HTML.
   - `GET /api/graph` → `buildGraphView(store)` as JSON.
   - `GET /api/node/:id/interior` → `buildNodeInterior(store, id)` as JSON.
   `npm run dev` → `tsx watch src/server.ts` (port via `--port` / env, default 7777).

6. **Viewer** (`src/graph/html.ts`). Fetch `/api/graph` on load (instead of
   inlined data). Click a node → fetch `/api/node/:id/interior` → render the
   interior as a sub-graph in an overlay/panel with a "back" control.

## Data flow

- **Seed (once):** `seedGraph(store)` writes nodes, node_edges, AND interior
  states/edges (with `node_id`). DB authoritative.
- **View (every load):** browser → `GET /` → viewer HTML → `fetch('/api/graph')`
  → `buildGraphView` → JSON → Cytoscape renders the site-graph.
- **Drill-in (node click):** `fetch('/api/node/github.com/interior')` →
  `buildNodeInterior` → `{states,edges}` → viewer renders interior sub-graph in
  an overlay; "back" returns to the site-graph.
- **Recall (unchanged minus bootstrap):** Router reads the route from `store`;
  if absent → `{status:'failed'}` (no lazy build). Usage-repairs still write
  back, so the live view reflects them on next load.

## Migration (the `node_id` column)

`schema.sql` uses `CREATE TABLE IF NOT EXISTS`, so existing DBs won't auto-gain
the column. On store open, run an idempotent migration:
`PRAGMA table_info(states)` → if `node_id` missing, `ALTER TABLE states ADD
COLUMN node_id TEXT`, then backfill each row's `node_id` from its ID prefix
(`github:search-entry` → `github.com`) via a small explicit prefix→host map.
Add `node_id` to the `states` definition in `schema.sql` for fresh DBs. The
current DB has 0 states, so the backfill is a no-op today; the migration matters
for forward safety and re-seeded DBs.

## Error handling

- **Unseeded / empty graph** → `/api/graph` returns `{nodes:[],clusters:[],edges:[]}`;
  viewer shows its existing empty-graph state. No crash.
- **Drill-in on a node with no interior** (e.g. `pypi.org`) →
  `{states:[],edges:[]}`; viewer shows "no interior mapped for this site yet".
  This is the honest, correct state — most nodes have no skeleton.
- **Unknown node id** → `404` JSON `{error:"unknown node"}`; viewer surfaces it inline.
- **Port in use** → server exits with a clear message + nonzero exit code
  (consistent with the CLI exit-code convention).
- **DB locked / read error** → `500` JSON; server stays up.

## Non-goals

- No writes from the server (teach stays CLI-command generation).
- No auth / CORS / multi-user — localhost, single user.
- `graph --html` static export does NOT gain drill-in.
- No store migration (SQLite stays; interface makes a future swap clean).
- Not a hosted deployment (designed-for via the storage-agnostic API; not built).

## Testing plan (TDD, vitest)

**Pure units (no server/browser):**
- `buildNodeInterior`: seeded GitHub skeleton → 3 states + 2 edges with durable
  fields; deterministic order; `{[],[]}` for a node with no interior; ignores
  other nodes' states.
- MapStore reads: `allStates`, `allEdges`, `statesForNode` return correct rows;
  `statesForNode` filters by `node_id`.
- Migration: open a DB created without `node_id` → column added + backfilled
  from ID prefix; opening twice is idempotent.
- Seed authoritative: after `seedGraph`, store contains GitHub + saucedemo
  interior states/edges (not just nodes).
- Bootstrap removed: `recallViaMap` against a store with no route returns
  `{status:'failed'}` and does NOT call `exploreGitHub`. Update existing
  recall-via-map tests that relied on the lazy build to seed first.
- Interface swap: `SqliteMapStore implements MapStore`; a trivial in-memory fake
  satisfies the interface (proves the seam; gives tests a fast fake).

**Server (Node `http`, no browser):** start on an ephemeral port against a
seeded temp/in-memory DB; `fetch` each route:
- `GET /` → 200, HTML contains the viewer.
- `GET /api/graph` → 200, JSON matches `buildGraphView`.
- `GET /api/node/github.com/interior` → 200, matches `buildNodeInterior`.
- `GET /api/node/pypi.org/interior` → 200, `{states:[],edges:[]}`.
- `GET /api/node/nonexistent/interior` → 404.

**Viewer fetch + drill-in (browser, gated `WEBNAV_LIVE`):** `npm run dev`, drive
headlessly via `playwright-cli` over http (file:// is blocked), click a node,
assert the interior sub-graph renders.

**Gate:** build green + full suite passes before merge.

## Out of scope / future

- Hosted deployment (Firestore + Vercel) — the `/api` contract is designed for
  it; building it is a separate project.
- Write-through teach / explore-from-UI (server stays read-only this round).
