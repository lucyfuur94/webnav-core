# webnav

**"Google Maps for the agent-internet."** A zero-LLM web-navigation **memory + map**: an
LLM agent shells out to the `webnav` CLI to navigate websites reliably, recall routes it's
learned, search the open web, and get back compact **evidence** — while the agent itself does
all the judgment. webnav is the honest map and mechanics; the agent is the driver.

> New here? Read **`docs/STATUS.md`** (current state + what's next + how to run) and
> **`CLAUDE.md`** (settled design, mental model, and principles). Design docs: `docs/superpowers/specs/`.

## Why

Web agents waste tokens re-reading huge page snapshots and re-discovering how to get around a
site on every query; plain web search returns un-vetted results. webnav navigates
**deterministically (no LLM)**, remembers the route, and returns a clean evidence bundle — so
the agent spends its expensive reasoning on *judging results*, not on *re-finding them*. The
measured win is the agent's **tokens + time** (the evidence bundle reports `tokens_saved`).

## Quickstart

```bash
npm install                 # Node 18+ (better-sqlite3 native build)
npm link                    # install `webnav` on PATH (runs src via tsx — NO build needed)
webnav --help               # the tool menu (a peer of playwright-cli)
npm test                    # unit tests (+ gated browser e2e)
npm run build               # tsc -> dist/ (only needed for the dist build; the `webnav` CLI runs src directly)
```
Needs `playwright-cli` on PATH. A gitignored `webnav.db` (SQLite) persists the map across runs.

## Verbs

```
webnav list                                  what webnav knows (sites, places, goals)
webnav describe "<place>"                    a place's address + what you can do there
webnav locate "<place>"                      WHERE a place is (URL) — no navigation
webnav recall "<use-case>"                   GitHub repo discovery -> evidence bundle (agent ranks)
webnav search "<query>" [--top N]            multi-provider open-web search -> extracted evidence
webnav route "<request>" [--capability X]    graph: which site(s) for this request + signals
webnav hop <url> --to-cluster X|--to-node Y  graph: move to a related site
webnav dev node-add <id> --url --capabilities --topics    teach a new site
webnav dev edge-add <from> <to> --kind           teach a relationship
webnav dev graph-show --node <id>            a site's stored states + edges (JSON)
webnav dev outline <site>                    human-readable interior outline (completeness check)
webnav dev mermaid <site>                    a Mermaid stateDiagram of the interior
webnav capture <url> <out.yml>               dev: save a snapshot YAML
```
`webnav <verb> --help` for details. Output is JSON on stdout; exit 0 ok / 2 error / 3 empty.

Consumer verbs can also be invoked canonically as `webnav use <verb> ...` and map-authoring verbs as `webnav dev <verb> ...`; bare consumer verbs (e.g. `webnav recall ...`) still work too.

### Inspect a site's map
The map is for the calling AGENT (recall/walk), not a human dashboard. To inspect
what's captured, use the text views — no UI:
```bash
webnav dev outline www.saucedemo.com    # top-to-bottom states + affordances + completeness cues
webnav dev mermaid www.saucedemo.com     # paste into GitHub/mermaid.live to render
webnav dev graph-show --node <id>        # raw JSON
```

## Architecture (one CLI, three components, ZERO LLM)

- **Explorer** — reads a site's declared structure (observe-first) and writes states/edges to MapStore.
- **MapStore** — SQLite persistence: intra-site skeletons (states+edges) AND the inter-site graph (nodes+node_edges).
- **Router** — recalls a route, replays it (cached selector → deterministic re-resolve), self-heals, returns evidence OR a `needs-navigation`/`needs-classification` "your move" response for the agent. Never judges, never calls an LLM.

The **internet graph** sits above the per-site skeletons: nodes = websites, clusters = capabilities
(web-search, code-search, …), edges = relationships. `route`/`hop` traverse it; intra-site
skeletons are the node interiors.

## Source map (`src/`)

```
cli.ts, cli-spec.ts, cli-help.ts     CLI: parsing, command registry, help rendering
protocol.ts                          RecallResponse / EvidenceBundle / Coordinate types
mapstore/  types.ts, store.ts, schema.sql    SQLite persistence (states, edges, goals, nodes, node_edges)
playwright/ adapter.ts, snapshot.ts, capture.ts   playwright-cli child-process + a11y-tree snapshot parser
explorer/  explorer.ts, fingerprint.ts, github-skeleton.ts, saucedemo-skeleton.ts   read structure / recognize states / seeded skeletons
router/    resolve.ts, replay.ts, router.ts, recall-via-map.ts, live.ts    navigate + recall (GitHub)
           readiness.ts, extract.ts, extract-content.ts, tokens.ts        bot-wall detection, signal/content extraction, token-savings
           search.ts, search-providers.ts, search-live.ts                 multi-provider open-web search
           walk.ts, walk-live.ts                                          interactive multi-step walk (saucedemo)
           catalog.ts, locate.ts                                          list/describe + place lookup
graph/     seed.ts, route.ts, hop.ts, teach.ts, edit.ts, show.ts, coverage.ts   the internet graph + map authoring/inspection
goals/     find-battle-tested-repos.ts                                    the (only) GitHub-repo-specific goal
```
Tests mirror this under `tests/`. The live e2e walk tests are gated behind `WEBNAV_LIVE=1`.

## Principles (full list in CLAUDE.md)

1. Observe first, traverse rarely. 2. Never traverse a declared commit point. 3. Store durable
semantic routes; cache selectors. 4. Confidence decays with age, updates with use. 5. The map
surfaces evidence; the **agent** judges. **5a. ZERO LLM in webnav** — all reasoning offloaded to
the calling agent via a call-and-response protocol. 6. The map is a use-case-independent
navigation skeleton; goals declare signal interests. **Never evade bot-walls** — detect + escalate.

## Status

All current work is merged to `main`, tests green. See **`docs/STATUS.md`** for the live
checklist, pending work, and known
limitations. No git remote configured yet.
