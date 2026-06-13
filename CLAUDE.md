# CLAUDE.md — webnav-core / `webnav`

> **Read this first, every session. These are settled decisions. Do not deviate without an explicit decision to change them.**

## Subagent model (settled)

**Subagents that USE or TEST webnav run on Haiku** (`claude-haiku-4-5-20251001`) — for both usage and testing. webnav is zero-LLM navigation infrastructure; its calling agent does the judgment, and that calling agent should be the cheap model — a deliberate dogfood of the cost thesis (a cheap agent + webnav's deterministic navigation should beat an expensive agent ad-hoc-driving the browser). Use `model: 'haiku'` on `Agent`/`Workflow agent()` calls that drive or exercise webnav. (Benchmark ARMS are a deliberate exception when a run must hold the model constant across arms — note it in that run's recipe.)

**This Haiku rule is scoped ONLY to webnav-using/testing subagents.** For all other work — implementation, planning, code review, general tasks — use the best model for that task (do NOT downgrade to Haiku).

## CLI ergonomics (settled — agent-native, per clig.dev + CLI-Anything)

- **Uniform JSON stdout.** Every verb writes a single JSON object to **stdout** (parseable by the calling agent with no special-casing). Page YAML that the agent must read (e.g. `snapshot`) is carried as a field (`{status,snapshot}`), never bare. Diagnostics/human prose go to **stderr**. Exit codes: 0 ok · 2 error · 3 ran-fine-but-empty/failed. Do NOT add a verb that prints non-JSON to stdout.
- **Self-describing.** `--help` (grouped) + per-verb help that teaches data-flow (where an arg comes from / where output goes). Keep new verbs discoverable this way.
- **Installed on PATH.** `webnav` is a real CLI (a peer of `playwright-cli`) via `bin/webnav` → `tsx src/cli.ts` + `npm link` — runs current source, NO build step needed.

## CLI categories (settled)

webnav's verbs split into **two top-level categories**:
- **`use`** — what an agent does at runtime: the playwright browser-driving primitives (`navigate`, `click`, `type`, `snapshot`, `read`, `eval`, `network`, `wait-for`, `go-back`/`reload`), the multi-step `walk`/`walk-resume`, and open-web `search`. "Use webnav" = drive the browser + walk a built map. (The internet-graph query verbs `recall`/`route`/`hop`/`locate`/`list-goals` were REMOVED from the CLI 2026-06-13 — they were inert on the default saucedemo seed and contradicted the advertised surface; the engine modules + tests stay as parked fixtures, restorable from git history if that surface returns.)
- **`dev`** — authoring the map: the agent-driven site-mapping flow (`record-start`, `record-stop`, `graph-analyse`, `graph-edit`, `graph-show`, `effects`) plus inspect/teach verbs (`list`, `describe`, `node-add`, `edge-add`, `capture`, `export-map`, `outline`, `mermaid`, `dashboard`, `mcp`). Verbs are named **entity-first** (`record-start`, `node-add`), not action-first.

## `walk` vs `use` — DO NOT conflate (settled)

These look similar (both move through a site) but are **opposite in intent** — never collapse one into the other:
- **`use` = the hands (manual driving).** Low-level, one action per call (`navigate`/`snapshot`/`click`/`type`). The agent reasons at **every step** — snapshot, read it, pick a ref, act, repeat. High agent-token cost per action. This is the tool for **exploring/building** the map (what the site-mapping flow uses).
- **`walk` = the memory / autopilot (cheap recall).** The agent says "take me to goal G" and webnav **replays a known page-to-page route deterministically** (re-finding elements by semantic intent, self-healing), so the agent spends ~zero tokens on the journey and only intervenes at genuine **forks** (a needed in-page affordance, drift, a commit point) via the pause/resume protocol. This is the tool for **travelling** a built map — and it IS the core recall-don't-re-explore speed/cost win.
- **In-page affordances during a walk:** the walk drives **page-to-page**; an in-page action that's required before the next navigation (e.g. add-to-cart before the cart is useful) is **fired by the agent at a pause**, not threaded through the pathfinder (affordance model: in-page actions are a node's repertoire, not path edges).

**Rule:** when "finishing the walk" or similar comes up, do NOT reduce `walk` to "just the `use` loop." That throws away walk's entire reason to exist (deterministic, low-token replay). `use` = explore/build (agent drives every step); `walk` = recall/travel (webnav drives, agent only acts at forks).

## Affordance-primary state model (settled 2026-06-09 — `2026-06-09-affordance-model-design.md`)

A state's **`affordances: Affordance[]` is the SOURCE OF TRUTH**, not a separate edges table. Each affordance has a `kind`:
- **`navigate`** — leads to a different state (`toState`); the only kind that becomes a path edge. May carry `addressableUrl` (tier-1 coordinate: the walk JUMPS there via `goto` instead of resolving a ref — for icon-only/unstable links like saucedemo's cart).
- **`reveal`** — opens an in-page overlay (hamburger menu/modal); its `children: Affordance[]` are the exposed affordances (nested INSIDE the node, NOT a separate node — an overlay has no coordinate). A reveal with children emits no edge itself; its children do.
- **`mutate`** — same-page change (sort, add-to-cart). **Never routes.** add-to-cart is a `mutate`, NOT a gate on the cart edge (the empty cart is a valid state; whether to add first is the agent's judgment).
- **`input`** — fills a field. Never routes; named in a navigate's `needs` (preconditions). When the navigate also has `acceptsInput`, the live browser auto-fills those inputs, so they do NOT pause the walk.
- Cross-cutting: **`commit`** (irreversible → never auto-fired, #2) and explored-ness (`toState === null` ⇒ unexplored "dangling" stub).

**Edges are PROJECTED, not stored:** `store.edgesFrom`/`allEdges` derive `Edge[]` from navigate/reveal affordances (so the router/walk interface is unchanged); `store.interiorEdges` adds `viaAffordance` (the affordance id, so the VIEWER anchors each arrow to its specific affordance row) + dangling stubs. A stored `edges` row still wins on duplicate (carries the self-heal selector cache); legacy/explorer edges with no backing affordance still surface. The viewer renders the typed repertoire as a categorized list with per-affordance handles + collapsible reveals; floating edges (border-intersection + direction-invariant reciprocal bowing) are ported from `Mnet/process-map`.

## What this project is

**A navigation memory for AI agents.** A web-navigation **memory** that lets agents recall cheap, reliable routes to goals on a website instead of re-exploring from scratch every time. The core win is **speed and cost**: the second time an agent needs to get somewhere, it recalls the route rather than re-discovering it.

It is **a map, not a driver.** It gets the agent to where the signals live, cheaply and reliably. It does **not** decide what to do or judge what it finds — that stays with the LLM.

## Default map + product surface (settled 2026-06-12)

- **The default seed is saucedemo ONLY** — one complete worked example (login →
  checkout-complete) proving `walk`/record/self-heal work. Nothing else ships seeded.
- **What this repo advertises = that example + the record-your-own-site flow** (automation
  testing, internal tools, repeated agent workflows). Users build maps for THEIR sites;
  webnav is an open-source blank-slate map tool.
- **The GitHub `recall` skeleton + the internet-graph seed are programmatic/test fixtures**
  (`seedGitHubAndGraph`) — deliberately NOT seeded by default, NOT advertised, NOT a product
  surface. (They remain the v1 proof-of-engine and keep their tests.) Consequence: the
  graph-layer roadmap items (G4 co-use weights, auto-learn nodes, richer GitHub signals)
  are PARKED unless that surface returns.
- **The website/hosted shared-map route lives in the separate `webnav-site` repo and is
  NOT advertised here.** This repo keeps only the thin, tested client (`login`,
  `walk --hosted`, `src/hosted.ts`, `dev export-map`), documented via `--help` only.
- **MCP is a first-class interface:** `webnav mcp` serves every verb as MCP tools over
  stdio. It is a THIN layer — tools are GENERATED from the cli-spec registry and every
  call executes the real CLI — so CLI and MCP cannot drift. The CLI stays primary.

## The mental model (settled)

A **place index + weighted routing graph** — webnav answers BOTH "where is X" (place-lookup) and "route me there" (directions):
- **Nodes = states** of a site (what's true / what's possible from here). A URL is an *attribute* of a state, not the node itself (same URL can be many states; many URLs can be one state).
- **Edges = actions** (click/type/navigate) that transition between states. Every edge carries a static **cost** (tokens/time). (Usage-learned weighting — reliability/confidence/co-use — is a **webnav-site** feature, settled 2026-06-12: it only makes sense where usage aggregates across users; the open-source map stores declared/static data + the self-heal selector cache only.)
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

1. **Observe first, traverse rarely.** Build the map primarily by *reading what the page declares* (snapshot, hrefs, form targets, ARIA, labels). Execute only **safe, reversible** actions to reveal hidden state. Prefer observed/declared data over driving every road — the web *announces its own roads*; exploit that.

2. **Never traverse a declared commit point.** Destructive/irreversible actions (Place Order, Pay, Send, Delete) are mapped **by inference from the page's declaration**, never fired. (v1 on GitHub is read-only, so this is trivially satisfied — but the rule is permanent.)

3. **Store what doesn't change; cache what does.** A route has two layers:
   - **Durable semantic route** — the *intent* of each step ("find the primary search box, enter the query, open the top repo's insights"). Survives redesigns.
   - **Disposable selector cache** — the concrete selectors/refs that worked last time. Expected to break.
   On recall: try the cheap cached selectors first; on miss, re-resolve that step from semantic intent against the live page, and **write the repair back.** The map **self-heals from usage**, one step at a time.

4. **Usage-learned weights live in the HOSTED service, not here (settled 2026-06-12).** Reliability/confidence/co-use weights only mean something where usage aggregates across many users — that's webnav-site's job (it learns from walk outcomes reported via the API and serves weighted maps). The open-source map is judgment-free static data: declared structure + static cost + the self-heal selector cache. (This replaces the earlier "confidence decays with age" principle, whose local machinery was removed 2026-06-12 — design for the hosted side: webnav-site repo, `docs/superpowers/specs/2026-06-12-usage-weights-design.md`.)

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
- **MapStore** — *"Persist the graph; answer structural queries."* Owns the data model (states, edges, goals, semantic route + selector cache). SQLite. Depends on: nothing (pure persistence).
- **Router** — *"Given a goal, return cheapest reliable route, replay, self-heal deterministically, return evidence OR a 'your move' response."* Asks MapStore for a route (or Explorer to build one), replays via playwright-cli (cached selectors first; deterministic role+name re-match on miss; real drift → `needs-navigation` to the agent; repairs written back). Surfaces raw declared signals. Does NOT score, does NOT call an LLM. Depends on: MapStore, playwright-cli.

Browser automation layer: **`playwright-cli`** (github.com/microsoft/playwright-cli) — built for agents, token-efficient, returns stable element refs from `snapshot`.

**Tech stack (settled in planning):**
- Language: **TypeScript** (strict), Node. Test runner: **vitest**.
- Browser: **`playwright-cli`** invoked as a child process via a thin adapter.
- MapStore backing: **SQLite** (via `better-sqlite3` — synchronous, fits one-serialized-session model).
- **No LLM dependency in webnav.** The calling agent supplies all reasoning via the response protocol (#5a). webnav has no API keys, no provider config.

## v1 scope (settled — historical; superseded as a PRODUCT surface by the 2026-06-12 decision above, kept as the proof-of-engine + test fixture)

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

> **Single source of truth for current state + how to run + next steps: `docs/STATUS.md`.** Quickstart + module map: `README.md`. This section is the narrative; STATUS.md is the live checklist — keep STATUS.md updated as the canonical handoff.

**Snapshot (2026-06-12):** All work is **merged to `main`** in the public repo (`github.com/lucyfuur94/webnav-core`, CI: typecheck + units on Node 18/20), **398 unit tests pass (+9 gated live e2e)**, build green. webnav is a working zero-LLM CLI **and MCP server** (`webnav mcp`). Consumer verbs: `walk`/`walk-resume`/`creds`, `read`/`search`, `eval`/`network`/`go-back`/`reload`, and the `use` browser primitives (`navigate`/`snapshot`/`click`/`type`); dev verbs: the record→analyse→edit mapping flow (`record-start`/`record-stop`/`graph-analyse`/`graph-edit`/`graph-show`/`effects`), `node-add`/`edge-add`/`list`/`describe`/`capture`, `export-map`/`outline`/`mermaid`/`dashboard`/`sessions`/`mcp`. (The internet-graph verbs `recall`/`route`/`hop`/`locate`/`list-goals` were removed from the CLI 2026-06-13 — engine kept as parked fixtures.) Default seed = saucedemo only; the website/hosted backend was split into the separate `webnav-site` repo (2026-06-10).

Built + verified (each merged from its own worktree; details + dates in `docs/STATUS.md`):
- **v1 (Tasks 0–13):** zero-LLM engine — snapshot parser, playwright-cli adapter, SQLite MapStore, deterministic resolve/replay, explorer, recall→evidence-bundle, goals, CLI. Spec `docs/superpowers/specs/2026-05-30-webnav-design.md`, plan `docs/.../plans/2026-05-30-webnav.md`.
- **Memory loop (M1–M3):** live path goes Router→MapStore→Explorer; skeleton built once, persisted, never re-explored (criterion #3, proven by a reopen-from-disk test).
- **Cost thesis (corrected + verified live):** the saving is the calling AGENT's tokens/time, not playwright page-loads; evidence bundle reports `tokens_saved`. GitHub `python retry http` → 5 real repos w/ rich signals, ~65k tokens saved.
- **Multi-step walk (W1–W2, verified live):** `walkRoute` (async) walks a multi-page route to a NON-addressable state edge-by-edge; per-step prediction(`edge.toState`)-vs-observation(`matchState`); escalates `needs-navigation` on drift / `needs-classification` at a commit point (never fired). saucedemo: logs in, reaches inventory, correctly escalates at the ambiguous add-to-cart (resolveStep stays strict — never guesses among equivalents).
- **Research (R2/R3/R4, R4 verified live):** R2 `classifyReadiness` (ready|loading|interstitial — detect+escalate, NEVER evade); R3 `extractContent` (answer-evidence from any page); R4 multi-provider open-web search (Marginalia + Wiby — Google/Bing/DDG bot-wall browsers), fan-out + merge, found-via-dogfooding chrome-leak + render-race fixes.
- **Phase 1 — CLI hardening (DONE):** clig.dev self-describing CLI (the agent's tool-discovery: `webnav --help` + per-verb help), `--json`, `--version`, exit codes (0 ok / 2 error+hint / 3 ran-but-empty), stdout=result / stderr=diagnostics.
- **Phase 2 G1–G3 — internet graph (DONE):** nodes + node_edges in MapStore; `route "<request>"` (surfaces candidate nodes + signals, agent decides — #5a) and `hop` (move to a related node via an edge). Spec `docs/.../specs/2026-05-31-internet-graph-design.md`.
- **Affordance model + agent-driven mapping + interactive recording (2026-06-04…09):** `State.affordances` as source of truth (edges projected); the record→analyse→edit flow; `use` browser primitives that record action-effects.
- **R5 resume loop (DONE 2026-06-10):** `classify: safe` fires a commit and the walk continues; full saucedemo login→checkout-complete verified live. Full saucedemo map persisted (7 states, 0 dead-ends).
- **R1 + R1.1 benchmarks (DONE):** R1 honest negative on tokens; **R1.1 (re-grounded CLI): webnav tied for best quality 9/10, swept bot-walled tasks, never thrashed** (`bench/results/`). Navigation benchmark (multi-page, the real thesis test) designed, re-pointed at saucedemo, NOT yet run.
- **Phase 5 — MCP wrapper (DONE 2026-06-12):** `webnav mcp` serves every verb as MCP tools over stdio; generated from cli-spec; every call runs the real CLI.
- **Site split (2026-06-10):** website + hosted backend → separate `webnav-site` repo; the local web viewer left with it (inspect via `dev outline`/`mermaid`/`dashboard`).

**Honest remaining gaps / pending (full list in `docs/STATUS.md`):**
1. **The navigation thesis is still unproven by benchmark** — run the saucedemo walk-vs-raw-browser multi-page benchmark (needs playwright-cli + open network; not runnable from a sandboxed cloud session).
2. Mapping a NEW site is an expert-ish multi-step flow; a one-command `map <url>` + shareable map packs are roadmap.
3. Open-web search quality is capped by the automation-friendly engines' thin indexes (good engines bot-wall browsers; we don't evade).
4. PARKED (per the 2026-06-12 product-surface decision): G4 co-use weights, auto-learn-nodes, richer GitHub goal signals.

## Research push (increment R) — R2/R3/R4 DONE + merged to main

webnav's value = **agent + webnav vs. agent + plain web search** on INFO-SEEKING tasks (the user's original pain). Recon confirmed: plain WebFetch/search gets JS-nav-shells (wrong); the REAL browser renders JS content WebFetch can't see (webnav's edge); some sites bot-wall even a real browser. **Every failure mode = a feature to build, not an excuse.**
- ✅ **R2** — page-readiness / interstitial detection (`classifyReadiness`: ready|loading|interstitial; detect+escalate, NEVER evade).
- ✅ **R3** — info-seeking content extraction (`extractContent`: clean answer-evidence from any page snapshot).
- ✅ **R4** — web-search skeleton (`search-live.ts`: search Marginalia → parse results → visit top-N with readiness retry → extract). CLI `webnav search`. Verified live. (Marginalia chosen because DuckDuckGo/Bing/Google bot-wall browsers.)
- ✅ **R5** — needs-* RESUME loop (agent answers escalation → walk continues). DONE 2026-06-10.
- ✅ **R1/R1.1** — A/B benchmarks run twice (see `bench/results/`); the multi-page navigation benchmark remains (re-pointed at saucedemo).

## THE PLAN (settled with user — "do all, plan and execute") — dependency-ordered

The internet-graph spec (`docs/superpowers/specs/2026-05-31-internet-graph-design.md`) is the north-star: **the web as one clustered graph of site-nodes; capabilities are neighborhoods (clusters); intra-site skeletons are node interiors.** Agent interface = `route` (graph: which node(s) for a request + signals) → agent decides → `run` (intra-site skeleton acts) → optional `hop` (graph: move to related node) → agent synthesizes. webnav gives SIGNALS; the agent JUDGES (#5a). Provider selection is mechanical (capability match + reachability + learned co-use weight that emerges from usage & decays — the Maps-traffic analog; the LEARNING half is a webnav-site feature, 2026-06-12), never a quality judgment.

Build order (each its own increment, on its own worktree, merged when green):
- **Phase 0** ✅ consolidate (R2/R3/R4 merged to main).
- **Phase 1 — CLI hardening** ✅ DONE. Self-describing CLI (`--help`/per-verb help/`--json`/`--version`/exit-codes/stdout=result). Answers "how does the agent know how to call the tools".
- **Phase 2 — Internet graph:** G1–G3 ✅ DONE (nodes/node_edges + `route` + `hop`). **G4 — co-use weight learning: PARKED** (2026-06-12 product-surface decision — the internet graph is no longer an advertised surface; revisit if it returns).
- **Phase 3 — R5 resume loop** ✅ DONE (2026-06-10): agent answers a `needs-*`, walk continues to completion; saucedemo finishes end-to-end live.
- **Phase 4 — R1 benchmark** ✅ run twice (R1 + R1.1; see `bench/results/`). **Remaining: the multi-page NAVIGATION benchmark on saucedemo** (walk vs raw-browser) — the actual thesis test; needs a machine with playwright-cli + open network.
- **Phase 5 — MCP wrapper** ✅ DONE (2026-06-12): `webnav mcp` — every verb as an MCP tool over stdio, generated from cli-spec, every call runs the real CLI. CLI stays primary.
- **Immediate first step next session:** ⚠️ **run the saucedemo navigation benchmark** (`2026-06-03-navigation-benchmark-design.md` + the re-point note in STATUS.md) from a dev machine with a browser.

## Sanctioned-doors layer + attention-return economics (agreed direction; not yet built)

The agent-web is moving to **front doors for agents** (official search/agent APIs, MCP endpoints, `llms.txt`, verified-agent auth) — NOT evasion. webnav's settled posture: **detect a wall/toll and escalate / route to the cheapest SANCTIONED door; never evade** (no proxies, fingerprint-spoofing, CAPTCHA-bypass — hard line). Next architectural increment after the current phases: a **doors layer** on the graph — each node carries access terms `open | api-key | cash | attention-loop`; webnav routes to the best *available, sanctioned* door and honestly reports when a door has a toll/key requirement. Search APIs (Google/Bing/Brave) become first-class providers when a key is configured (the legitimate "solve for Google/Bing").

**Economic north-star (thesis, captured in `docs/superpowers/specs/2026-05-31-attention-return-economics.md`):** agents can be made *attention-alive* — read a site's offers and (transparently, with consent, at genuine intent) return **qualified attention** to the user, restoring the content-for-attention barter so sites needn't toll. The agent surfacing a labeled offer is just **advertising** (legitimate) — the **only real constraint is honest communication: label sponsored offers, never disguise paid placement as neutral advice.** No anti-"adware" machinery (an earlier over-engineered framing — corrected). Payment per site can be **impression- or conversion-based** (conversion self-verifies via referral token; impression is gentler on incentives but needs attestation). Principal is **agnostic** — user's own agent OR a company serving its users — aligned when the payer has a genuine stake in the beneficiary; the LLM has no incentive of its own (any risk is the *operator's* instructions). webnav stays the judgment-free substrate — its only new jobs: record offers as evidence, carry per-node attention-terms, emit attribution tokens on consented actions; it NEVER decides to surface an offer (#5a). Build doors first; keep the `attention-terms` field in the schema from the start.
