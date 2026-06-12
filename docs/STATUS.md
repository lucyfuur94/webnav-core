# webnav — STATUS (live handoff)

**Updated:** 2026-06-12 · **Branch:** `main` · **Tests:** 398 unit pass + 9 gated live e2e (`WEBNAV_LIVE=1`) · **Build:** green · **CI:** GitHub Actions (typecheck + units, Node 18/20)

> **2026-06-12 — MCP wrapper (Phase 5 DONE) + saucedemo-only repositioning + docs sync.**
> - **`webnav mcp` (Phase 5 DONE):** every verb is now served as an MCP tool over stdio
>   (`{"command":"webnav","args":["mcp"]}` in any MCP client). A THIN layer: tools are
>   GENERATED from the cli-spec registry and every call executes the real CLI, so the two
>   surfaces cannot drift. Excludes long-running modes (`dashboard`, `mcp` itself).
>   Unit-tested (tool schemas, argv round-trip through the real parser, JSON-RPC handling,
>   exit-code mapping 2=error/3=empty-ok) + smoke-verified live over stdio.
> - **Repositioning (settled with user):** this repo advertises ONLY the saucedemo-seeded
>   default + the record-your-own-site flow (automation testing, internal tools, repeated
>   agent workflows). The GitHub `recall` skeleton + internet-graph seed are programmatic/
>   test fixtures (`seedGitHubAndGraph`), deliberately NOT seeded and NOT advertised. The
>   website/hosted shared-map route moved to the separate `webnav-site` repo and is no
>   longer advertised here (the thin client — `login`, `walk --hosted`, `hosted.ts` —
>   remains in-tree, documented only via `--help`).
> - **`dev effects --session S`:** dumps a record session's RAW action-effects (full
>   before/after snapshots) — closes the "raw stays for the agent isn't CLI-reachable"
>   follow-up from 2026-06-08.
> - **Spec/code fix:** BROWSER_FLAGS help said headless-default; the code (and tests) are
>   headed-by-default with `--headless` opt-out. Spec now matches the code, and documents
>   `--headless`.
> - **Docs sync:** README (verb table led by walk/record flows, source map refreshed,
>   website/hosted sections removed), this file (post-site-split reality), CLAUDE.md
>   (status snapshot + plan checkmarks).
> - **Benchmark re-pointed at saucedemo:** the multi-page navigation benchmark
>   (`2026-06-03-navigation-benchmark-design.md`) targeted GitHub, which contradicts the
>   saucedemo-only positioning; it should run as `walk` vs raw-browser on saucedemo flows.
>   NOT runnable in a sandboxed/cloud session (needs playwright-cli + open network) — run
>   it from a normal dev machine.

> **2026-06-10 — Full saucedemo map + R5 resume loop (DONE).**
> - **Complete site mapped:** exhaustively explored saucedemo via webnav (Haiku subagent) and persisted the FULL graph to `webnav.db` — 7 states incl. the previously-missing `product-detail` and `checkout-complete`, About→external `saucelabs.com`, cart Remove, both checkout Cancels. `dev outline` confirms 0 dead-ends / 0 orphans / 1 external exit.
> - **Navigation test cases:** `tests/router/saucedemo-routes.test.ts` — 8 `findPath` cases over the full cyclic map (log-in, full checkout, product-detail, product→cart, logout/cancel back-edges, post-order return, reachability). Proves the stored graph SUPPORTS navigation.
> - **R5 resume loop DONE:** fixed the bug where `classify: safe` on a commit edge re-escalated forever; now a safe verdict FIRES the commit (the only path that does, on explicit agent classification — #2 intact). New `runWalkLiveComplete` walks login→…→checkout-overview, classifies Finish safe, and reaches checkout-complete. Verified LIVE end-to-end; the other two live walks still halt-at-commit / no-escalation. 3 new unit cases + a gated live e2e.
> - **Graph viewer:** deprioritised (per review — the agent never reads it; `dev outline`/`mermaid`/`graph-show` are the right verification tools). The React-Flow viewer works (ELK-routed, dark mode persisted, single orthogonal edge style) but is treated as good-enough, not the focus.



> **2026-06-09 — Affordance-primary model + working saucedemo walk + readable graph (DONE; on `feat/affordance-model`).**
> `State.affordances` is now `Affordance[]` (typed: `navigate`/`reveal`/`mutate`/`input`, + `commit`, `toState`, `addressableUrl`, `children`, `needs`, `acceptsInput`). Affordances are the SOURCE OF TRUTH; `store.edgesFrom`/`allEdges` PROJECT navigate/reveal affordances into the existing `Edge` shape so the router/walk are unchanged; `store.interiorEdges` adds `viaAffordance` + dangling stubs for the viewer.
> - **Walk works perfectly, verified live:** the saucedemo walk now COMPLETES login→inventory→cart→checkout-info→checkout-overview and halts before the Finish commit (no escalation). add-to-cart is a same-page `mutate` (not a gate); the cart is reached via a tier-1 `addressableUrl` jump (the cart icon has no stable name). `walk.ts` gained an addressable-jump branch (`browser.goto`). Both gated live e2es rewritten to assert this and pass.
> - **Graph is human-readable, visually verified** (playwright-cli headless): nodes render the typed repertoire as a categorized vertical list (NAVIGATE/REVEAL/MUTATE/INPUT), edges leave the SPECIFIC affordance row's handle, the burger menu is a collapsible `reveal` whose children nest inside the node, the Finish commit shows a "commit · never auto-fired" badge, mutate/input rows are muted with no handle, and one "? unexplored" stub shows the About exit. Floating edges (border-intersection + direction-invariant reciprocal bowing + outside self-loops) ported from `Mnet/process-map`; `BowEdge`/`RoutedEdge` removed.
> - Spec `docs/superpowers/specs/2026-06-09-affordance-model-design.md`, plan `docs/superpowers/plans/2026-06-09-affordance-model.md`.

**Updated:** 2026-06-08 · **Branch:** `main` · **Tests:** 322 unit pass + 9 gated live e2e (skipped without `WEBNAV_LIVE=1`) · **Build:** green (incl. web/)

> This is the canonical "where are we / what's next / how to run" doc. Keep it
> current. CLAUDE.md = settled design & principles; this = the live checklist.
> Design docs live in `docs/superpowers/specs/`, the v1 plan in `docs/superpowers/plans/`.

---

## What webnav is (one line)

A zero-LLM web-navigation **memory + map** (a navigation memory for AI agents):
an agent shells out to the `webnav` CLI to navigate sites reliably, recall routes,
search the web, and get back compact **evidence** — the agent does all judgment.
See CLAUDE.md for the full mental model and the 6+ settled principles (esp. #5a:
webnav contains NO LLM; never evades bot-walls).

## How to run

```
npm install          # better-sqlite3 native build; Node 18+
npm link             # install `webnav` on PATH (a peer of playwright-cli; runs src via tsx — NO build)
webnav --help        # the tool menu (every verb + when-to-use)
npm test             # vitest unit + gated e2e (skipped without WEBNAV_LIVE=1)
npm run build        # tsc -> dist/ (only for the dist build; the webnav CLI runs src directly)
WEBNAV_LIVE=1 npx vitest run tests/e2e   # the gated live tests (need a browser + network)
```
**`webnav` is an installed CLI** (`bin/webnav` launcher → `tsx src/cli.ts`; `npm link` puts it on PATH). It runs current source, so code changes need NO rebuild. Invoke as `webnav <verb>` everywhere (like `playwright-cli`).
Requires `playwright-cli` on PATH (installed at `/usr/local/bin/playwright-cli`).
A file-backed `webnav.db` (SQLite, gitignored) persists the map across runs.

## The verbs (generic primitives over the map; self-describing CLI)

**Consumer verbs** (the `webnav --help` menu):

| Verb | What it does |
|---|---|
| `webnav walk --start X --goal Y [--input k=v] [--hosted]` | autopilot a multi-step route over a built map; pauses at genuine forks (`needs-navigation`/`needs-classification`) |
| `webnav walk-resume <session> --ref e42 \| --classify safe` | answer a paused walk's fork; `--classify safe` fires a commit and continues (R5) |
| `webnav creds set\|list\|rm <site> [k=v…]` | local credential store (`~/.webnav/credentials.json`, chmod 600; never in the map) |
| `webnav locate "<place>"` | WHERE a place is (URL coordinate) without navigating |
| `webnav read <url> [--raw]` | open a URL → distilled content (the "go read this page" primitive) |
| `webnav recall <goal-id> "<query>"` | replay a goal's known route → evidence bundle (agent ranks). Goal carries site/entry/extractor as DATA. No goals ship by default — author/seed your own. |
| `webnav search "<query>" [--top N]` | multi-provider open-web search → visit top-N → extract evidence |
| `webnav route "<request>" [--capability X]` | graph: candidate site-nodes for a request + signals (agent decides) — over YOUR taught graph |
| `webnav hop <url> --to-cluster X \| --to-node Y` | graph: move to a related site via an edge |
| `webnav list-goals` | the recall goals webnav knows (id + signals) — so the agent can pick a goal-id |
| `webnav eval <url> "<js>"` | open a URL, run a JS expression → just the value (cheap, targeted extraction vs a full snapshot) |
| `webnav network <url>` | open a URL → the network/API calls the page made (the JSON behind the DOM) |
| `webnav go-back \| reload` | step within the current `-s=<session>` browser |
| `webnav login <key>` | save a hosted-route API key (un-advertised; the hosted service lives in the separate `webnav-site` repo) |
| `webnav use navigate <url> --session S` | open a URL in session S's browser (records a landing observation if S is recording) |
| `webnav use snapshot --session S` | the current page's snapshot + refs (the agent's "look"; never records) |
| `webnav use click <ref> --session S` | click a ref (from snapshot); records the before/after action-effect if recording |
| `webnav use type <ref> <text> --session S` | type into a field by ref; records the action-effect if recording |

`--help` is grouped **Find / Read / Navigate** (playwright-style), and each verb's per-verb help teaches data-flow (where its inputs come from / outputs go).

**Dev/teach verbs** (`webnav dev <verb>`, out of the consumer menu): `list`, `describe`, `node-add`, `edge-add`, `capture`, **`record-start`**, **`record-stop`**, **`graph-analyse`**, **`graph-edit`**, **`graph-show`**, **`effects`** (the agent-driven site-mapping flow — see below), plus `export-map` (a site's map pack as JSON), `outline` / `mermaid` (text views of an interior), `dashboard` (local operator UI: sites + JSON map + credentials), and `mcp` (serve all verbs as MCP tools over stdio).

Two CLI categories: **`use`** (drive the browser + query the map — the consumer verbs) and **`dev`** (author the map — the teach + mapping verbs). Both dispatchers re-parse the sub-verb; bare consumer verbs still work.

Exit codes: 0 ok · 2 error (→ stderr + `--help` hint) · 3 ran-fine-but-empty/failed.

### Interactive recording verbs (DONE, 2026-06-08)

Four `use` verbs give the agent **hands** to drive a live page across CLI calls and
record action-effects: `use navigate <url>` (open + landing observation),
`use snapshot` (read the page + refs; never records), `use click <ref>` /
`use type <ref> <text>` (perform + record before/after via `runActionRecorded`,
which now supports type/fill as well as click). One `--session` id = the
persistent `-s=` browser (survives across CLI processes) + the record buffer;
recording is conditional on an active session; verbs never close the browser.
`navigate` uses `open` (creates+navigates; `goto` fails on a fresh session).
This completes the agent loop: `dev record-start` → navigate/snapshot/click/type
→ `dev record-stop` → `dev graph-analyse` → `dev graph-edit`. Verified live on
saucedemo via the CLI (login `navigated:true`; add-to-cart `navigated:false`).
Spec/plan: `docs/superpowers/specs/2026-06-08-interactive-recording-verbs-design.md`,
`docs/superpowers/plans/2026-06-08-interactive-recording-verbs.md`.

### Affordance recording — action-effects (DONE, 2026-06-08)

webnav now records observed **action-effects** instead of inventing a state-node
per in-page change: each recorded step is `{ fromUrl, fromSnapshot, action, toUrl,
toSnapshot, navigated, diff }` (full before/after kept raw; diff + `navigated` are
mechanical derivations — `diffSnapshots`/`didNavigate`). In-page mutations
(saucedemo add-to-cart → button flips to "Remove", URL unchanged) record with
`navigated:false` — never a new node, killing the page=state ambiguity that
blocked the walk. `graph-analyse` is rebuilt **structure-neutral**: it returns raw
observations grouped by host (the page the action was taken on — `fromUrl`), with
NO clustering / states / edges. The calling AGENT decides the site's structure and
writes it via `graph-edit` (unchanged); webnav stays zero-LLM (the LLM is the
caller). `runActionRecorded` captures before/after around an agent action.
Verified live on saucedemo (add-to-cart → `navigated:false` + "Remove" in the
diff). Note: the page-only `runSnapshotRecorded` path still exists but
`graph-analyse` now reads action-effects (`actionEffects()`), so recording should
go through `runActionRecorded`. **Known follow-up:** the full raw before/after
snapshots ARE persisted (and readable in-process via `actionEffects()`), but
`graph-analyse` only emits a readable diff *summary* — there's no CLI verb yet
that hands the agent the raw snapshots, so the "raw stays for the agent" promise
isn't CLI-reachable end-to-end. Spec/plan:
`docs/superpowers/specs/2026-06-08-affordance-recording-design.md`,
`docs/superpowers/plans/2026-06-08-affordance-recording.md`.

### Agent-driven site mapping (DONE, 2026-06-05)

An agent explores an unknown site (driving via webnav's `use` browser primitives,
which record each page) and webnav builds a per-site navigation skeleton it can
later `recall`/`route` over — the "build the map from observed/declared data"
thesis applied to map-building. Flow: `dev record-start` opens a capture session →
agent browses (each page → url + structural fingerprint + declared links buffered
in SQLite via `runSnapshotRecorded`) → `dev record-stop` → `dev graph-analyse
<session>` mechanically clusters pages into state-TYPES per site + cross-site edges
(**zero-LLM, data not prose** — machine labels only; the agent names/validates) →
`dev graph-edit --node --graph <json>` upserts the agent's validated graph (creates
the node if new; fork edges that need user input are marked `unclassified` +
`[needs-input: why]`) → `dev graph-show --node` reads it back. The exploration loop
+ all judgment lives in the AGENT (#5a); webnav stays mechanical. Verified live
against GitHub. Spec/plan:
`docs/superpowers/specs/2026-06-04-agent-driven-site-mapping-design.md`,
`docs/superpowers/plans/2026-06-04-agent-driven-site-mapping.md`.

**Subagent model (CLAUDE.md):** subagents that USE or TEST webnav run on Haiku
(dogfooding the cost thesis); all other work uses the best model for the task.

### CLI framing + browser primitives (DONE, 2026-06-03)

webnav's `--help` is now framed like playwright-cli's: consumer verbs grouped by
purpose (**Find / Read / Navigate**) and per-verb help teaches **data-flow** (an
arg names where it comes from / where output goes — e.g. recall's goal-id is "from
`list-goals`", read's url is "from `locate`", playwright's `<ref>=from snapshot`
move). Added Navigate primitives built ON playwright-cli: `eval <url> "<js>"` (run
JS → just the value; clean-parsed out of playwright-cli's wrapper — the cheap
targeted-extraction path vs a 53k-token snapshot), `network <url>` (the API/JSON
calls behind the DOM), and `go-back`/`reload`. Verified live (eval returns the
psf/requests page title cleanly). Spec/plan:
`docs/superpowers/specs/2026-06-03-cli-framing-and-browser-primitives-design.md`,
`docs/superpowers/plans/2026-06-03-cli-framing-and-browser-primitives.md`.

### Generic verb re-grounding (DONE, 2026-06-03)

webnav's verbs are now **generic operations over map DATA** — no website baked into a verb (fixing the old `recall` = "navigate GitHub" coupling that made agents thrash a trivial "how many open issues" task). Highlights: added `read <url>` (the missing "open a page and read it" primitive — distilled content via `extractContent`/`classifyReadiness`, escalates on bot-walls, never evades); `recall <goal-id> "<query>"` is data-driven (explicit goal id, deterministic lookup, site-bound Goal record carries `site`/`entry`/`extractor`, named extractor registry) — GitHub-repos is the one seeded goal, a 2nd site is data-only; admin verbs moved under `webnav dev`; `list-goals` for discovery. Verified live (read returns "Issues 145" off the psf/requests page; recall still navigates GitHub end-to-end). Spec/plan: `docs/superpowers/specs/2026-06-02-generic-verb-regrounding-design.md`, `docs/superpowers/plans/2026-06-02-generic-verb-regrounding.md`.

## Inspecting the map

> The React-Flow web viewer left this repo with the 2026-06-10 site split (it lives in
> `webnav-site` now). In-repo inspection is text-first — the agent never read the UI anyway:

- `webnav dev outline <site>` — top-to-bottom states + typed affordances + completeness
  cues (unexplored exits, dead-ends, orphans).
- `webnav dev mermaid <site>` — a Mermaid stateDiagram; paste into GitHub/mermaid.live.
- `webnav dev graph-show --node <site>` / `webnav dev export-map <site>` — raw JSON.
- `webnav dev dashboard` — a local operator UI (localhost only) over `webnav.db` +
  `~/.webnav/credentials.json`: per-site maps + credential management.

DB facts that still hold: the DB is the **single source of truth** for interiors; the
default seed writes ONLY saucedemo (`seedGraph` → `ensureSeeded`; GitHub + the internet
graph are opt-in **programmatic/test fixtures** via `seedGitHubAndGraph` — a recall/route
against an unseeded map returns `failed`/empty). States carry a `node_id` column.
`MapStore` implements the `IMapStore` interface — the swappable seam the hosted backend
uses. Spec/plan: `docs/superpowers/specs/2026-06-02-live-graph-viewer-design.md`.

## R1/R1.1 — A/B benchmarks (DONE) + the navigation benchmark (PENDING, saucedemo)

`bench/` holds a re-runnable A/B benchmark: agent+webnav (CLI only) vs
agent+plain-search (WebSearch+WebFetch), scored by an anonymized judge against
gold answers (`bench/tasks.yml`, loader `bench/load.ts`, recipe in
`bench/README.md`, reports in `bench/results/`).

- **R1 (`2026-06-02.md`, the OLD GitHub-coupled CLI):** quality webnav 3 / baseline 1 /
  tie 8; webnav used MORE agent tokens (median +6k). Honest negative — the naive
  token-savings thesis did NOT hold on general info-seeking.
- **R1.1 (`2026-06-03-r1.1.md`, 3-arm, re-grounded CLI):** **webnav tied for best
  quality 9/10** (with raw-browser; baseline 7/10), never thrashed, swept the
  bot-walled category, and beat the API's subtly-wrong `open_issues_count`. Tokens
  ~equal across arms (~19–22k; every task forces a real fetch). webnav's proven edge
  is QUALITY on data search/APIs get wrong or can't reach — and honest failure on walls.
- **Navigation benchmark (designed, NOT run):** single-page lookups structurally can't
  show the navigation thesis. `2026-06-03-navigation-benchmark-design.md` designed the
  multi-page version against GitHub — **re-pointed (2026-06-12): run it on saucedemo**
  (`walk` vs an agent raw-driving the same login→cart→checkout flows; quality +
  reliability + tool-calls), matching the saucedemo-only positioning. Needs a machine
  with playwright-cli + open network (NOT runnable from a sandboxed cloud session).

## DONE (merged to main, verified)

- **v1 engine (Tasks 0–13):** snapshot parser, playwright-cli adapter (call-counted), SQLite MapStore, deterministic resolve/replay (commit-point safe), explorer, recall→evidence, goals, CLI.
- **Memory loop (M1–M3):** Router→MapStore→Explorer; skeleton built once, persisted, never re-explored (proven by reopen-from-disk test).
- **Cost thesis:** evidence bundle reports `tokens_saved`; verified live (~65k saved on a GitHub recall).
- **Multi-step walk (W1–W2):** `walkRoute` async, per-step predict-vs-observe, escalate on drift/commit. Verified live on saucedemo (login → inventory → correct escalation).
- **Research (R2/R3/R4):** readiness/interstitial detection; content extraction; multi-provider search. R4 verified live.
- **Phase 1:** CLI hardening (clig.dev).
- **Phase 2 G1–G3:** internet graph + `route`/`hop`.
- **Graph-viz:** `graph`/`node-add`/`edge-add` + the live xyflow viewer (below).

### Graph viewer — xyflow (DONE, 2026-06-06)

The live graph viewer is now a `web/` Vite + React + **@xyflow/react** app laid
out by **elkjs**, served as static `web/dist/` by the existing read-only Node
server (`npm run dev` → http://127.0.0.1:7777; `npm run dev:web` for HMR).
Cluster view → click a site → drill into its interior skeleton; fork
(`needs-input`) edges are dashed/orange. The Cytoscape viewer + the
`webnav graph --html` export were **removed**. The server stays read-only (live
editing is a future increment). `web/` is an **isolated package** — React/xyflow/
elk are NOT root deps. The riskiest logic (elk `layout.ts`, the fork-edge
predicate) is unit-tested; `serveStatic` (with a path-traversal guard) is
unit-tested; the live render was verified headless via playwright-cli (5 cluster
nodes → drill into github.com's 3-state interior + back control). Spec/plan:
`docs/superpowers/specs/2026-06-05-xyflow-graph-viewer-design.md`,
`docs/superpowers/plans/2026-06-05-xyflow-graph-viewer.md`.

### Graph quality + viewer — affordances, core path, node hygiene (DONE, 2026-06-08)

In-page actions are now first-class **`State.affordances`** (node repertoire),
NOT self-loop edges; **`Edge.core`** marks the agent-declared main journey.
`graph-edit` authors both + node `capabilities`/`topics` (no-clobber on update);
the interior API exposes them. The **viewer** renders affordance badges inside
node boxes, emphasizes core edges (thick/blue/full-opacity) vs faded non-core,
and shows **no connection dots** (invisible handles — no-handle drops edges in
@xyflow/react v12). The duplicate/blank saucedemo is fixed: the hand-seeded
`saucedemo`/`sd:*` skeleton is **removed entirely** (deleted `saucedemo-skeleton.ts`;
walk tests rewritten onto inline fixtures; gated walk e2es re-pointed to
`www.saucedemo.com` — both pass live). Saucedemo is now a single **agent-built**
`www.saucedemo.com` node (6 states with affordances, 9 edges incl. 4 core, node
metadata set, ZERO self-loops) — verified live in the viewer (6 nodes, 9 edges,
badges shown, 0 visible dots). **Note:** a fresh clone's `webnav.db` has no
saucedemo until an agent maps it (the seed no longer ships it). Spec/plan:
`docs/superpowers/specs/2026-06-08-graph-quality-and-viewer-design.md`,
`docs/superpowers/plans/2026-06-08-graph-quality-and-viewer.md`.

### Saucedemo affordance re-seed + walk affordance-pause (DONE, 2026-06-08)

Saucedemo is re-seeded in the **affordance model** (page-states + navigation edges
only; add-to-cart is an in-page affordance, NOT a state — the old page=state
bundled `inventory→cart` edge is retired; `exploreSaucedemo` clears `sd:*` edges
on seed). New edge field **`requiresAffordances: string[]`** (declared data) lets a
navigation edge declare in-page actions that must be fired first. `walkRoute`
**pauses** (`needs-navigation` listing the affordances) before traversing a gated
edge — for ANY gated edge en route, not just the first — and the agent fires them
then resumes; ungated edges traverse deterministically (autopilot preserved — see
the **walk vs use** note in CLAUDE.md). `graph-edit` accepts `requiresAffordances`
so agent-built graphs can gate edges too. Verified live: the saucedemo walk logs
in, reaches inventory, and pauses for the add-to-cart affordance. This **completes
the interactive walk** (engine + verbs landed earlier; this finishes the saucedemo
demo on one consistent model). Spec/plan:
`docs/superpowers/specs/2026-06-08-saucedemo-affordance-reseed-walk-design.md`,
`docs/superpowers/plans/2026-06-08-saucedemo-affordance-reseed-walk.md`. (Walk
engine + verbs: `docs/superpowers/specs/2026-06-06-interactive-walk-design.md`.)

## ⚠️ PENDING — start here next session

In roughly recommended order:

1. **Saucedemo navigation benchmark (the thesis test):** run the re-pointed multi-page
   benchmark — `walk` vs an agent raw-driving saucedemo's login→cart→checkout flows
   (quality + reliability + tool-calls). Design: `2026-06-03-navigation-benchmark-design.md`
   (+ the 2026-06-12 re-point note above). Needs playwright-cli + open network.
2. **One-command `map <url>` flow + shareable map packs:** the record→analyse→edit
   authoring flow works but is expert-ish; the README promises this on the roadmap.
   `dev export-map` already emits the pack — import + a guided flow are the gap.
3. ~~**R5 — resume loop**~~ ✅ **DONE (2026-06-10):** `classify: safe` fires a commit and the walk continues to completion (verified live, login→…→checkout-complete). Default still hard-halts at commits (#2).
4. ~~**Phase 5 — MCP wrapper**~~ ✅ **DONE (2026-06-12):** `webnav mcp` serves every verb as MCP tools over stdio; generated from cli-spec; calls run the real CLI.
5. **PARKED — multi-site graph features** (G4 co-use weight learning, auto-learn nodes
   from usage, richer GitHub signals): the internet graph + GitHub recall are not the
   advertised product surface (2026-06-12 repositioning) — revisit only if/when that
   surface comes back.

## Honest known limitations (not bugs — design/ecosystem reality)

- **Open-web search quality is capped** by which engines tolerate a real browser (Marginalia/Wiby work; Google/Bing/DuckDuckGo bot-wall). We do NOT evade — we detect + escalate. Better coverage needs official search APIs (keys) — see the doors layer.
- **GitHub run-2 isn't fewer page-loads** (search + each detail are irreducible fresh re-reads); the real saving is agent tokens, every run.
- **Bot-walled sites are reported as blocked, never bypassed** (principle: no detection evasion).

## Future architecture (designed, NOT built — see specs)

- **Sanctioned-doors layer:** per-node access terms `open|api-key|cash|attention-loop`; route to the cheapest *sanctioned* door; search APIs (Google/Bing/Brave) as first-class providers when a key is configured. Detect-and-escalate at walls/tolls, never evade.
- **Attention-return economics** (`docs/superpowers/specs/2026-05-31-attention-return-economics.md`) — PARKED until testable (pay-per-crawl 402 is private-beta; real payout needs an affiliate account). The thesis is real & live in the market (Cloudflare pay-per-crawl; OpenAI Ads Manager; Shopify agentic storefronts; affiliate attribution) but not end-to-end testable for us yet. Revisit trigger documented in that spec.

## Working conventions (for the next session)

- **Per-increment worktree:** build each feature on its own branch in `.worktrees/<name>`, TDD, merge to `main` when green, remove the worktree. (`worktree.baseRef=head` is set so worktrees branch from local HEAD — no remote configured.)
- **Subagents can't run Bash here** — pattern used all session: the implementer subagent WRITES code+tests and reports; the main session runs vitest/build/commit.
- **Dogfood + "failures are features":** use webnav on real problems; every failure becomes a feature to fix (this caught the open/goto bug, relative-link bug, license-noise bug, search chrome-leak, render-race).
- **`dontAsk` permission mode** is set in `.claude/settings.local.json` (takes effect on a fresh session) to stop repeated allow-prompts.
- The repo is public: `github.com/lucyfuur94/webnav` (CI on push/PR to `main`). The
  website/hosted backend is the separate `webnav-site` repo.
