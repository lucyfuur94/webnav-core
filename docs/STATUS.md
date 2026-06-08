# webnav — STATUS (live handoff)

**Updated:** 2026-06-08 · **Branch:** `main` · **Tests:** 318 unit pass + 8 gated live e2e (skipped without `WEBNAV_LIVE=1`) · **Build:** green (incl. web/)

> This is the canonical "where are we / what's next / how to run" doc. Keep it
> current. CLAUDE.md = settled design & principles; this = the live checklist.
> Design docs live in `docs/superpowers/specs/`, the v1 plan in `docs/superpowers/plans/`.

---

## What webnav is (one line)

A zero-LLM web-navigation **memory + map** ("Google Maps for the agent-internet"):
an agent shells out to the `webnav` CLI to navigate sites reliably, recall routes,
search the web, and get back compact **evidence** — the agent does all judgment.
See CLAUDE.md for the full mental model and the 6+ settled principles (esp. #5a:
webnav contains NO LLM; never evades bot-walls).

## How to run

```
npm install          # better-sqlite3 native build; Node 18+
npm test             # vitest — 192 pass, 2 gated e2e skipped
npm run build        # tsc -> dist/ (+ copies schema.sql)
npx tsx src/cli.ts --help      # the tool menu (every verb + when-to-use)
WEBNAV_LIVE=1 npx vitest run tests/e2e   # the gated live tests (need a browser + network)
```
Requires `playwright-cli` on PATH (installed at `/usr/local/bin/playwright-cli`).
A file-backed `webnav.db` (SQLite, gitignored) persists the map across runs.

## The verbs (generic primitives over the map; self-describing CLI)

**Consumer verbs** (the `webnav --help` menu):

| Verb | What it does |
|---|---|
| `webnav locate "<place>"` | WHERE a place is (URL coordinate) without navigating |
| `webnav read <url> [--raw]` | open a URL → distilled content (the "go read this page" primitive) |
| `webnav recall <goal-id> "<query>"` | replay a goal's known route → evidence bundle (agent ranks). Goal carries site/entry/extractor as DATA — no site baked into the verb. Defaults to `github-repos`. |
| `webnav search "<query>" [--top N]` | multi-provider open-web search → visit top-N → extract evidence |
| `webnav route "<request>" [--capability X]` | graph: candidate site-nodes for a request + signals (agent decides) |
| `webnav hop <url> --to-cluster X \| --to-node Y` | graph: move to a related site via an edge |
| `webnav list-goals` | the recall goals webnav knows (id + signals) — so the agent can pick a goal-id |
| `webnav eval <url> "<js>"` | open a URL, run a JS expression → just the value (cheap, targeted extraction vs a full snapshot) |
| `webnav network <url>` | open a URL → the network/API calls the page made (the JSON behind the DOM) |
| `webnav go-back \| reload` | step within the current `-s=<session>` browser |
| `webnav use navigate <url> --session S` | open a URL in session S's browser (records a landing observation if S is recording) |
| `webnav use snapshot --session S` | the current page's snapshot + refs (the agent's "look"; never records) |
| `webnav use click <ref> --session S` | click a ref (from snapshot); records the before/after action-effect if recording |
| `webnav use type <ref> <text> --session S` | type into a field by ref; records the action-effect if recording |

`--help` is grouped **Find / Read / Navigate** (playwright-style), and each verb's per-verb help teaches data-flow (where its inputs come from / outputs go).

**Dev/teach verbs** (`webnav dev <verb>`, out of the consumer menu): `list`, `describe`, `graph`, `node-add`, `edge-add`, `capture`, **`record-start`**, **`record-stop`**, **`graph-analyse`**, **`graph-edit`**, **`graph-show`** (the agent-driven site-mapping flow — see below).

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
later `recall`/`route` over — the "Google Maps was built from observed data"
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

## Viewing the graph (live)

`npm run dev` → open **http://127.0.0.1:7777**. A read-only HTTP server
(`src/server.ts`, Node built-in `http`, no new ROOT deps) over the **live** SQLite
map: `/api/graph` (whole internet graph) and `/api/node/:id/interior` (one
site's intra-site skeleton — its states + action-edges), plus the static viewer
bundle from `web/dist/`. **Click a site-node to drill into its interior** (e.g.
github.com → search-entry → result-list → repo-detail). The viewer is a `web/`
Vite + React + **@xyflow/react** app laid out by **elkjs** (see below);
`npm run dev:web` runs it with HMR. `webnav graph` emits the graph as JSON.

DB is now the **single source of truth** for interiors: the known skeletons
(GitHub, saucedemo) are written by the **seed step** (`seedGraph`), not lazily on
the recall/walk path — the lazy `exploreGitHub`/`exploreSaucedemo` bootstrap was
removed (a recall against an unseeded map returns `failed`; seed first). States
gained a `node_id` column (backfilled from the `<node>:<state>` id prefix via an
idempotent migration). `MapStore` now implements an `IMapStore` interface — the
swappable seam for a future hosted backend. Spec/plan:
`docs/superpowers/specs/2026-06-02-live-graph-viewer-design.md`,
`docs/superpowers/plans/2026-06-02-live-graph-viewer.md`.

## R1 — A/B benchmark (DONE)

`bench/` holds a re-runnable A/B benchmark: agent+webnav (CLI only) vs
agent+plain-search (WebSearch+WebFetch), both Sonnet, scored by an anonymized
Sonnet judge against gold answers. Broad mixed task set (`bench/tasks.yml`,
unit-tested loader `bench/load.ts`); run recipe + verbatim prompts in
`bench/README.md`; reports in `bench/results/`. **First run
(`bench/results/2026-06-02.md`): quality webnav 3 / baseline 1 / tie 8; webnav
used MORE agent tokens (median +6k), NOT fewer.** Honest finding — the naive
token-savings thesis did NOT hold on general info-seeking (the baseline answers
known facts with 0 tool calls; webnav always navigates). webnav's demonstrated
edge is QUALITY on non-recallable data: won the fresh-maintenance comparison and
swept the botwalled category 2-0 (read a free NYT homepage; caught a baseline
hallucination). Spec: `docs/superpowers/specs/2026-06-02-r1-ab-benchmark-design.md`.

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

### Interactive walk — engine + verbs (ENGINE DONE, demo pending — 2026-06-08)

The multi-step walk is now agent-usable: `webnav walk --start <id> --goal <id>
[--input k=v ...]` pathfinds the weighted-shortest route over the graph
(`findPath`) and walks it; on a fork it persists a **walk-session** and returns
`{ session, status: needs-* }`; `webnav walk-resume <session> --ref <e>` /
`--classify safe|commit` continues (commit = hard halt, never fires — #2).
Runtime inputs (`--input`) are in-memory only, never persisted. Walks are pure
graph traversal (no walk records); webnav computes the path. Engine + verbs are
unit-tested and the mechanics verified live (login → inventory → resume).
**Pending:** the saucedemo *full-completion* demo hit the page=state defect
(in-page add-to-cart was being modeled as a new state → ambiguity) — fixed at the
root by the **affordance-recording** increment
(`docs/superpowers/specs/2026-06-08-affordance-recording-design.md`). Finish the
walk's live demo + a richer e2e after affordance-recording lands. Spec/plan:
`docs/superpowers/specs/2026-06-06-interactive-walk-design.md`,
`docs/superpowers/plans/2026-06-06-interactive-walk.md`.

## ⚠️ PENDING — start here next session

In roughly recommended order:

1. **R5 — resume loop:** agent answers a `needs-navigation`/`needs-classification`; `walkRoute` continues to completion. Lets the saucedemo flow finish autonomously end-to-end.
2. **G4 — co-use weight learning:** node-edge weights emerge from usage + decay (the Maps-traffic analog), so `route` ordering reflects real use. `recordOutcome`/`decayConfidence` machinery already exists at the intra-site edge level — reuse at the node level.
3. **Auto-learn nodes from usage:** when search/recall visits a new site, auto-add it as a node (the self-growing gazetteer).
4. **Phase 5 — MCP wrapper (secondary):** expose the verbs as MCP tools; CLI stays primary; test both.
5. **Richer GitHub signals:** `closed_issues`, `latest_release`, `has_ci` (currently omitted).
6. **Token-thesis follow-up (from R1):** R1 showed webnav does NOT save agent tokens on general-info tasks (the baseline answers known facts with 0 tool calls). To test the token thesis fairly, add tasks REQUIRING multi-step navigation to non-addressable state. webnav's proven edge is QUALITY on non-recallable data (fresh signals, bot-walled/paywalled content) — see `bench/results/2026-06-02.md`.

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
- No git remote yet — push when the repo is defined (user will do this).
