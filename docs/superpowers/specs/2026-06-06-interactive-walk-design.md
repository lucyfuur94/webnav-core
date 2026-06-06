# Interactive Walk (expose + resume) — Design

**Date:** 2026-06-06 · **Status:** approved (brainstorm complete) · **Increment:** walk-v2 (expose `walkRoute` + resume loop)

## Problem

webnav has a working multi-step **walk engine** (`src/router/walk.ts` `walkRoute`) — it drives a site edge-by-edge to reach a state that has **no addressable URL** (e.g. saucedemo's checkout: log in → inventory → cart → checkout-info → checkout-overview). But:

1. **It has no CLI verb.** It's only reachable from a hardcoded `runWalkLive` (saucedemo) and tests. **An agent cannot use it at all.**
2. **It's one-shot.** When the walk hits a fork it can't decide — `needs-navigation` (lost on a changed page) or `needs-classification` (an action that might be a commit point) — it returns and **ends**. There's no way to feed the agent's answer back and continue, so a multi-fork flow (saucedemo has add-to-cart *and* the Finish commit point) can't complete autonomously.

This increment exposes the walk to the agent via two consumer verbs and makes a paused walk **resumable**, so the agent answers a fork and the walk continues to the goal.

## Decisions (settled in brainstorm)

- **Q1 = A:** paused walks resume via a **persisted walk-session** — `walk` returns a `session` id with the fork; `walk-resume <session> …` continues; loops over multiple forks.
- **Q2 → deleted:** NO walk-definition table. A walk is **pure graph traversal between two state ids** (user insight: "why can't walk use the graph?"). The graph already holds the states + edges (verified in `saucedemo-skeleton.ts`).
- **Q2′ = A:** webnav **computes the shortest path** over graph edges (deterministic, weighted by the existing `cost`/`reliability`/`confidence` edge fields, zero-LLM), then walks it. This also fixes `walkRoute`'s current linear-only `edges[0]` assumption.
- **Q3 = A:** runtime inputs via **`--input slot=value`** flags, resolved at field-fill time, **never persisted** (secrets/#6). Held in-memory for the single invocation.
- **Q4 = A:** two typed answer flags — **`--ref <e>`** (answers `needs-navigation`) / **`--classify safe|commit`** (answers `needs-classification`). `--classify commit` → **hard halt, never fires** (principle #2).

## Verified against the code (during brainstorm)

- Edge weight fields (`cost`, `reliability`, `confidence`) are real columns on the `edges` table → `findPath` can weight on them.
- `walkRoute` currently does `edges[0]` with an explicit "Linear route" comment → the path-following change is real and needed.
- **The `-s=<session>` playwright browser persists across SEPARATE CLI processes** (empirically confirmed: opened example.com in one process, read its title from another). This is the load-bearing fact that makes resume work — a paused `walk` can exit and `walk-resume` reattaches the same live page by session name. So the walk-session only stores *position + the session NAME*, never browser state.

## Invariants

- **Zero-LLM / judgment-free (#5a):** webnav pathfinds + walks deterministically; every decision it can't make (which element on drift, safe-vs-commit) is handed back as a `needs-*` response. The agent decides.
- **Never traverse a commit point (#2):** `--classify commit` halts; webnav never fires a declared commit point regardless.
- **Inputs never persisted:** credentials/form values live only in the invoking process's memory; never written to SQLite, never logged.
- **Graph is the single source of truth:** no separate walk records; start/goal are graph state ids.

## Architecture

Two new **`use`** consumer verbs over the existing engine, plus a pathfinder and a session store:

```
webnav walk --start <stateId> --goal <stateId> [--input slot=value ...]
   → findPath(store,start,goal)         (new: src/router/path.ts — weighted Dijkstra)
   → open -s=walk-<ts> browser, walkRoute follows the resolved path
   → done:  { status:"done", evidence }
   → fork:  WalkSessionStore.create(...) → { status:"needs-navigation"|"needs-classification",
                                             session:"walk-7", snapshot, question|action }

webnav walk-resume <session> --ref e42        (or --classify safe|commit)
   → WalkSessionStore.load → reattach -s= browser → apply answer → continue walkRoute
   → next fork (advance + print) OR done (close session)
```

## Components

**`src/router/path.ts` (new)** — `findPath(store: MapStore, startId: string, goalId: string): string[] | null`.
Weighted shortest path (Dijkstra) over `store.edgesFrom` reachability. Edge weight = a deterministic function of the edge's `cost` (higher = worse) and `reliability`×`confidence` (higher = better) — prefer cheap, reliable, recently-verified edges. Returns the ordered state-id list (`['sd:login','sd:inventory',...]`) or `null` if unreachable. Pure: store reads only, no browser/LLM. Terminates on cycles (visited set).

**`src/router/walk-session.ts` (new)** — `WalkSessionStore` (mirrors `RecordStore`'s constructor/`fromDatabase` shape):
- `create({startState, goalState, path, browserSession}) → sessionId`
- `load(sessionId) → { startState, goalState, path: string[], pos: number, browserSession, status } | null`
- `advance(sessionId, pos)`, `close(sessionId)`
- SQLite `walk_sessions` table: `session_id TEXT PK, start_state, goal_state, path TEXT(json), pos INTEGER, browser_session TEXT, status TEXT, created_at INTEGER`.
- **No inputs column** — inputs are runtime-only.

**`walkRoute` extension (`src/router/walk.ts`)** — two minimal changes, engine otherwise unchanged:
1. Accept the resolved `path: string[]`; at each state pick the outgoing edge whose `toState` is the next path entry (replaces `edges[0]` / the linear assumption).
2. Accept an optional resume answer `{ kind:'ref', ref } | { kind:'classify', verdict:'safe'|'commit' }` applied to the step it paused on: a `ref` answer acts on that element then resumes; `classify safe` fires the commit-candidate then resumes; `classify commit` returns a `done`-with-`halted:'commit-point'` WITHOUT firing.
Predict-vs-observe, self-heal write-back, and the `needs-*` responses are unchanged.

**CLI (`src/cli.ts` + `src/cli-spec.ts`, `use` category):**
- `walk --start <id> --goal <id> [--input k=v ...]` — parse inputs into a `Record<string,string>`; `findPath`; open `walk-<ts>` browser; build the live `WalkBrowser` (the existing `walk-live.ts` closure pattern owns the inputs map + fills fields by slot); run `walkRoute`. On a `needs-*`, `create` a session and print `{...response, session}`. On done, print evidence. (`failed`/empty → exit 3.)
- `walk-resume <session> [--ref <e>] | [--classify safe|commit]` — `load` the session; reattach `new PlaywrightAdapter(browserSession)`; rebuild the `WalkBrowser`; continue `walkRoute` from `pos` with the answer. Re-pause → `advance` + print; done → `close` + print.

## Data flow (saucedemo, multi-fork)

```
walk --start sd:login --goal sd:checkout-overview --input username=standard_user --input password=secret_sauce --input zip=94016
  → findPath → [sd:login, sd:inventory, sd:cart, sd:checkout-info, sd:checkout-overview]
  → login (fills username/password via 'credentials' slot) → inventory
  → PAUSE: add-to-cart edge is ambiguous (needs-navigation)
  → create walk-7, print { session:"walk-7", status:"needs-navigation", snapshot, semanticStep }
walk-resume walk-7 --ref e42
  → reattach walk-7 browser → click e42 → cart → checkout-info (fills shipping via 'shipping' slot)
  → checkout-overview == goal → DONE { status:"done", evidence }
```

(saucedemo's goal is `checkout-overview`, one state BEFORE the "Finish" commit point, so the happy path never fires a commit. The `--classify` path is exercised only when a walk's goal lies past such a button.)

## Error handling

- **No path** (`findPath`→null): `{ status:"failed", reason:"no route from <start> to <goal>" }`, exit 3.
- **Unknown start/goal state id:** `{ status:"failed", reason:"unknown state <id>" }`, exit 2.
- **`walk-resume` unknown/closed session:** `{ status:"failed", reason:"no active walk-session <id>" }`, exit 2.
- **Wrong answer flag for the pause type** (`--classify` while paused on needs-navigation, or vice-versa): error naming the expected flag.
- **Missing required input** (an edge's `acceptsInput` slot with no `--input`): `{ status:"failed", reason:"step needs input '<slot>' — pass --input <slot>=value" }`, exit 2.
- **`--classify commit`:** `{ status:"done", evidence, halted:"commit-point" }` — never fires the action.
- **Browser session gone** (rebooted between calls; rare since `-s=` normally persists): reattach throws → `{ status:"failed", reason:"walk-session browser is gone; restart the walk" }`.

## Testing strategy

- **`findPath` (unit, no browser):** fixture graphs — linear path; branching picks lowest weight; unreachable → null; cycle terminates. Primary new logic.
- **`WalkSessionStore` (unit):** create/load/advance/close round-trip; assert no inputs are ever persisted (no column; nothing written).
- **`walkRoute` path-following + resume (unit, fake `WalkBrowser`):** follows a resolved path over a BRANCHING fixture (not `edges[0]`); a `ref` resume answer advances past a paused step; a multi-fork sequence pauses → resumes → pauses → resumes → done; `classify commit` returns halted without acting.
- **CLI parse (unit):** `walk` (`--start/--goal/--input` repeated) and `walk-resume` (`--ref` xor `--classify`).
- **Gated live e2e (`WEBNAV_LIVE=1`):** the real saucedemo flow — `walk` pauses at add-to-cart, `walk-resume --ref` continues to `checkout-overview`, `done`. This is the payoff: the flow that currently can't finish autonomously now does across two CLI calls sharing one `-s=` browser.

## Out of scope (v1)

- Secret-safe input passing (env var / `--inputs-file`) — noted future hardening; v1 uses saucedemo's public demo creds. `--input` values can leak via shell history.
- Auto-discovering walk targets — the agent supplies start/goal state ids it got from `graph-show <node>` / the viewer / `route`.
- Goal-state evidence enrichment — `walkRoute` returns minimal evidence at the goal (unchanged from W1); enriching it is a separate increment.
- Branch resolution *by the agent* — webnav picks the weighted-shortest path; if the agent wants a specific path, that's a future `--via` option.

## Files

- **New:** `src/router/path.ts`, `src/router/walk-session.ts`, tests for each; gated e2e `tests/e2e/walk-cli.live.test.ts`.
- **Modify:** `src/router/walk.ts` (path-following + resume answer), `src/mapstore/schema.sql` (`walk_sessions` table), `src/cli.ts` + `src/cli-spec.ts` (the two verbs, `use` category), `src/router/walk-live.ts` (reuse its WalkBrowser closure for the live wiring), `docs/STATUS.md`.
- No changes to: the graph/data builders, the viewer, recall/search/route.
