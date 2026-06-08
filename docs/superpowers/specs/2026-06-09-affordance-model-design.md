# Affordance-primary state model + per-affordance graph viewer

**Date:** 2026-06-09
**Status:** Design — approved in brainstorming, pending spec review
**Topic:** Make a node's *repertoire* the source of truth (affordances with kinds), project edges from it, and render the graph so edges leave the specific affordance that triggers them.

---

## 1. Problem

The map flattens every in-page action into `State.affordances: string[]` — bare labels with no behavior. The saucedemo example exposes that affordances are not all the same kind:

- **email / password** — fill a field; no transition.
- **click Login** — navigates to a new state (inventory).
- **open hamburger menu** — reveals an in-page overlay exposing *more* affordances (All Items / About / Logout / Reset) whose destinations are unexplored.
- **sort dropdown** — mutates the same page in place; no navigation.

Two failures result:

1. **Model:** the graph cannot express *which* affordance triggers a transition, cannot represent an overlay's hidden options, and cannot distinguish same-page mutations from navigation. An agent reading the map can't tell "the cart is reachable but via this specific button" or "this menu hides 6 options I haven't explored."
2. **Viewer:** edges leave the node-as-a-whole, not the affordance that fires them (user's point I). Affordances render as an undifferentiated badge row. There is no way to see an overlay's contents.

**Goal (settled = "C"):** model affordances properly *so the agent benefits at runtime*, AND render them richly *so a human can read the map*. The richer model is what makes the richer render possible.

## 2. Settled decisions (from brainstorming)

- **C, agent-driven.** Both model and viewer; the agent is the real consumer, the viewer is how we verify the agent has what it needs.
- **Affordance-primary (option A).** The affordance is the single source of truth. An edge is a *projection* — "every affordance whose kind navigates and that has a known `toState`." The `edges` table is removed; the router/recall/walk read from affordances. This is faithful to CLAUDE.md's mental model ("edges = actions") made literal, and the affordance fields are a strict superset of today's edge fields, so nothing is lost.
- **Overlays are nested, not separate nodes.** An overlay (menu/dropdown/modal) shares the page's URL and has no independent coordinate (per the coordinate system); it is a *disclosure* of latent affordances. A `reveal` affordance *contains* its revealed affordances as `children`. The viewer shows them as an expandable sub-list inside the parent node.
- **mutate/input never route.** They are repertoire (shown, available to the agent at a pause) but are never projected as edges; the router never routes through them. This keeps routing purely state-to-state and the skeleton judgment-free (principle #6, #5a).
- **Preconditions replace `requiresAffordances`-as-gate.** A `navigate` affordance may declare `needs: [affordanceId…]` — input/mutate affordances that should fire first (fill credentials before Login). It is a *declared precondition*, not a use-case judgment; the agent decides whether/how to satisfy it. `add-to-cart` is reclassified as a `mutate`, NOT a gate on the cart edge — the cart is a valid empty state; whether to add first is the agent's judgment.
- **Arrows use the process-map technique** (§6) — floating border-intersection edges + direction-invariant reciprocal bowing. Engine choice (elk vs dagre) is secondary; the win is the floating-edge geometry.

## 3. Data model

```ts
export type AffordanceKind = 'navigate' | 'reveal' | 'mutate' | 'input';

export interface Affordance {
  id: string;                  // stable within its owning state, e.g. 'aff_cart'
  label: string;               // human/agent-readable, e.g. 'open the shopping cart'
  kind: AffordanceKind;
  commit: boolean;             // irreversible (Place Order/Pay/Delete) — NEVER auto-fired (#2)
  toState: string | null;      // navigate/reveal destination; null = unexplored or n/a
  children: Affordance[] | null; // reveal: affordances the overlay exposes; else null
  needs: string[];             // affordance ids that should fire first (preconditions); [] = none
  // — moved off the old Edge; durable intent + disposable cache + usage stats —
  semanticStep: string;        // DURABLE intent (survives redesigns)
  selectorCache: string | null;// DISPOSABLE last-known ref/selector
  cost: number;                // playwright-cli call count
  reliability: number;         // successCount / (successCount + failCount)
  successCount: number;
  failCount: number;
  lastVerified: number | null;
  confidence: number;          // decays with age, rises with use
}

export interface State {
  id: string;
  nodeId: string | null;
  semanticName: string;
  urlPattern: string;
  role: StateRole;
  availableSignals: string[];
  fingerprint: string[];
  affordances: Affordance[];   // was string[] — now the node's full typed repertoire
}
```

**Kinds:**
- `navigate` — fires → lands on a *different* state. `explored` ⟺ `toState != null`.
- `reveal` — opens an in-page overlay/disclosure; reversible by definition. Its `children` are the affordances the overlay exposes (themselves typically `navigate`). `toState` is normally null (the overlay isn't a separate state); the *children's* `toState`s are the real destinations.
- `mutate` — changes the current state in place (sort/filter/add-to-cart). `toState` null. Never routed.
- `input` — fills a field. `toState` null. Never routed. Usually named in some navigate affordance's `needs`.

**Cross-cutting:** `commit` (any kind, but meaningful on navigate) and explored-ness (derived from `toState`).

### Edge projection

The router/viewer derive directed edges by walking each state's affordance tree:

```
for each state S, for each affordance A in S.affordances (recursively into children):
  if A.kind in {navigate, reveal} and A.toState != null:
    emit edge { from: S.id, to: A.toState, viaAffordance: A.id, kind: A.commit ? 'commit-point' : 'navigate',
                semanticStep, selectorCache, cost, reliability, …confidence }
```

`viaAffordance` (the affordance id) is what the viewer anchors the edge to. An unexplored navigate/reveal (`toState == null`) emits a **dangling stub** edge (origin affordance, no target) so the viewer can show "leads somewhere unexplored."

## 4. Persistence & migration

SQLite. The `edges` table is removed; affordances become rich JSON on the state row (they already serialize as the `affordances` TEXT column — the shape changes from `string[]` to `Affordance[]`).

- **Schema:** `states.affordances` stays a TEXT (JSON) column; drop the `edges` table. Add a one-time migration that reads existing `edges` rows and folds each into a `navigate` affordance on its `from_state` (label/semanticStep/selectorCache/stats carried over; `kind: navigate`; `commit` ⟺ old `kind == 'commit-point'`; `requiresAffordances` → `needs`). Existing seeded `affordances: string[]` upgrade to `{kind:'mutate', label, …}` (mutate is the safe default for a bare in-page label).
- **Store API:** `store.ts` swaps `getEdges/addEdge/...` for affordance-tree reads and a `projectEdges(stateId?)` helper. The router/recall/walk call `projectEdges` instead of querying the table. `walkRoute` steps `edge.toState` exactly as today — the projection preserves the shape it consumes.
- **Tests:** the 192 existing tests are the regression net. Edge-shaped expectations are rewritten to go through `projectEdges`; new tests cover the affordance tree, reveal-children projection, `needs`, dangling stubs, and the migration.

## 5. API exposure (`interior.ts` → web viewer)

`NodeInteriorView` gains the full repertoire so the viewer can render it:

```ts
interface NodeInteriorView {
  nodeId: string;
  states: {
    id; semanticName; role; availableSignals; urlPattern;
    affordances: Affordance[];        // full tree, including reveal children & kinds & needs
  }[];
  edges: {                            // projected, for layout
    from; to; viaAffordance; kind; core;
    dangling?: boolean;               // unexplored navigate/reveal stub
  }[];
}
```

## 6. Viewer (web/src) — point I + point II

**Engine (point II).** Keep ELK *or* adopt dagre — the readability win is the **floating edge**, which is engine-agnostic. Port the process-map technique (`process-map/components/ProcessMap.tsx`) regardless:

- **Floating border-intersection edges** (`FlowEdge`, lines 74–169): read live node rects from the store each frame; the endpoint is the intersection of the center→center ray with the node border (`intersect`). Arrowheads always land on the border, never inside, never cutting through. `sideOf` picks the natural `Position`.
- **Direction-invariant reciprocal bowing** (lines 126–156): derive the perpendicular from a fixed low-id→high-id vector so a↔b pairs bow to *opposite* sides; only the per-direction sign decides the side. This replaces the in-progress `BowEdge.tsx`, which fights the same problem less robustly.
- **Self-loops drawn outside the node** (`SelfLoopEdge`, 200–235) — relevant for reveal/close (open menu → close menu returns to the same state) and any same-state affordance.
- **Edge weight by usage** keeps busy paths short/straight (dagre `weight`, or elk priority).

**Per-affordance anchoring (point I).** The node is no longer a plain box. `StateNode` renders its repertoire as a **categorized vertical list**, grouped by kind:

```
┌─ Inventory ─────────────────┐
│ url: /inventory.html         │
│ signals: items, prices       │
│ ── navigate ──               │
│  • open cart           →●    │   ← edge anchors to this row's right handle
│ ── reveal ──                 │
│  ▸ open menu                 │   ← expandable; expands to:
│     • All Items        →●    │
│     • About            →●    │
│     • Logout           →●    │
│ ── mutate ──                 │
│  • sort products             │   (no edge — repertoire only)
│  • add to cart               │
└──────────────────────────────┘
```

- Each `navigate`/explored row exposes a **source Handle** on its right edge; the projected edge for that affordance uses `sourceHandle = aff_<id>`. The floating-edge geometry then routes from that exact point.
- `reveal` rows are collapsible; collapsed by default, the node grows when expanded (point I: "the node box should be made bigger to show what's happening inside it"). Children render indented with their own handles.
- `mutate`/`input` rows render in their groups with **no handle** (they never route).
- `commit` rows get a distinct marker (e.g. red dot) and are never drawn as a traversable edge — shown as inferred/blocked.
- Dangling stubs (unexplored) render as a short arrow to a faded "?" target so the map shows "there's more here, unexplored."

## 7. Components & isolation

- **`src/mapstore/types.ts`** — `Affordance`, `AffordanceKind`, revised `State`; remove `Edge`/`makeEdge` (or keep `ProjectedEdge` as the projection's return type). One clear purpose: the data shapes.
- **`src/mapstore/store.ts`** — persistence + `projectEdges()`. Depends on SQLite only.
- **`src/mapstore/migrate-affordances.ts`** — one-time edges→affordances fold. Isolated, testable against a fixture DB.
- **router / recall / walk** — consume `projectEdges()`; otherwise unchanged interfaces.
- **`src/interior.ts`** — assemble `NodeInteriorView` (repertoire + projected edges).
- **web: `layout.ts`** — projection → React Flow nodes/edges + per-affordance handles.
- **web: `nodes/StateNode.tsx`** — categorized, expandable repertoire with per-row handles.
- **web: `edges/FloatingEdge.tsx`** — port of process-map `FlowEdge` + `SelfLoopEdge`; replaces `BowEdge.tsx`/`RoutedEdge.tsx`.

## 8. Example: saucedemo (what the map stores under this model)

```
login        affordances: [ fill username(input), fill password(input),
                             click Login(navigate → inventory, needs:[username,password]) ]
inventory    affordances: [ open cart(navigate → cart),
                             open menu(reveal, children:[ All Items(navigate → inventory),
                                                          About(navigate → null /*unexplored*/),
                                                          Logout(navigate → login),
                                                          Reset(mutate) ]),
                             sort products(mutate),
                             add to cart(mutate) ]
cart         affordances: [ Checkout(navigate → checkout-info), Continue Shopping(navigate → inventory) ]
checkout-info affordances:[ fill first/last/zip(input),
                             Continue(navigate → checkout-overview, needs:[first,last,zip]) ]
checkout-overview affordances:[ Finish(navigate → complete, commit:true) ]   ← commit, never fired
```

Projected edges: login→inventory, inventory→cart, inventory→inventory (All Items / Reset self), inventory→login (Logout), inventory→? (About, dangling), cart→checkout-info, cart→inventory, checkout-info→checkout-overview, checkout-overview→complete (commit). Each carries `viaAffordance` for anchoring.

## 9. Out of scope

- **Auto-discovery of affordances + kinds** by the explorer (kinds are hand-classified / agent-classified for now; the explorer still seeds them). Real discovery (snapshot → infer kind) is a follow-up.
- Auto-firing reveals during a walk (the agent fires reveals at a pause, as today).
- Any LLM inside webnav (#5a) — classification of kind, when ambiguous, escalates to the agent.
- Multi-site / inter-node changes — this is intra-site (interior) only.

## 10. Success criteria

1. A node's affordances carry kind + structure; reveal overlays expose their children; the router projects edges identically to the behavior the old `edges` table produced (192 tests green after rewrite, plus new affordance-tree tests).
2. The viewer renders each node's repertoire as a categorized, expandable list, and every navigation edge visibly leaves the **specific affordance row** that triggers it (point I).
3. Reciprocal pairs and self-loops render cleanly via floating edges — no arrow cuts through a box, no overlapping a↔b lines (point II).
4. The saucedemo example (§8) renders showing the hamburger menu's hidden options, the same-page sort/add-to-cart as non-routing repertoire, and the unexplored "About" as a dangling stub.
