# webnav — STATUS (live handoff)

**Updated:** 2026-06-03 · **Branch:** `main` · **Tests:** 239 unit pass + 4 gated live e2e (skipped without `WEBNAV_LIVE=1`) · **Build:** green

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

**Dev/teach verbs** (`webnav dev <verb>`, out of the consumer menu): `list`, `describe`, `graph`, `add-node`, `add-edge`, `capture`.

Exit codes: 0 ok · 2 error (→ stderr + `--help` hint) · 3 ran-fine-but-empty/failed.

### Generic verb re-grounding (DONE, 2026-06-03)

webnav's verbs are now **generic operations over map DATA** — no website baked into a verb (fixing the old `recall` = "navigate GitHub" coupling that made agents thrash a trivial "how many open issues" task). Highlights: added `read <url>` (the missing "open a page and read it" primitive — distilled content via `extractContent`/`classifyReadiness`, escalates on bot-walls, never evades); `recall <goal-id> "<query>"` is data-driven (explicit goal id, deterministic lookup, site-bound Goal record carries `site`/`entry`/`extractor`, named extractor registry) — GitHub-repos is the one seeded goal, a 2nd site is data-only; admin verbs moved under `webnav dev`; `list-goals` for discovery. Verified live (read returns "Issues 145" off the psf/requests page; recall still navigates GitHub end-to-end). Spec/plan: `docs/superpowers/specs/2026-06-02-generic-verb-regrounding-design.md`, `docs/superpowers/plans/2026-06-02-generic-verb-regrounding.md`.

## Viewing the graph (live) — NEW

`npm run dev` → open **http://127.0.0.1:7777**. A read-only HTTP server
(`src/server.ts`, Node built-in `http`, no new deps) over the **live** SQLite
map: `/api/graph` (whole internet graph) and `/api/node/:id/interior` (one
site's intra-site skeleton — its states + action-edges). **Click a site-node to
drill into its interior** (e.g. github.com → search-entry → result-list →
repo-detail). `webnav graph --html > map.html` still produces a static,
shareable snapshot (no drill-in).

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
- **Graph-viz:** `graph`/`add-node`/`add-edge` + Cytoscape HTML viewer.

## ✅ Graph HTML viewer render — VERIFIED (2026-06-01)

Rendered `webnav graph --html` headlessly and confirmed Cytoscape draws all 5
nodes, cluster colors, 3 labelled edges, the legend, and both teach forms.
**Note:** `playwright-cli` blocks `file:` URLs (only http/https/data allowed),
so the path is: `webnav graph --html > /tmp/map.html` → `python3 -m http.server`
→ `playwright-cli goto http://127.0.0.1:PORT/map.html` → `eval`/`screenshot`.
While verifying, found + fixed a real bug: `cytoscape-fcose@2` threw on load
(`Cannot read properties of undefined (reading 'layoutBase')`) because its
`layout-base`/`cose-base` peer deps weren't loaded and it wasn't registered via
`cytoscape.use` — the viewer was silently falling back to the plain `cose`
layout. Fixed in `src/graph/html.ts` (deps loaded in order + explicit guarded
`cytoscape.use(cytoscapeFcose)`); re-verified render is clean (only a harmless
favicon 404 remains). Covered by a new unit test in `tests/graph/html.test.ts`.

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
