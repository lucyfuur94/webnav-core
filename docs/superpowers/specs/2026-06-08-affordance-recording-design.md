# Affordance Recording — Design

**Date:** 2026-06-08 · **Status:** approved (brainstorm complete) · **Increment:** affordance-recording (action-effect observations; structure-neutral analyse)

## Problem

webnav's map treats **page = state**: every distinct screen is a node, edges are actions between nodes. This broke on a real, common site shape: on saucedemo's inventory page, clicking **"Add to cart"** does NOT navigate — it flips that button to "Remove" and shows a cart badge, *staying on the same page*. Modeling that as a new state-node (`sd:inventory-carted`) created an unresolvable ambiguity (the page now matches both "has Add-to-cart" and "has Remove"), and the walk couldn't complete.

The root cause: **webnav invents structure** (a new node per in-page change; fingerprint *clustering* in `graph-analyse`) instead of recording what actually happens and letting the agent decide the structure. Most of the modern web is interactive surfaces where actions mutate the page in place; "every change is a new page" is the wrong model.

## The settled model (from brainstorm)

1. **The unit of recording is an observed action-effect, not a state.** webnav records: on page P, the agent fired element X, and here is the concrete observed result (full after-page + the diff + whether the URL changed). A "navigation" vs an "in-page mutation" is **derived from the observation** (did the URL/page fundamentally change?), never pre-classified.

2. **Record reality; filter nothing at capture (#1, #5a).** webnav captures the FULL before-page and FULL after-page (complete accessibility snapshots), the action, the computed diff, and a `navigated` flag. The diff/fingerprint/navigated are mechanical *derivations* layered on top — never a substitute for the raw snapshots, which are kept. The agent decides what matters; webnav throws nothing away at record time.

3. **webnav imposes NO structure; the calling agent decides it (#5a).** The two conceptual steps —
   - **Step 1 (judgment):** decide the best structure to represent this site → this is the **calling LLM agent**, not code inside webnav.
   - **Step 2 (mechanical):** write that structure to the map → `graph-edit` (already data-driven).
   — map onto webnav's existing call-and-response protocol. There is NO LLM in webnav; the LLM is the caller. This is *why* the approach generalizes to site shapes we've never seen: webnav never bakes in a structure, so there is none to outgrow.

4. **Corollary — `graph-analyse` does LESS, not more.** It must NOT emit pre-clustered "state-types" (clustering is itself a hardcoded structural opinion — the very thing we're removing). It returns the raw observed action-effects in clean, readable, structure-neutral form (light mechanical conveniences only: group-by-`fromUrl`, the diffs). The agent reads that and decides nodes/affordances/edges; `graph-edit` writes them.

5. **Recording fires only what the agent fires (#5a, #2).** webnav never autonomously clicks. During a record session the AGENT drives via the `use` browser verbs; webnav's new job is to capture before/after and record the diff per action. Commit points are recorded as "exists, fired-by-agent or not" — webnav never decides safe-vs-commit and never auto-fires.

## What changes vs. today

- **Record buffer becomes action-centric.** Today `record_observations` stores per page: `url, fingerprint, declared_links`. New: store per **action-effect**: the before-page (full snapshot), the action fired, the after-page (full snapshot), the computed diff, and `navigated`. (A page the agent merely lands on with no action is still recordable as an action-effect with a null action — the initial observation.)
- **`graph-analyse` is rebuilt** to return structure-neutral raw observations (drop fingerprint clustering / "state-types").
- **`graph-edit` is unchanged** — it already writes whatever states+edges the agent supplies. (The agent may now choose to encode in-page affordances however it decides; webnav doesn't constrain that.)
- **The walk engine (findPath / walkRoute / sessions / verbs — WT1–WT5) is unchanged** by this increment. It operates over whatever structure ends up in the map. (A later increment may teach the walk about in-page affordances; out of scope here.)

## Architecture

Builds on the existing record-session machinery (`record-start`/`record-stop`, `RecordStore`) and the `use` browser primitives. The change is in *what an observation captures* and *how analyse presents it*.

```
dev record-start                         → session (capture on)
use navigate / click / type / snapshot   → agent drives; for each ACTION webnav captures
                                            before-snapshot, the action, after-snapshot,
                                            computes diff + navigated, appends an action-effect
dev record-stop <session>
dev graph-analyse <session>              → raw, structure-NEUTRAL action-effects per site
                                            (grouped by fromUrl as a convenience; NO clustering,
                                            NO node/edge opinion)
   ↓  the AGENT (LLM caller) decides the structure for this site
dev graph-edit --node … --graph <agent's structure>   → writes it (unchanged)
```

## Components

**Record buffer (`src/mapstore/record.ts` + schema) — action-centric:**
The `Observation` becomes an **ActionEffect**:
```
{
  seq, fromUrl, fromSnapshot (full YAML),
  action: { role, name, ref } | null,      // null = initial landing observation
  toUrl, toSnapshot (full YAML),
  navigated: boolean,                        // toUrl host/path differs from fromUrl (observed)
  diff: { added: SnapNode[], removed: SnapNode[] }   // mechanical, derived from the two snapshots
}
```
- `RecordStore.appendActionEffect(sessionId, effect)` (the existing `append` shape extends/forks to this). Full snapshots are stored (no filtering). New columns or a JSON blob column on `record_observations` (a migration; the table already exists).
- **Diff** is computed mechanically (set difference of parsed snapshot nodes by role+name+ref). It is a convenience; the raw `fromSnapshot`/`toSnapshot` are authoritative and kept.
- **`navigated`** = the URL changed materially (different path/host). A fact.

**Recording seam (`src/router/browse.ts`) — capture before/after around an action:**
Extend the recordable browse path so that when the agent performs an *action* (click/type/navigate) inside an active record session, webnav: snapshots before (or reuses the last after), performs the action, snapshots after, computes diff + navigated, and appends an ActionEffect. (Today `runSnapshotRecorded` records a single page; the new path records an action and its effect.) The agent still drives — webnav records around each `use` action.

**`graph-analyse` (`src/explorer/analyse.ts`) — rebuilt, structure-neutral:**
Input: the session's ActionEffects. Output, per site (grouped by host — the only grouping, a convenience):
```
{ sites: [ { node: "<host>",
             observations: [ { fromUrl, action, toUrl, navigated,
                               diff: {addedSummary, removedSummary},
                               // raw snapshots available but summarized for readability;
                               // full snapshots remain in the record buffer for the agent
                             }, … ] } ],
  // NO "states"/"state-types"/clustering. NO nodes/edges. Just observed reality.
}
```
- Removes the fingerprint-clustering + machine-labelled "state-type-N" logic (that was a baked-in structure).
- The agent reads these observations and decides the site's structure (which pages are nodes, which affordances belong to a node, which actions are navigations → edges), then calls `graph-edit`.
- `extractContent`/token-savings helpers may summarize a full snapshot for the analyse *view*, but the buffer keeps the raw — the agent can request raw if needed.

**`graph-edit` — unchanged.** Writes the states + edges the agent decided.

## Data flow (saucedemo, the bug that drove this)

```
record-start
use navigate https://www.saucedemo.com/inventory.html   → effect: action=null, lands on inventory (full snapshot A)
use click <add-to-cart ref>                              → effect: from=A, action=click "Add to cart",
                                                             after=B, navigated=FALSE,
                                                             diff: added [button "Remove", text "1"],
                                                                   removed [button "Add to cart"(this one)]
use click <cart-link ref>                                → effect: from=B, action=click cart link,
                                                             after=C (cart.html), navigated=TRUE,
                                                             diff: whole-page change
record-stop
graph-analyse → { sites:[{ node:"www.saucedemo.com", observations:[ …the three above… ] }] }
   (NO node invented for "inventory-carted"; the add-to-cart effect is just "in-page mutation, URL unchanged")
agent decides: inventory is ONE page-node; "Add to cart"/"Remove" are in-page affordances;
   the cart link is a navigation edge inventory → cart. Writes via graph-edit.
```
The original ambiguity never arises — webnav never invents the second node; it records that add-to-cart mutates the page in place (observed `navigated:false`), and the agent models it as an affordance.

## Error handling

- **Action fails / element gone:** the ActionEffect records the attempt with `toSnapshot` = the unchanged page and an empty/odd diff; surfaced honestly, not hidden.
- **Bot-wall/interstitial after an action:** the after-snapshot captures it; `classifyReadiness` (existing) flags it; recorded as-is, never evaded.
- **`graph-analyse` on an empty session:** exit 3 + hint (as today).
- **Huge snapshots:** stored raw in the buffer (SQLite TEXT); analyse *view* summarizes. No capture-time filtering.

## Testing strategy

- **Diff computation (unit, no browser):** before/after snapshot fixtures → assert added/removed/`navigated` are correct (incl. the saucedemo add-to-cart case: added Remove+badge, removed one Add-to-cart, navigated=false; and a real navigation case: navigated=true).
- **`RecordStore.appendActionEffect` (unit):** round-trips full snapshots + action + diff + navigated; nothing filtered; null-action initial observation works.
- **`graph-analyse` structure-neutral (unit):** feed synthetic ActionEffects → assert output is grouped-by-host raw observations with NO `states`/`state-type`/cluster fields (assert their absence — the anti-regression guard for "no imposed structure"); navigated flags + diffs present.
- **Recording seam (unit, fake adapter):** firing an action inside an active session appends exactly one ActionEffect with before/after captured; outside a session, nothing recorded.
- **Gated live e2e (`WEBNAV_LIVE=1`):** record a real saucedemo add-to-cart → assert the recorded effect has `navigated:false` and a diff showing the button flip; record the cart-link click → `navigated:true`. (Proves the model captures reality.)

## Out of scope (this increment)

- Teaching the **walk engine** to traverse in-page affordances (walk currently follows page-to-page edges; in-page affordance walking is a later increment).
- Any **autonomous probing** by webnav (the agent always drives — #5a).
- Re-seeding existing site skeletons into the new representation (the seed skeletons stay; this changes how NEW recordings are captured + analysed; migrating seeds is separate).
- A fixed schema for "affordances" in the map — webnav doesn't impose one; the agent encodes structure via `graph-edit` as it sees fit.

## Migration / compatibility

- `record_observations` gains action-effect fields (JSON blob column for snapshots/diff + `navigated`, `action` columns) via an idempotent migration; the page-only `runSnapshotRecorded` path can remain for plain reads, or be expressed as an action-effect with `action:null`.
- `graph-analyse`'s output shape changes (structure-neutral). The site-mapping flow's consumers (the agent prompts/docs) update to the new shape. The previous clustered output is removed — a deliberate breaking change, since clustering was the baked-in structure we're eliminating.
- The walk engine and the graph viewer are unaffected (they read the map the agent writes via `graph-edit`, which is unchanged).
