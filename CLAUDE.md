# CLAUDE.md — zy-core / `webnav`

> **Read this first, every session. These are settled decisions. Do not deviate without an explicit decision to change them.**

## What this project is

**"Google Maps for the agent-internet."** A web-navigation **memory** that lets agents recall cheap, reliable routes to goals on a website instead of re-exploring from scratch every time. The core win is **speed and cost**: the second time an agent needs to get somewhere, it recalls the route rather than re-discovering it.

It is **a map, not a driver.** It gets the agent to where the signals live, cheaply and reliably. It does **not** decide what to do or judge what it finds — that stays with the LLM.

## The mental model (settled)

A **place index + weighted routing graph** (Google Maps does BOTH place-lookup and directions — so does webnav):
- **Nodes = states** of a site (what's true / what's possible from here). A URL is an *attribute* of a state, not the node itself (same URL can be many states; many URLs can be one state).
- **Edges = actions** (click/type/navigate) that transition between states. Every edge carries **cost** (tokens/time), **reliability** (success/fail history), and **age/confidence** (decays over time).
- **Goals = named destinations** the agent cares about, plus *what signals to surface there*. A goal index resolves intent → target state + route.

The map answers TWO kinds of query:
- *"Where is A?"* → **locate** (place-lookup) — return A's coordinate WITHOUT traversing. The agent can jump there itself or just know where it is.
- *"I'm in state X, I want goal G."* → **recall** (directions) — give the cheapest reliable route, travel it, and bring back evidence. (recall = locate + travel + read.)

## Coordinate system (settled) — webnav's "lat/lon"

Two tiers, because not every place has a street address:
1. **Addressable place → canonical URL.** When a place has a stable canonical URL (e.g. `github.com/trending`, `github.com/owner/repo`), the URL IS its coordinate: you `goto(url)` and land directly, **no routing needed**. This is the lat/lon of the addressable web and powers `locate`.
2. **Unaddressable place → semantic state identity + fingerprint (+ the route that reaches it).** Modals, filtered/sorted views, logged-in dashboards often have no clean URL. Their coordinate is the durable **semantic state name + fingerprint** (how you recognize you've arrived), reached by replaying the route. (Like a map pinning "the bench behind the third oak" by description + path, not a coordinate.)

URL is the lat/lon of the *addressable subset* — NOT a universal coordinate (it's site-specific, and a URL ≠ a state). Prefer the URL shortcut when canonical; fall back to state+fingerprint otherwise.

## Settled principles (do not violate)

1. **Observe first, traverse rarely.** Build the map primarily by *reading what the page declares* (snapshot, hrefs, form targets, ARIA, labels). Execute only **safe, reversible** actions to reveal hidden state. This mirrors how Google Maps was actually built — from licensed/observed data, not by driving every road. The web *announces its own roads*; exploit that.

2. **Never traverse a declared commit point.** Destructive/irreversible actions (Place Order, Pay, Send, Delete) are mapped **by inference from the page's declaration**, never fired. (v1 on GitHub is read-only, so this is trivially satisfied — but the rule is permanent.)

3. **Store what doesn't change; cache what does.** A route has two layers:
   - **Durable semantic route** — the *intent* of each step ("find the primary search box, enter the query, open the top repo's insights"). Survives redesigns.
   - **Disposable selector cache** — the concrete selectors/refs that worked last time. Expected to break.
   On recall: try the cheap cached selectors first; on miss, re-resolve that step from semantic intent against the live page, and **write the repair back.** The map **self-heals from usage**, one step at a time.

4. **Confidence decays with age, updates with use.** Recall prefers recently-verified, high-reliability routes. Using a route re-verifies it. Routes nobody uses are allowed to go stale — that's correct. The map gets freshest exactly where it's used most.

5. **The map surfaces evidence; it does NOT score or judge.** No hard-coded rubrics, no per-goal scoring formulas. The map routes and reads declared signals; **the calling AGENT does all judgment/ranking**, per use-case, using its own reasoning. Keeping the map judgment-free is what makes it generalize to every future goal.

5a. **webnav contains ZERO LLM — it is pure navigation infrastructure (settled).** webnav never reasons. All reasoning (ranking evidence, resolving a broken step, classifying whether an action is destructive) is offloaded to the **calling agent** via a call-and-response protocol. webnav surfaces evidence and, when it hits a fork it isn't allowed to decide, returns a structured "your move" response. The agent holds the brain; webnav holds the map and the mechanics. This is the natural MCP shape and keeps webnav cheap, deterministic, and testable (no API keys, no provider config, hot path has no LLM call).
   - **Response protocol** — `recall(goal, query)` returns one of:
     - `{ status: "done", evidence }` — reached the goal; here are the declared signals (agent ranks).
     - `{ status: "needs-navigation", at, semanticStep, snapshot, question }` — deterministic self-heal failed on real drift; agent picks the ref, webnav continues and writes the repair back.
     - `{ status: "needs-classification", action, snapshot }` — encountered an action that might be destructive; agent decides safe vs commit-point before webnav traverses.
     - `{ status: "failed", reason }` — genuinely no route.
   - **resolve** is deterministic-first (cached ref present? role+name match in snapshot?); only real drift escalates to `needs-navigation`. **classify** is never done by webnav — commit-points come back as `needs-classification` (or are pre-tagged on the route as static data). **judge/rank** never happens in webnav at all.

6. **Map = use-case-INDEPENDENT navigation skeleton (built ahead of time).**
   - What we *remember* is the reusable **navigation skeleton** of a site (how to reach search, apply filters, get from a result to its detail pages). This is explored **ahead of time / open-endedly** and is durable.
   - A **use-case query travels** that skeleton and reads **fresh signals** each time. The use-case does NOT build the map; it *uses* it. Use-case-specific data (search terms, which repos came back, their current stats) is fresh every time and is **never** stored as map (it changes constantly).
   - **Hard split (settled in design review):** the **skeleton = site STRUCTURE only** (states + edges; knows nothing about repos/stars). The **goal = SIGNAL interests** (which states to visit, which signals to surface, candidate_limit). Anything GitHub-repo-specific lives ONLY in the goal, never in the skeleton. Goals reference the skeleton; the skeleton never references goals. This is what keeps the map judgment-free and generalizable to npm/PyPI later.

## Architecture (settled — "Approach 1": three components behind one CLI; ZERO LLM)

One `webnav` CLI orchestrating three independently-testable components. **No LLM service** — reasoning is offloaded to the calling agent via the response protocol (principle #5a).

- **Explorer** — *"Given a start + goal, extend the map by READING the site."* Drives `playwright-cli`, snapshots, builds states/edges from declared structure (links/buttons/inputs), traverses only navigate/safe edges. Unclassified actions are surfaced for the agent, not classified by webnav. Writes nodes/edges to MapStore. Depends on: playwright-cli.
- **MapStore** — *"Persist the graph; answer structural queries."* Owns the data model (states, edges+weights, goals, semantic route + selector cache). SQLite. Depends on: nothing (pure persistence).
- **Router** — *"Given a goal, return cheapest reliable route, replay, self-heal deterministically, return evidence OR a 'your move' response."* Asks MapStore for a route (or Explorer to build one), replays via playwright-cli (cached selectors first; deterministic role+name re-match on miss; real drift → `needs-navigation` to the agent; repairs written back). Surfaces raw declared signals. Does NOT score, does NOT call an LLM. Depends on: MapStore, playwright-cli.

Browser automation layer: **`playwright-cli`** (github.com/microsoft/playwright-cli) — built for agents, token-efficient, returns stable element refs from `snapshot`.

**Tech stack (settled in planning):**
- Language: **TypeScript** (strict), Node. Test runner: **vitest**.
- Browser: **`playwright-cli`** invoked as a child process via a thin adapter.
- MapStore backing: **SQLite** (via `better-sqlite3` — synchronous, fits one-serialized-session model).
- **No LLM dependency in webnav.** The calling agent supplies all reasoning via the response protocol (#5a). webnav has no API keys, no provider config.

## v1 scope (settled)

**Target site:** GitHub (read-only, public browsing — no auth, no checkout, no commit points).

**v1 deliverable:** `webnav recall "<use-case>"` →
1. travels the GitHub navigation skeleton (search for the query → top-N candidate repos → each repo's detail/signal pages),
2. **reads and returns the declared quality signals** compactly as an **evidence bundle** (each candidate: id, url, declared signals like stars/last-commit/issues/license),
3. returns `{ status: "done", evidence }` — **the calling AGENT ranks** into a battle-tested + relevant shortlist using its own judgment. webnav does NOT rank.

If deterministic navigation can't complete (real drift / ambiguous action), webnav returns `needs-navigation` / `needs-classification` instead, and the agent supplies the missing decision (principle #5a).

Output is **structured so a future stitching layer can consume multiple evidence bundles** (stitching itself is v2, designed-for not built).

**Why this v1:** real pain (web search returns un-vetted repos), read-only/safe, exercises the full map engine on a real high-value site, immediately dogfoodable (an agent — e.g. Claude Code — calls webnav, supplies judgment, gets a vetted shortlist; used to find libs to build the rest of this project).

**Success criteria:**
1. The evidence bundle lets the calling agent pick repos genuinely more battle-tested + relevant than plain web search (user judges — dogfood). This is the QUALITY half: web search returns un-vetted repos; a generic agent ad-hoc-driving playwright gets lost in GitHub's heavy UI. webnav delivers a reliable, structured path to the signal-bearing pages and returns clean evidence.
2. **The core thesis (corrected): the saving is the calling AGENT's LLM tokens + wall-clock — NOT playwright-cli page-loads.** Without webnav, the agent burns tokens every query reading huge page snapshots into its context and reasoning step-by-step about what to click. webnav does that navigation **deterministically (zero LLM)** and hands back a compact evidence bundle, so the agent spends expensive reasoning ONCE — on judging results — not on re-discovering the route. Measured in agent tokens + time, the win is large and applies on EVERY run (not just run-2). `playwright_calls` is a minor diagnostic, not the headline metric. The evidence bundle reports an estimated **tokens-saved** figure (raw-snapshot tokens the agent avoided ingesting vs. the compact bundle it receives).
   - *Note:* a literal "run-2 navigates fewer pages than run-1" drop does NOT occur on GitHub — search + each detail are irreducible fresh re-reads, and the skeleton already jumps directly via URL. That kind of drop only appears on sites needing DISCOVERED multi-step UI navigation to non-addressable states; GitHub is not such a site. We do not fake it. The real, measurable saving here is agent tokens/time, per above.
3. Never re-explores the skeleton from scratch; self-heals deterministically when a remembered page changed, escalating to the agent only on real drift.

**Out of scope for v1:** stitching (designed-for only), destructive actions (none on GitHub), auth/login, multi-site mapping, proactive background re-crawl (self-heal-on-use only), **any LLM inside webnav** (reasoning is the agent's job — #5a).

## Status

v1 built + merged to main (zero-LLM engine; verbs: list/describe/locate/recall + capture; 61 tests). Spec: `docs/superpowers/specs/2026-05-30-webnav-design.md`. Plan: `docs/superpowers/plans/2026-05-30-webnav.md`.

**Memory loop wired (increment M1–M3, branch `webnav-memory-loop`):** the live path now goes Router→MapStore→Explorer. `exploreGitHub(store)` persists the structure-only skeleton (M1); `recallViaMap` builds it once if absent and never re-explores a known skeleton, then delegates to `recall` (M2); `live.ts` uses a FILE-backed MapStore so the skeleton survives across separate runs, proven by a deterministic test that reopens a fresh MapStore from disk on run-2 and confirms no re-exploration (M3, criterion #3). 69 unit tests + 1 gated live e2e.

**Honest remaining gap:** criterion #2 (run-2 *cheaper* in playwright calls) is only partially realized — the live path still navigates search + each detail every run, so per-run call counts are similar. The architectural "built once, never re-explored" invariant holds; a dramatic per-run cost drop awaits a future increment where replay can SKIP navigation for addressable steps (use `locate`/URL coordinates to jump directly instead of re-traversing). Also still pending: richer signal extraction (5 of 7 signals), self-growing gazetteer, optional MCP surface, and a real live dogfood run against GitHub.
