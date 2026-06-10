# webnav

[![CI](https://github.com/lucyfuur94/webnav/actions/workflows/ci.yml/badge.svg)](https://github.com/lucyfuur94/webnav/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](https://www.typescriptlang.org/)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
![zero-LLM](https://img.shields.io/badge/runtime-zero--LLM-7c4dff.svg)

**A navigation memory for AI agents.** A zero-LLM web-navigation **memory + map**: an
LLM agent shells out to the `webnav` CLI to navigate websites reliably, recall routes it's
learned, search the open web, and get back compact **evidence** — while the agent itself does
all the judgment. webnav is the honest map and mechanics; the agent is the driver.

> **Website:** <https://webnav.dpdns.org> · **Two ways to use it:** self-host (free, this repo) or
> the **hosted shared-knowledge route** (a maintained central map you fetch over the network — your
> credentials still stay local). See [Two routes](#two-routes-self-host-vs-hosted) below.

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
Needs `playwright-cli` on PATH.

## How the map grows (start here if you're new)

webnav is a **map** — and a fresh install is **not** blank, but it is small. Here's
honestly what you get and how it grows, so there are no surprises:

- **What ships, out of the box.** The first time you run any verb, webnav seeds a shared
  map at **`~/.webnav/webnav.db`** (per-user, shared across every terminal/folder on the
  machine — *not* a per-directory file). It comes pre-seeded with **one** worked example:
  **saucedemo.com** — a full login→browse→cart→checkout `walk` map. This works immediately:
  ```bash
  webnav walk --start www.saucedemo.com:login \
              --goal www.saucedemo.com:checkout-complete      # saucedemo, seeded
  ```
  Nothing else is seeded — webnav is a blank-slate map tool, and saucedemo is the single
  example that proves it works. (The GitHub `recall` skeleton + the internet-graph for
  `route`/`search` are available but **opt-in** — seed them with `seedGitHubAndGraph`, or
  build your own maps; they are intentionally not in the default install.)
- **The map persists and self-heals.** It's saved to `~/.webnav/webnav.db` and reused on
  every run — you do **not** rebuild it each time. When a remembered step drifts (a renamed
  or moved element), a `walk` escalates once for the agent to pick the element, then **writes
  the fix back** so the next run resolves it deterministically (principle #3). Routes you use
  stay fresh; routes nobody uses decay. Credentials for login-gated sites live **outside** the
  map, locally, at `~/.webnav/credentials.json` (chmod 600) — never in the DB, never shared.
- **Mapping a NEW site (the current rough edge — honest).** Any site beyond the two seeded
  ones has no map yet, and adding one today is a manual, multi-step authoring flow
  (`dev record-start` → browse the site via webnav → `dev record-stop` → `dev graph-analyse`
  → `dev graph-edit`), or hand-writing a skeleton with `dev node-add`/`dev graph-edit`. This
  is expert-ish; a one-command `map <url>` flow and shareable "map packs" (so maps travel
  between users instead of every install being an island) are on the roadmap, not built yet.
- **Inspect what you have** anytime: `webnav dev dashboard` (a localhost operator UI for
  sites + credentials), or the text views `dev outline <site>` / `dev mermaid <site>`.

**TL;DR:** out of the box you can `walk` saucedemo; everything else you map yourself. Same
machine + a mapped site → instant, cached, self-healing. A brand-new site → you (or your
agent) record it once first.

## Two routes: self-host vs hosted

There are two ways to get maps — and **both keep your credentials 100% local** (the hosted route
moves only the map skeleton, never logins).

- **Self-host (this repo, free forever, Apache-2.0):** build/own your maps in the local
  `~/.webnav/webnav.db`. No account, no key, no limits.
- **Hosted shared-knowledge route:** instead of building maps, fetch a maintained central map over
  the network — always the latest. Get a free API key from the website, then:
  ```bash
  webnav login wn_live_xxx        # free key from https://webnav.dpdns.org/keys
  webnav walk --hosted --start www.saucedemo.com:login --goal www.saucedemo.com:checkout-complete
  ```
  The map is fetched live and metered per key (free tier + usage-based paid tiers); your site
  credentials are still loaded locally by `CredStore`. The key lives in `~/.webnav/config.json`,
  separate from credentials. The website + hosted API are a separate service (not part of this
  open-source repo); this repo ships the **client** (`login`, `walk --hosted`) and the
  `dev export-map` verb that produces the map packs a hosted service publishes.

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
webnav dev dashboard [--port N]              local operator UI: sites + JSON map + credentials
webnav creds set <site> key=value...         store login/form creds locally (~/.webnav, chmod 600)
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
checklist, pending work, and known limitations.

## Contributing

PRs welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md) (the settled principles, dev setup, and how
to contribute a **site map** — the highest-leverage contribution). Report security issues privately
per [`SECURITY.md`](SECURITY.md). Be excellent to each other: [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## License

[Apache License 2.0](LICENSE). Free to use, modify, and redistribute (including commercially)
**with attribution**: retain the copyright notice and the [`NOTICE`](NOTICE) file. Includes an
explicit patent grant. Copyright 2026 Dikshant Yadav.
