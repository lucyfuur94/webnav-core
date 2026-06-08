# Saucedemo Affordance Re-seed + Walk Completes via Affordance Pause — Design

**Date:** 2026-06-08 · **Status:** approved (brainstorm complete) · **Increment:** saucedemo-affordance-reseed + walk affordance-pause

## Problem

The interactive walk engine + verbs are merged, but its saucedemo demo never completed because saucedemo is modeled the OLD way (page=state) in the hand-seeded `src/explorer/saucedemo-skeleton.ts` — specifically the `inventory → cart` edge bundles TWO actions (add-to-cart, which doesn't navigate, then open-cart, which does). Meanwhile the affordance-recording increment established the correct model (in-page actions are a node's repertoire, not new states), and a Haiku agent already produced an affordance-shaped saucedemo graph by exploring. We now have two conflicting saucedemo representations.

**Goal:** retire the old page=state skeleton, re-seed saucedemo in the **affordance model**, and make `walk login → checkout-overview` complete by **pausing for required in-page affordances** at the pages that need them — proving the autopilot-with-forks loop end-to-end on one consistent model.

## Settled model (from brainstorm)

- **`walk` ≠ `use` (CLAUDE.md, settled).** `use` = manual driving (agent reasons every step; explore/build). `walk` = deterministic low-token **autopilot** that replays a known page-to-page route; the agent intervenes ONLY at forks. This increment must preserve walk's autopilot nature — pause ONLY where required, never at every page.
- **(C) walk drives page-to-page; in-page actions are agent-fired at pauses.** The pathfinder sees only navigation edges (no in-page self-loops). An in-page action required before a navigation is fired by the agent when the walk pauses — not threaded through the planner.
- **(B) keep `walkRoute` as the autopilot, add the per-page affordance pause.** Not "walking = the use loop" (that throws away walk's reason to exist).
- **(A, revised to a list) `requiresAffordances: string[]` on the navigation edge.** An edge declares zero-or-more in-page affordances that must be fired before traversing it. Declared DATA authored into the graph (zero-LLM — webnav never judges necessity). A list, not one: saucedemo's checkout-info → checkout-overview edge needs 3 affordances (First/Last/Zip), so a list is the real requirement, not speculation. (Ordered/conditional affordance logic is out of scope — YAGNI.)

## Affordance — definition

An **affordance** = an action a page offers (a clickable/typeable element). **Navigation affordances** take you to a different page → modeled as graph **edges**. **In-page affordances** change the current page without navigating (add-to-cart) → the node's repertoire, NOT edges. `requiresAffordances` on an edge = "fire these in-page affordances on the current page before this navigation is useful."

## Architecture

Two coordinated changes serving one goal (a completing saucedemo walk on one model):

1. **Re-seed saucedemo (affordance model).** Replace `saucedemo-skeleton.ts`'s page=state shape with page-nodes connected by navigation edges only:
   - States: `sd:login`, `sd:inventory`, `sd:cart`, `sd:checkout-info`, `sd:checkout-overview` (+ the `sd:purchase-complete` commit target, unchanged). NO `sd:inventory-carted` (the ambiguity state). add-to-cart is an in-page affordance, not a state.
   - Edges (navigation only):
     - `sd:login → sd:inventory` — `needsInput`/credentials (unchanged).
     - `sd:inventory → sd:cart` — `requiresAffordances: ['add an item to the cart']`, `semanticStep: 'open the shopping cart'`.
     - `sd:cart → sd:checkout-info` — `semanticStep: 'click "Checkout"'`.
     - `sd:checkout-info → sd:checkout-overview` — `requiresAffordances: ['enter First Name','enter Last Name','enter Zip/Postal Code']`, `semanticStep: 'click "Continue"'`. (This replaces the old `acceptsInput:'shipping'` slot bundling — shipping fields become required affordances, unifying the mechanism.)
     - `sd:checkout-overview → sd:purchase-complete` — the commit point (`unclassified`/`click "Finish"`), never fired (unchanged).

2. **Extend `walkRoute` with the affordance pause.** Before traversing an edge that has a non-empty `requiresAffordances`, the walk **pauses** with a `needs-navigation`-style response carrying the current page snapshot + the list of required affordances; the agent fires them (via resume `--ref` / `use click`/`type`) and resumes; the walk then traverses the edge. Edges without `requiresAffordances` traverse deterministically as today (autopilot preserved).

## Components

**Edge model (`src/mapstore/types.ts` + schema + store):** add `requiresAffordances?: string[]` to `Edge` (default `[]`/null). `makeEdge` accepts it; `upsertEdge`/`rowToEdge` persist it (new nullable `requires_affordances` TEXT/JSON column on `edges`, idempotent migration). `graph-edit` already takes edge data — extend its edge JSON to accept `requiresAffordances`.

**`saucedemo-skeleton.ts`:** rewrite `SAUCEDEMO_SKELETON` to the affordance shape above. `exploreSaucedemo` still writes it via upsert (idempotent). Remove the `sd:inventory-carted` notion if present (it isn't on main — main still has the OLD bundled edge; this replaces that).

**`walkRoute` (`src/router/walk.ts`):** at the top of the per-edge loop, after selecting the edge to traverse, if `edge.requiresAffordances?.length`, return a pause response:
```
{ status: 'needs-navigation', at, semanticStep: edge.semanticStep, snapshot: <current page>,
  question: 'before "' + edge.semanticStep + '", fire these in-page affordances: ' + list.join('; ') }
```
BEFORE acting on the edge. On resume (the existing `answer` path), the agent's action(s) have been done (the agent fired the affordances via `use`/resume); the walk then proceeds to traverse the navigation edge and does its normal predict-vs-observe. (For v1 the resume answer can be the nav action itself once affordances are done; the existing resume `--ref` mechanism is reused.)

**`runWalkLive`/live wiring:** the slot-based `credentials`/`shipping` fills become: credentials stays as the `needsInput` login (unchanged); shipping becomes required affordances on the checkout-info edge (the agent fires them at the pause). The live demo (gated e2e) exercises the pause→fire→resume loop.

## Data flow (the completing walk)

```
walk --start sd:login --goal sd:checkout-overview --input username=… --input password=…
  → login edge (needsInput) → fill creds → sd:inventory
  → next edge sd:inventory→sd:cart has requiresAffordances:['add an item to the cart']
     → PAUSE: { needs-navigation, snapshot(inventory), question:'fire: add an item to the cart' }
  → agent fires add-to-cart (resume --ref <add-btn>) → walk opens cart → sd:cart
  → sd:cart→sd:checkout-info ('click Checkout') → sd:checkout-info
  → next edge has requiresAffordances:['enter First Name','Last Name','Zip']
     → PAUSE → agent fills the three fields → walk clicks Continue → sd:checkout-overview == goal
  → DONE
```

## Error handling

- **Agent resumes without firing the required affordances** (says continue, didn't act): walk traverses anyway (agent's call — webnav doesn't enforce necessity); if the result is wrong (empty cart → mismatch), the existing predict-vs-observe re-pauses with the mismatch. Honest, agent-driven.
- **Agent fires the wrong thing:** predict-vs-observe after the navigation catches the mismatch → re-pause. Existing protocol, no new path.
- **Re-seed migration:** new `sd:*` states/edges upsert over the old; the old bundled `inventory→cart` edge is replaced (same from/to, new semanticStep + requiresAffordances — `upsertEdge`'s UNIQUE(from,to,semantic_step) means the changed semanticStep creates the new edge; the old row, if its semanticStep differs, is stale-but-harmless, or the seed clears sd edges first). The seed will DELETE existing `sd:*` edges before re-writing to avoid stale duplicates.
- **Commit point** (`Finish`) unchanged: `needs-classification`, never fired.

## Testing strategy

- **Edge model (unit):** `makeEdge` + store round-trip `requiresAffordances` (incl. empty/absent default). Migration adds the column idempotently; legacy edges read back with `requiresAffordances: []`.
- **Re-seed shape (unit):** the seeded saucedemo graph has the affordance shape — `inventory→cart` has `requiresAffordances:['add an item to the cart']`; `checkout-info→checkout-overview` has the 3 shipping affordances; no `inventory-carted` state; `login→inventory` keeps needsInput. Assert the edge fields + that the graph is the 5 page-states (+ commit target).
- **`walkRoute` affordance pause (unit, fake browser):** an edge with `requiresAffordances` → walk returns `needs-navigation` listing them BEFORE traversing; resume continues. An edge with empty `requiresAffordances` → traverses without pausing (autopilot preserved). Back-compat: existing walk tests stay green.
- **Gated live e2e (`WEBNAV_LIVE=1`):** `walk sd:login → sd:checkout-overview` on real saucedemo completes — pauses at add-to-cart (agent supplies ref), pauses at shipping (agent fills), reaches checkout-overview. The end-to-end autopilot-with-forks proof.
- **Acceptance (post-merge, not committed CI):** a Haiku agent runs the walk against the re-seeded saucedemo and reports it reached checkout-overview.

## Out of scope

- Ordered/conditional/branching affordance logic (a flat list per edge is the present need — YAGNI).
- Generalizing the re-seed to other sites (saucedemo is the canonical walk demo; other sites are agent-built via the mapping flow).
- Removing the `acceptsInput` slot mechanism entirely — login still uses `needsInput` (credentials); only shipping migrates to required affordances. (Unifying fully is a possible later cleanup.)
- The viewer rendering `requiresAffordances` (could show them on edges later; not now).

## Files

- **Modify:** `src/mapstore/types.ts` (`Edge.requiresAffordances` + `makeEdge`), `src/mapstore/schema.sql` + `src/mapstore/store.ts` (column + migration + round-trip), `src/explorer/saucedemo-skeleton.ts` (re-seed shape + clear-sd-edges-on-seed), `src/router/walk.ts` (affordance pause), `src/router/walk-live.ts` (shipping → affordances at pause), `src/graph/edit.ts` (accept `requiresAffordances` in edge JSON).
- **Tests:** edge round-trip, re-seed shape, walk affordance-pause, gated live e2e; update existing `saucedemo-skeleton.test.ts`/`walk.test.ts`/`walk.live.test.ts` to the new shape.
- **Modify:** `docs/STATUS.md`.
- No changes to: analyse, the interactive verbs, the viewer internals.
