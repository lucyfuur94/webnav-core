# Multi-step Interactive Walk — Design Spec

**Date:** 2026-05-30
**Status:** Approved (design); building on branch `webnav-multistep`.

> The increment that finally exercises webnav's core value: remembering an
> **expensive-to-discover, multi-page route to a non-addressable state**, walking
> it edge-by-edge with per-step verification, and escalating to the agent on drift
> or at a commit point. GitHub couldn't test this (every state is URL-addressable);
> a demo store can.

## 1. Why

GitHub recall is *flat*: search-URL → results → repo-URLs (all directly
addressable via `goto`). It proved the engine but **never exercised**:
- a genuine multi-page walk where each step depends on the previous page's state,
- a destination with **no clean URL** (recognized only by fingerprint),
- the `needs-navigation` (drift) and `needs-classification` (commit-point) escalations.

This increment does. Target: **saucedemo.com** (the safe e-commerce instance chosen
in the original brainstorm — publishes its own test creds, no real charges).

## 2. Target flow (saucedemo)

States (recognized by fingerprint, NOT url):
- `sd:login` — fingerprint `['textbox:Username','button:Login']`
- `sd:inventory` — fingerprint `['button:Add to cart']` (or the inventory container)
- `sd:cart` — fingerprint `['button:Checkout']` + a cart item — NON-ADDRESSABLE (the cart URL alone, when not logged in / empty, is a different state)
- `sd:checkout-info` — fingerprint `['textbox:First Name','button:Continue']`
- `sd:checkout-overview` — fingerprint `['button:Finish']` ← **commit point reached here**

Edges (the route):
- `login → inventory`: fill username, fill password, click Login (`safe-reversible`, accepts inputs)
- `inventory → cart`: click an "Add to cart" then the cart link (`safe-reversible`)
- `cart → checkout-info`: click Checkout (`safe-reversible`)
- `checkout-info → checkout-overview`: fill names/zip, click Continue (`safe-reversible`)
- `checkout-overview → (purchase)`: the **Finish** button — `unclassified` → webnav STOPS and escalates `needs-classification`, never clicks it (principle #2).

**Goal `complete-checkout-dryrun`:** walk login→…→checkout-overview, reading evidence
along the way (cart contents, totals), and HALT at Finish with a `needs-classification`
response. Proves the multi-step walk AND the safety escalation, without ever firing a
commit point.

## 3. The interactive walk loop (the new core)

A new `walkRoute` in the Router. Given a start state, a goal route (ordered edges
from MapStore), a browser adapter, and runtime inputs (e.g. credentials), it:

```
state = startState
for each edge in the route to the goal:
  result = replayStep(edge, currentSnapshotNodes)        // cached selector → deterministic re-resolve
  if result is 'needs-classify'      → return needs-classification (agent decides)   [commit point]
  if result is 'blocked-commit'      → return needs-classification
  if result is 'escalate'            → return needs-navigation (agent picks element) [drift]
  # result is 'ok' with a ref:
  if edge.acceptsInput               → fill the ref with the runtime input
  else                               → click the ref
  snapshot the live page
  observed = matchState(snapshot, knownStates)
  # PREDICTION vs OBSERVATION:
  if observed.status != 'matched' OR observed.state.id != edge.toState
                                     → return needs-navigation (expected toState, got X)
  record success on the edge (reliability++, lastVerified)   # self-heal write-back
  state = observed.state
return done with collected evidence
```

Key properties (all from settled principles):
- **Per-step verify (prediction vs observation):** every step compares the edge's
  `toState` (expected) against `matchState` of the live snapshot (observed). Mismatch
  or ambiguity → `needs-navigation`, never march on blind (no "confidently wrong").
- **Deterministic-first, escalate-don't-guess:** `replayStep` tries the cached
  selector, then deterministic role+name re-resolve; only a real miss escalates.
- **Commit point is never fired:** the Finish edge is `unclassified`; `replayStep`
  returns `needs-classify` → walk halts and hands to the agent.
- **Self-heal write-back:** a successful (possibly re-resolved) step updates the edge
  in MapStore so the next run is cleaner.
- **Zero LLM:** all reasoning (which element on drift, is-Finish-destructive) is the
  agent's, via the response protocol.

## 4. Inputs (credentials / form fields) — runtime, not map

Form values (username, password, names, zip) are **runtime data**, never stored in the
skeleton (principle #6). `walkRoute` takes an `inputs: Record<string,string>` map; an
edge with `acceptsInput: '<slot>'` is filled from `inputs[slot]`. For saucedemo the
agent/caller supplies `{ username, password, firstName, lastName, zip }`. The skeleton
only stores *that* the step accepts a slot named e.g. `username`, not the value.

## 5. Response (reuses the existing protocol)

`walkRoute` returns the existing `RecallResponse`:
- `done` → reached the goal (checkout-overview); evidence = collected cart/total signals.
- `needs-navigation` → a step drifted (expected `toState` ≠ observed); includes the
  failing step, the live snapshot, and the question.
- `needs-classification` → reached Finish (unclassified/commit); agent decides.
- `failed` → no route in the map / unrecoverable.

The agent answers a `needs-*` and calls back to resume (resume = same walk with the
agent's decision supplied). v1 of the loop returns the escalation and lets the caller
re-invoke; a single-call resume API can come later.

## 6. Testing

- **Unit (deterministic, fixtures — no browser):** drive `walkRoute` with a scripted
  browser (snapshot stream) + a saucedemo skeleton. Cases: happy path login→overview
  returns `done`; a step whose snapshot doesn't match `toState` returns `needs-navigation`
  at that step; reaching the Finish (`unclassified`) edge returns `needs-classification`
  and does NOT fire it; a cached-selector miss self-heals via deterministic re-resolve.
- **Gated live e2e (`WEBNAV_LIVE=1`):** real saucedemo — log in with the published test
  creds, walk to checkout-overview, assert it halts at Finish with `needs-classification`
  and never completes the purchase. (Built but gated, like the GitHub live test.)

## 7. Out of scope

- A formal resume/continue API (return-escalation-and-re-invoke is enough for v1).
- Discovering the saucedemo skeleton by exploration (we author it as known structure,
  like the GitHub skeleton; live discovery is a later increment).
- Generalizing inputs beyond a flat string map.
