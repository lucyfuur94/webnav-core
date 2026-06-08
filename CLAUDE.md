# CLAUDE.md — zy-core / `webnav`

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
- **`use`** — what an agent does at runtime: the playwright browser-driving primitives (`navigate`, `click`, `type`, `snapshot`, `read`, `eval`, `network`, `wait-for`, `go-back`/`reload`) AND the map-query verbs (`recall`, `search`, `locate`, `route`, `hop`, `list-goals`). "Use webnav" = drive the browser + query the map.
- **`dev`** — authoring the map: the agent-driven site-mapping flow (`record-start`, `record-stop`, `graph-analyse`, `graph-edit`, `graph-show`) plus inspect/teach verbs (`list`, `describe`, `graph`, `node-add`, `edge-add`, `capture`). Verbs are named **entity-first** (`record-start`, `node-add`), not action-first.

## `walk` vs `use` — DO NOT conflate (settled)

These look similar (both move through a site) but are **opposite in intent** — never collapse one into the other:
- **`use` = the hands (manual driving).** Low-level, one action per call (`navigate`/`snapshot`/`click`/`type`). The agent reasons at **every step** — snapshot, read it, pick a ref, act, repeat. High agent-token cost per action. This is the tool for **exploring/building** the map (what the site-mapping flow uses).
- **`walk` = the memory / autopilot (cheap recall).** The agent says "take me to goal G" and webnav **replays a known page-to-page route deterministically** (re-finding elements by semantic intent, self-healing), so the agent spends ~zero tokens on the journey and only intervenes at genuine **forks** (a needed in-page affordance, drift, a commit point) via the pause/resume protocol. This is the tool for **travelling** a built map — and it IS the core "Google Maps for agents" speed/cost win.
- **In-page affordances during a walk:** the walk drives **page-to-page**; an in-page action that's required before the next navigation (e.g. add-to-cart before the cart is useful) is **fired by the agent at a pause**, not threaded through the pathfinder (affordance model: in-page actions are a node's repertoire, not path edges).

**Rule:** when "finishing the walk" or similar comes up, do NOT reduce `walk` to "just the `use` loop." That throws away walk's entire reason to exist (deterministic, low-token replay). `use` = explore/build (agent drives every step); `walk` = recall/travel (webnav drives, agent only acts at forks).

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

> **Single source of truth for current state + how to run + next steps: `docs/STATUS.md`.** Quickstart + module map: `README.md`. This section is the narrative; STATUS.md is the live checklist — keep STATUS.md updated as the canonical handoff.

**Snapshot (2026-06-01):** All work below is **merged to `main`**, **192 unit tests pass (+2 gated live e2e)**, build green. webnav is a working zero-LLM CLI tool with these verbs: `list`, `describe`, `locate`, `recall` (GitHub repo evidence), `search` (multi-provider open-web), `route` + `hop` (the internet graph), `graph`/`add-node`/`add-edge` (the visualizable, teachable map), `capture` (dev). Self-describing CLI (`--help`/`--version`/`--json`/exit-codes).

Built + verified (each merged from its own worktree):
- **v1 (Tasks 0–13):** zero-LLM engine — snapshot parser, playwright-cli adapter, SQLite MapStore, deterministic resolve/replay, explorer, recall→evidence-bundle, goals, CLI. Spec `docs/superpowers/specs/2026-05-30-webnav-design.md`, plan `docs/.../plans/2026-05-30-webnav.md`.
- **Memory loop (M1–M3):** live path goes Router→MapStore→Explorer; skeleton built once, persisted, never re-explored (criterion #3, proven by a reopen-from-disk test).
- **Cost thesis (corrected + verified live):** the saving is the calling AGENT's tokens/time, not playwright page-loads; evidence bundle reports `tokens_saved`. GitHub `python retry http` → 5 real repos w/ rich signals, ~65k tokens saved.
- **Multi-step walk (W1–W2, verified live):** `walkRoute` (async) walks a multi-page route to a NON-addressable state edge-by-edge; per-step prediction(`edge.toState`)-vs-observation(`matchState`); escalates `needs-navigation` on drift / `needs-classification` at a commit point (never fired). saucedemo: logs in, reaches inventory, correctly escalates at the ambiguous add-to-cart (resolveStep stays strict — never guesses among equivalents).
- **Research (R2/R3/R4, R4 verified live):** R2 `classifyReadiness` (ready|loading|interstitial — detect+escalate, NEVER evade); R3 `extractContent` (answer-evidence from any page); R4 multi-provider open-web search (Marginalia + Wiby — Google/Bing/DDG bot-wall browsers), fan-out + merge, found-via-dogfooding chrome-leak + render-race fixes.
- **Phase 1 — CLI hardening (DONE):** clig.dev self-describing CLI (the agent's tool-discovery: `webnav --help` + per-verb help), `--json`, `--version`, exit codes (0 ok / 2 error+hint / 3 ran-but-empty), stdout=result / stderr=diagnostics.
- **Phase 2 G1–G3 — internet graph (DONE):** nodes + node_edges in MapStore; `route "<request>"` (surfaces candidate nodes + signals, agent decides — #5a) and `hop` (move to a related node via an edge). Spec `docs/.../specs/2026-05-31-internet-graph-design.md`.
- **Graph-viz (DONE):** `graph` (JSON/`--html`), `add-node`/`add-edge` (teach new sites; persisted), interactive Cytoscape.js HTML viewer (`webnav graph --html > map.html`) — clustered, drag/hover/click, teach-via-UI forms.

**Honest remaining gaps / pending (full list in `docs/STATUS.md`):**
1. **Graph HTML viewer render NOT yet visually confirmed** — it generates + is unit-tested, but the Chrome browser-bridge tool timed out so the in-browser render is unverified. *Verify first next session* (e.g. via playwright-cli headless, since the Chrome MCP bridge was down).
2. The saucedemo walk escalates at add-to-cart rather than completing autonomously (correct behavior, but needs the **R5 resume loop** to finish a multi-step flow end-to-end — designed, not built).
3. GitHub run-2 doesn't navigate fewer pages (irreducible re-reads); the real saving is agent tokens.
4. Open-web search quality is capped by the automation-friendly engines' thin indexes (good engines bot-wall browsers; we don't evade).
5. Pending features: **G4** co-use weight learning, **R5** resume loop, **R1** A/B benchmark, **Phase 5** MCP wrapper, auto-learn-nodes-from-usage, richer goal signals (`closed_issues`/`latest_release`/`has_ci`).

## Research push (increment R) — R2/R3/R4 DONE + merged to main

webnav's value = **agent + webnav vs. agent + plain web search** on INFO-SEEKING tasks (the user's original pain). Recon confirmed: plain WebFetch/search gets JS-nav-shells (wrong); the REAL browser renders JS content WebFetch can't see (webnav's edge); some sites bot-wall even a real browser. **Every failure mode = a feature to build, not an excuse.**
- ✅ **R2** — page-readiness / interstitial detection (`classifyReadiness`: ready|loading|interstitial; detect+escalate, NEVER evade).
- ✅ **R3** — info-seeking content extraction (`extractContent`: clean answer-evidence from any page snapshot).
- ✅ **R4** — web-search skeleton (`search-live.ts`: search Marginalia → parse results → visit top-N with readiness retry → extract). CLI `webnav search`. Verified live. (Marginalia chosen because DuckDuckGo/Bing/Google bot-wall browsers.)
- ⏳ **R5** — needs-* RESUME loop (agent answers escalation → walk continues). Deferred to Phase 3 below.
- ⏳ **R1** — A/B benchmark (subagent + real webnav CLI vs subagent + plain search; gold answers + agent tokens). Deferred to Phase 4 below.

## THE PLAN (settled with user — "do all, plan and execute") — dependency-ordered

The internet-graph spec (`docs/superpowers/specs/2026-05-31-internet-graph-design.md`) is the north-star: **the web as one clustered graph of site-nodes; capabilities are neighborhoods (clusters); intra-site skeletons are node interiors.** Agent interface = `route` (graph: which node(s) for a request + signals) → agent decides → `run` (intra-site skeleton acts) → optional `hop` (graph: move to related node) → agent synthesizes. webnav gives SIGNALS; the agent JUDGES (#5a). Provider selection is mechanical (capability match + reachability + learned co-use weight that emerges from usage & decays — the Maps-traffic analog), never a quality judgment.

Build order (each its own increment, on its own worktree, merged when green):
- **Phase 0** ✅ consolidate (R2/R3/R4 merged to main).
- **Phase 1 — CLI hardening** ✅ DONE. Self-describing CLI (`--help`/per-verb help/`--json`/`--version`/exit-codes/stdout=result). Answers "how does the agent know how to call the tools".
- **Phase 2 — Internet graph:** G1–G3 ✅ DONE (nodes/node_edges + `route` + `hop`). **G4 ⏳ PENDING** — co-use weight learning (the Maps-traffic analog: weight emerges from usage, decays). + ✅ graph-viz (export/teach/HTML viewer) landed alongside.
- **Phase 3 — R5 resume loop ⏳ PENDING:** agent answers a `needs-*`, walk continues to completion (lets the saucedemo flow finish autonomously end-to-end).
- **Phase 4 — R1 benchmark ⏳ PENDING:** A/B harness (subagent + real CLI, graph-routed) vs. plain search; real tasks + agent tokens. Proves the thesis. *Recommended next-after-verify.*
- **Phase 5 — MCP wrapper ⏳ PENDING (SECONDARY):** expose the stable verbs as MCP tools so agents see them natively. Thin layer over the CLI verbs; CLI stays primary. Test both via CLI and MCP.
- **Immediate first step next session:** ⚠️ **verify the graph HTML viewer actually renders** (browser bridge was down — use playwright-cli headless). Then pick a pending phase (R1 benchmark recommended).

## Sanctioned-doors layer + attention-return economics (agreed direction; not yet built)

The agent-web is moving to **front doors for agents** (official search/agent APIs, MCP endpoints, `llms.txt`, verified-agent auth) — NOT evasion. webnav's settled posture: **detect a wall/toll and escalate / route to the cheapest SANCTIONED door; never evade** (no proxies, fingerprint-spoofing, CAPTCHA-bypass — hard line). Next architectural increment after the current phases: a **doors layer** on the graph — each node carries access terms `open | api-key | cash | attention-loop`; webnav routes to the best *available, sanctioned* door and honestly reports when a door has a toll/key requirement. Search APIs (Google/Bing/Brave) become first-class providers when a key is configured (the legitimate "solve for Google/Bing").

**Economic north-star (thesis, captured in `docs/superpowers/specs/2026-05-31-attention-return-economics.md`):** agents can be made *attention-alive* — read a site's offers and (transparently, with consent, at genuine intent) return **qualified attention** to the user, restoring the content-for-attention barter so sites needn't toll. The agent surfacing a labeled offer is just **advertising** (legitimate) — the **only real constraint is honest communication: label sponsored offers, never disguise paid placement as neutral advice.** No anti-"adware" machinery (an earlier over-engineered framing — corrected). Payment per site can be **impression- or conversion-based** (conversion self-verifies via referral token; impression is gentler on incentives but needs attestation). Principal is **agnostic** — user's own agent OR a company serving its users — aligned when the payer has a genuine stake in the beneficiary; the LLM has no incentive of its own (any risk is the *operator's* instructions). webnav stays the judgment-free substrate — its only new jobs: record offers as evidence, carry per-node attention-terms, emit attribution tokens on consented actions; it NEVER decides to surface an offer (#5a). Build doors first; keep the `attention-terms` field in the schema from the start.
