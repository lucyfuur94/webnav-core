# webnav — Design Spec

**Date:** 2026-05-30
**Status:** Approved (design); pending user review of this document before implementation planning.
**Working name:** `webnav` (project: `zy-core`)

---

## 1. What we're building

**"Google Maps for the agent-internet."** A web-navigation **memory** that lets agents recall cheap, reliable routes to goals on a website instead of re-exploring from scratch every time. The core value is **speed and cost**: the second time an agent needs to reach a goal, it recalls the route rather than re-discovering it.

It is **a map, not a driver.** It gets the agent to where the relevant signals live, cheaply and reliably. It does **not** decide what to do or judge what it finds — that stays with the LLM.

### v1 deliverable

A CLI the agent invokes. Given a use-case (e.g. *"a Python library for retrying flaky HTTP calls"*), `webnav` navigates **GitHub** via `playwright-cli`, reads the quality signals GitHub declares, and returns a **ranked, evidenced shortlist** of repos — each with the raw signals (stars, last commit, dependents/used-by, issue health, releases, license, CI presence, etc.) and a one-line "why." The **ranking is judged by the LLM, not a hard-coded rubric.** Output is structured so a future *stitching* layer can consume multiple shortlists.

### Why this v1

- **Real pain, now:** web search returns un-vetted, un-maintained repos. This is something we will dogfood — using it to find the libraries to build the rest of this project.
- **Safe by nature:** repo discovery is read-only. No checkout, no destructive commits, no real transactions. The "never traverse a commit point" rule is trivially satisfied.
- **Exercises the full engine** on a real, high-value site (GitHub: deep hierarchy, rich state, the documented hard class of "navigation + information-extraction" tasks).

### Success criteria

1. For a real use-case, it returns repos genuinely more battle-tested + relevant than a plain web search (user judges — direct dogfood test).
2. The **second** run of the same/similar goal is cheaper and faster than the first, because the map recalled the route instead of re-exploring. *(The core thesis.)*
3. It never re-explores from scratch what it already mapped, and self-heals when a remembered GitHub page has changed.

### Out of scope for v1

Stitching (designed-for, not built); destructive actions (none on GitHub); auth/login (public browsing only); multi-site mapping (GitHub only); proactive background re-crawl (self-heal-on-use only).

---

## 2. Settled principles (invariants)

These govern every design and implementation decision. Do not violate without an explicit decision to change them.

1. **Observe first, traverse rarely.** Build the map primarily by *reading what the page declares* (snapshot, hrefs, form targets, ARIA, labels). Execute only **safe, reversible** actions to reveal hidden state. The web announces its own roads — exploit that. (This mirrors how Google Maps was actually built: from licensed/observed data, not by driving every road.)

2. **Never traverse a declared commit point.** Destructive/irreversible actions (Place Order, Pay, Send, Delete) are mapped **by inference from the page's declaration**, never fired. Permanent rule, even though GitHub v1 has no commit points.

3. **Store what doesn't change; cache what does.** A route has two layers:
   - **Durable semantic route** — the *intent* of each step. Survives redesigns.
   - **Disposable selector cache** — the concrete selectors/refs that worked last time. Expected to break.

4. **Confidence decays with age, updates with use.** Recall prefers recently-verified, high-reliability routes. Using a route re-verifies it. Routes nobody uses are allowed to go stale — that is correct. The map gets freshest exactly where it is used most.

5. **The map surfaces evidence; it does NOT score or judge.** No hard-coded rubrics, no per-goal scoring formulas. The map routes and reads declared signals; the **LLM** does all judgment/ranking, per use-case. Keeping the map judgment-free is what makes it generalize to every future goal.

6. **Map = use-case-INDEPENDENT navigation skeleton, built ahead of time.** What we *remember* is the reusable navigation skeleton of a site (how to reach search, apply filters, get from a result to its signal-bearing pages). A **use-case query travels** that skeleton and reads **fresh signals** each time. The use-case does NOT build the map; it *uses* it. Use-case-specific data (search terms, which repos came back, their current stats) is fresh every time and is **never** stored as map.

---

## 3. Architecture

"Approach 1": one `webnav` CLI orchestrating three independently-testable components plus one shared LLM service.

```
        agent / user
            │  webnav recall "python lib for retrying flaky HTTP"
            ▼
   ┌─────────────────────────────────────────────────────────────┐
   │                      webnav CLI (orchestrator)                │
   └───────┬───────────────────┬───────────────────────┬──────────┘
           │                   │                       │
           ▼                   ▼                       ▼
   ┌──────────────┐    ┌──────────────┐        ┌──────────────┐
   │   ROUTER     │◄──►│   MAPSTORE   │◄──────►│   EXPLORER   │
   └──────┬───────┘    └──────────────┘        └──────┬───────┘
          │                                           │
          └──────────────┐         ┌──────────────────┘
                         ▼         ▼
                   ┌──────────────────────┐
                   │  LLM REASONING SVC    │
                   └──────────┬────────────┘
                              ▼
                       ┌──────────────┐
                       │ playwright-  │ ──► the live web (GitHub)
                       │    cli       │
                       └──────────────┘
```

### Component contracts

**Explorer** — *"Given a start + goal, extend the map by READING the site."*
Drives `playwright-cli`, takes snapshots, builds states/edges primarily from declared structure (hrefs, form targets, ARIA, labels). Clicks only safe/reversible actions to reveal hidden state. Calls the LLM service to classify actions or interpret a state. **Writes** new/updated nodes and edges to MapStore. **Depends on:** playwright-cli, LLM service.

**MapStore** — *"Persist the graph; answer structural queries about it."*
Owns the data model (states, edges with weights, goal index, semantic route + selector cache). Stores the durable semantic route and disposable selector cache separately. Starts as SQLite or JSON — no premature graph DB. **Interface:** `get_route(goal)`, `upsert_state(...)`, `upsert_edge(...)`, `record_outcome(edge, success|fail)`, `decay_confidence()`. **Depends on:** nothing (pure persistence).

**Router** — *"Given a goal, return the cheapest reliable route, replay it, self-heal, return evidence."*
Asks MapStore for a route; if none exists, asks Explorer to build one. Replays via playwright-cli — cached selectors first, LLM semantic re-resolution on miss (repairs written back). Surfaces the raw declared signals at the destination. **Does NOT score** — hands evidence to the LLM. **Depends on:** MapStore, playwright-cli, LLM service.

**LLM Reasoning Service** (shared) — the only place LLM calls live. Three jobs:
- **classify** an action: safe-reversible vs. commit-point;
- **resolve** a semantic step to a live element when the selector cache misses;
- **judge/rank** the surfaced evidence into the shortlist.

Both Explorer and Router call it; neither embeds reasoning itself.

**Browser layer:** `playwright-cli` (github.com/microsoft/playwright-cli) — built for agents, token-efficient, returns stable element refs from `snapshot`.

---

## 4. Data model

The model has a hard separation between two layers (the resolution of the review's deepest finding):

- **The skeleton = site STRUCTURE only.** States and the edges between them describe *how a site is shaped and navigated* — search → result → detail pages. The skeleton knows nothing about repos, stars, or any goal. It is genuinely use-case-independent (principle #6) and would generalize to npm/PyPI later.
- **The goal = SIGNAL interests.** A goal declares *which* states to visit and *which* signals to surface at each — the only place anything GitHub-repo-specific (stars, dependents) lives. Goals reference the skeleton; the skeleton never references goals.

Specific repos and their stats are **runtime data** that flows through the skeleton, never stored as map.

### State (node) — structure only

```
State {
  id              # stable internal id
  semantic_name   # "github:search-results", "github:repo-detail", "github:repo-insights", ...
  url_pattern     # e.g. "github.com/search?q=*" (a pattern, not a fixed URL)
  role            # structural role: search-entry | result-list | detail | sub-detail
  available_signals  # the signals this state is CAPABLE of exposing, named generically
                     #   (a state advertises what's readable here; the GOAL decides what to read)
  fingerprint     # how to recognize "am I in this state?" — key declared elements present.
                  #   On ambiguous/failed match: escalate to the LLM service, NEVER guess silently.
                  #   (Exact composition + matching rule is driven out via TDD in the plan.)
}
```

`github:repo-detail` is **one** node, not one-per-repo. The specific repo is runtime data flowing through it. Note `available_signals` describes capability, not goal intent — a repo-detail state *can* expose stars/topics/license; whether we read them is the goal's call.

### Edge (action)

```
Edge {
  from_state, to_state
  semantic_step   # DURABLE intent: "open the Insights tab", "enter query in primary search box"
  selector_cache  # DISPOSABLE: the playwright-cli ref/selector that worked last time
  kind            # safe-reversible | commit-point(never-traversed) | navigate
  accepts_input   # optional: names a runtime slot this edge consumes (e.g. "query").
                  #   The search-box edge declares accepts_input="query"; Router injects the
                  #   recall term here. This makes search-term injection explicit, not implicit.
  cost            # observed cost to perform (see §4.1)
  reliability     # success_count / (success + fail)
  last_verified   # timestamp
  confidence      # derived: decays with age, rises with successful use
}
```

### Goal — signal interests (the only goal-specific layer)

```
Goal {
  name            # "find-battle-tested-repos"
  visit           # ordered list of state roles/ids to visit per candidate
                  #   (detail; optionally sub-details like insights/dependents)
  surface         # which of each visited state's available_signals to extract as evidence
  candidate_limit # how many candidates from the result-list to process. Default 10, configurable
                  #   via `recall ... --top N`. Bounds cost; prevents "traverse 1000 results".
  # NO scoring weights. The LLM judges the surfaced evidence.
}
```

### Map vs. runtime (the critical line)

- **Map (stored, durable):** states, edges, semantic steps, goal definitions. The skeleton + goals.
- **Runtime (never stored as map):** the actual search term, which repos returned, their current star counts / commit dates / signals. Read fresh every query, handed to the LLM, discarded.

### 4.1 Cost measurement

`cost` is defined concretely as **`playwright-cli call count + LLM call count`** for the step (or summed over a route). This is cheap to log and makes success criterion #2 directly testable: run a goal twice, assert run 2 issues strictly fewer of both than run 1. Wall-clock is recorded too, but call-counts are the primary, deterministic metric. Route preference ("cheapest reliable route") ranks by summed call-count cost weighted by reliability.

### Recall flow

`recall "python retry lib"` → Router loads the skeleton route for `find-battle-tested-repos` → travels it, **injecting the term at the edge whose `accepts_input="query"`** → at the result-list, selects the **top `candidate_limit`** results (in GitHub's own search ranking order, deduped by owner/repo) → for each candidate, visits the goal's `visit` states and reads the goal's `surface` signals → returns the evidence bundle → LLM ranks it. The skeleton was cheap to recall; the signals are fresh.

### 4.2 Output schema (stitch-ready)

The recall output is a structured bundle so a future stitching layer can consume several at once:

```json
{
  "goal": "find-battle-tested-repos",
  "query": "python lib for retrying flaky HTTP",
  "candidates": [
    {
      "id": "owner/repo",
      "url": "https://github.com/owner/repo",
      "signals": {
        "stars": 1234,
        "last_commit": "2026-05-15",
        "open_issues": 12,
        "closed_issues": 480,
        "latest_release": "2.1.0 (2026-04-02)",
        "license": "MIT",
        "dependents": 5300,
        "has_ci": true
      },
      "why": "one-line LLM rationale"
    }
  ],
  "ranked_by": "llm",
  "cost": { "playwright_calls": 0, "llm_calls": 0, "wall_ms": 0 }
}
```

Signal keys present depend on the goal's `surface` and what the live page declared; absent signals are omitted, never fabricated.

---

## 5. Error handling & self-heal

Four failure classes, each with a defined response.

**1. Stale selector (common).** Cached selector no longer matches the live page; the semantic intent is still valid.
*Response:* LLM re-resolves the semantic step against the current snapshot → fresh ref → continue → **write the new selector back**, bump `last_verified`. Edge reliability ticks down slightly, recovers with use. The route self-heals one step at a time. **Re-resolution must not silently guess:** if the LLM cannot confidently map the semantic step to a live element, this escalates to case 2 (re-exploration), never an arbitrary click. (The confidence threshold is tuned during implementation.)

**2. Structural drift (rare, serious).** The state itself changed — a page is gone, or a step leads somewhere whose fingerprint matches no known state.
*Response:* flag the edge broken, drop confidence sharply, **hand off to Explorer** to re-map that local region from the last known-good state. Write the repaired sub-route back. If re-exploration cannot reach the target state, return an honest *"route lost, re-exploration failed"* — never a silent wrong answer.

**3. Transient web failure** (network blip, partial load, rate-limit, 5xx).
*Response:* bounded retry with backoff at the playwright-cli layer. Distinguish "page failed to load" (retry) from "page loaded but step doesn't match" (cases 1/2). **Never** record a transient failure as an edge-reliability hit.

**4. No route yet** (cold start, or an unexplored goal/region).
*Response:* Router asks Explorer to build it. If exploration itself fails, return an honest *"couldn't map a route"* — never fabricate.

### Cross-cutting guarantees

- **Never fabricate.** A lost, unrebuildable route returns an explicit failure. A wrong route confidently followed is the worst outcome.
- **Always write learnings back.** Every recall updates the map — selectors repaired, reliability/confidence adjusted, `last_verified` stamped.
- **Bound the blast radius.** Self-heal touches one step; re-exploration touches one local region — never silently re-crawl the whole site mid-query.
- **Safety holds in error paths.** Re-exploration and self-heal still obey "observe first, never traverse a commit point."

### Operational notes (flagged for the plan, not fully designed here)

- **Session model:** v1 uses **one `playwright-cli` session per `webnav` invocation**, and Explorer/Router calls within an invocation are **serialized** (no concurrency). This keeps selector validity and cost predictable. A persistent shared session is a later optimization.
- **GitHub rate limits:** unauthenticated browsing is subject to GitHub's rate limits, which can throttle repeated recalls. This is a feasibility risk to **verify empirically early in implementation** (measure limits on the first few queries). Mitigations if needed (short-lived result caching, optional auth) are deferred, but the risk is named so the plan budgets for it. Transient rate-limit responses are handled as case 3 (retry/backoff), never recorded as edge-reliability hits.

---

## 6. Testing strategy

Isolate the engine from the live web using captured snapshots; reserve a few live runs for end-to-end smoke tests.

### Per-component tests (fast, deterministic, no network)

- **MapStore** — pure persistence, no browser. Upsert states/edges, retrieve a route, `record_outcome` adjusts reliability, `decay_confidence` ages correctly, semantic-route and selector-cache stored/retrieved separately.
- **Explorer** — fed saved `playwright-cli snapshot` fixtures (real GitHub pages, checked in). Asserts: builds expected states/edges from declared structure; correctly classifies safe vs. commit-point; never marks a navigate-link as needing traversal.
- **Router** — the most important tests (self-heal is the riskiest logic):
  - *Happy path:* stored route + matching snapshot → replays, surfaces right signals.
  - *Stale selector (case 1):* snapshot with the cached selector deliberately broken but semantic target present → re-resolves, continues, **writes repair back**.
  - *Structural drift (case 2):* snapshot missing the target state → flags broken, hands to Explorer, returns honest failure if unrecoverable.
  - *Transient failure (case 3):* simulated load failure → retries, reliability **not** poisoned.
- **LLM Reasoning Service** — *classify* and *resolve* asserted against known snapshots. *judge/rank* is non-deterministic, so test the **contract** (returns a ranked list with evidence + reasons; never invents repos absent from the input), not exact ordering.

### End-to-end smoke tests (slow, live, few)

- A handful of real `webnav recall "<use-case>"` runs against live GitHub, asserting structural properties (≥1 repo; every repo has declared signals attached; output matches the stitch-ready schema), not exact results.
- **The thesis test:** run a goal twice; assert run 2 issues strictly fewer playwright-cli calls **and** LLM calls than run 1 (the cost metric defined in §4.1). Validates success criterion #2 directly.
- **Schema test:** assert every recall output validates against the §4.2 stitch-ready schema (candidates carry `id`, `url`, `signals`, `why`; no fabricated signal keys).

### Deliberately NOT tested

Exact LLM rankings, exact star counts, pixel layouts — all legitimately change. We test the engine's behavior, not the web's content.

### Fixtures

A small `webnav capture <url>` dev helper saves a real snapshot into the test fixtures, so refreshing fixtures when GitHub changes is one command.

---

## 7. Open questions deferred to implementation planning

- Implementation language (TypeScript vs. Python) — to be decided in the plan, factoring in `playwright-cli` invocation ergonomics and the dogfooding context.
- MapStore concrete backing (SQLite vs. JSON) for v1 — start simple; the interface is fixed regardless.
- Which LLM and how it is invoked from the reasoning service.
- **Fingerprint composition + matching rule** — the precise definition of "key declared elements" and the match/escalate threshold. Design intent is fixed (§4: recognize by declared elements; escalate to LLM on ambiguity, never guess); the exact rule is driven out via TDD.
- **Re-resolution confidence threshold** value (§5 case 1) — tuned empirically.
- **GitHub rate-limit behavior** — measure early; decide if caching/auth mitigation is needed (§5 operational notes).
- **Persistent/shared playwright-cli session** — v1 is one-session-per-invocation, serialized; revisit for performance later.

> Resolved during design review (now specified above, no longer open): structure-vs-signal split (§4), search-term injection via `accepts_input` (§4), candidate selection + `candidate_limit` (§4), cost measurement (§4.1), and the stitch-ready output schema (§4.2).
