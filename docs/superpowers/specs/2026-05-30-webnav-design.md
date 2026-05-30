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

States and edges are the **reusable skeleton** (principle #6). Specific repos and their stats are **runtime data** that flows through the skeleton, never stored as map.

### State (node)

```
State {
  id              # stable internal id
  semantic_name   # "github:search-results", "github:repo-overview", ...
  url_pattern     # e.g. "github.com/search?q=*" (a pattern, not a fixed URL)
  signals_here    # which declared signals this state exposes
                  #   (repo-overview: stars, last-commit, license, topics, about, releases-link, ...)
  fingerprint     # how to recognize "am I in this state?" — key declared elements present
}
```

`github:repo-overview` is **one** node, not one-per-repo. The specific repo is runtime data flowing through it.

### Edge (action)

```
Edge {
  from_state, to_state
  semantic_step   # DURABLE intent: "open the Insights tab", "enter query in primary search box"
  selector_cache  # DISPOSABLE: the playwright-cli ref/selector that worked last time
  kind            # safe-reversible | commit-point(never-traversed) | navigate
  cost            # observed tokens/time to perform
  reliability     # success_count / (success + fail)
  last_verified   # timestamp
  confidence      # derived: decays with age, rises with successful use
}
```

### Goal

```
Goal {
  name            # "find-battle-tested-repos"
  target_states   # which states hold the evidence (repo-overview, insights, issues, dependents, ...)
  surface         # which signals_here to extract and return as evidence
  # NO scoring weights. The LLM judges the surfaced evidence.
}
```

### Map vs. runtime (the critical line)

- **Map (stored, durable):** states, edges, semantic steps, goal definitions. The skeleton.
- **Runtime (never stored as map):** the actual search term, which repos returned, their current star counts / commit dates / signals. Read fresh every query, handed to the LLM, discarded.

### Recall flow

`recall "python retry lib"` → Router loads the skeleton route for `find-battle-tested-repos` → travels it (plugging the search term in as runtime data) → reads `surface` signals at each `target_state` for each candidate repo → returns the evidence bundle → LLM ranks it. The skeleton was cheap to recall; the signals are fresh.

---

## 5. Error handling & self-heal

Four failure classes, each with a defined response.

**1. Stale selector (common).** Cached selector no longer matches the live page; the semantic intent is still valid.
*Response:* LLM re-resolves the semantic step against the current snapshot → fresh ref → continue → **write the new selector back**, bump `last_verified`. Edge reliability ticks down slightly, recovers with use. The route self-heals one step at a time.

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
- **The thesis test:** run a goal twice; assert run 2 issues fewer playwright-cli calls / less exploration than run 1. Validates success criterion #2 directly.

### Deliberately NOT tested

Exact LLM rankings, exact star counts, pixel layouts — all legitimately change. We test the engine's behavior, not the web's content.

### Fixtures

A small `webnav capture <url>` dev helper saves a real snapshot into the test fixtures, so refreshing fixtures when GitHub changes is one command.

---

## 7. Open questions deferred to implementation planning

- Implementation language (TypeScript vs. Python) — to be decided in the plan, factoring in `playwright-cli` invocation ergonomics and the dogfooding context.
- MapStore concrete backing (SQLite vs. JSON) for v1 — start simple; the interface is fixed regardless.
- Exact wire schema of the stitch-ready output bundle.
- Which LLM and how it is invoked from the reasoning service.
