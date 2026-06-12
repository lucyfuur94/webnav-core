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
  example that proves it works. **You record your own sites** (see below); that's the
  product. This fits any flow you repeat against the same site: automation testing,
  internal tools, back-office workflows, recurring agent tasks. (A GitHub `recall`
  skeleton and a small internet-graph exist in the codebase as programmatic/test
  fixtures only — they are deliberately not seeded and not part of the product surface.)
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

## Verbs

```
# Travel a map you've built (the core win: deterministic, low-token replay)
webnav walk --start <state> --goal <state>   autopilot a multi-step route; pauses at genuine forks
webnav walk-resume <session> --ref|--classify   answer a paused walk's fork and continue
webnav creds set <site> key=value...         store login/form creds locally (~/.webnav, chmod 600)

# Drive a live browser one step at a time (explore/build; each step recordable)
webnav use navigate <url> --session S        open a URL (records a landing if S is recording)
webnav use snapshot --session S              read the page + element refs (never records)
webnav use click <ref> / use type <ref> <t>  act on a ref; records the before/after effect
webnav read <url> [--raw]                    open a URL -> distilled content
webnav eval <url> "<js>" | network <url>     targeted JS extraction | the page's API calls

# Author a site's map (the record -> analyse -> edit flow)
webnav dev record-start / record-stop        bracket a mapping session
webnav dev graph-analyse --session S         mechanical structure from what you recorded
webnav dev graph-edit --node <id> --graph J  write the validated graph
webnav dev effects --session S               the RAW recorded before/after snapshots
webnav dev outline <site> | mermaid <site>   completeness check | renderable diagram
webnav dev graph-show --node <id>            a site's stored states + edges (JSON)
webnav dev export-map <site>                 a site's map pack as JSON (skeleton only, no creds)
webnav dev dashboard [--port N]              local operator UI: sites + JSON map + credentials
webnav dev node-add / edge-add / list / describe / capture   teach + inspect helpers

# Query maps / the web (operate on whatever maps + goals YOU have built)
webnav locate "<place>" | list-goals         place lookup | stored recall goals
webnav recall <goal-id> "<query>"            replay a stored goal route -> evidence bundle
webnav search "<query>" [--top N]            open-web search -> extracted evidence
webnav route "<request>" | hop <url> --to-…  query/traverse your inter-site graph
```
`webnav <verb> --help` for details. Output is JSON on stdout; exit 0 ok / 2 error / 3 empty.

### MCP server

`webnav mcp` serves every verb as an MCP tool over stdio — point an MCP client at it and
agents get the verbs natively (no shelling out). Tools are generated from the same command
registry as `--help`, and every call runs the real CLI, so the two surfaces can't drift:

```json
{ "mcpServers": { "webnav": { "command": "webnav", "args": ["mcp"] } } }
```

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
paths.ts, creds.ts, hosted.ts        ~/.webnav paths · local credential store · remote-map client
mcp/       server.ts                 `webnav mcp`: every verb as an MCP tool (generated from cli-spec)
mapstore/  types.ts, store.ts, record.ts, schema.sql   SQLite persistence (states+affordances, edges, goals, nodes, node_edges, record sessions)
playwright/ adapter.ts, snapshot.ts, capture.ts   playwright-cli child-process + a11y-tree snapshot parser
explorer/  explorer.ts, analyse.ts, diff.ts, fingerprint.ts, fingerprint-page.ts, github-skeleton.ts   read structure / diff effects / recognize states / test skeleton
router/    resolve.ts, replay.ts, router.ts, recall-via-map.ts, live.ts    navigate + recall
           readiness.ts, extract.ts, extract-content.ts, tokens.ts        bot-wall detection, signal/content extraction, token-savings
           search.ts, search-providers.ts, search-live.ts                 multi-provider open-web search
           walk.ts, walk-live.ts, walk-session.ts, path.ts, browse.ts, read.ts   interactive multi-step walk + pathfinding + page reading
           catalog.ts, locate.ts                                          list/describe + place lookup
graph/     seed.ts, route.ts, hop.ts, teach.ts, edit.ts, show.ts, export.ts, interior.ts, coverage.ts   inter-site graph + map authoring/inspection
goals/     find-battle-tested-repos.ts                                    the (only) GitHub-repo-specific goal (test fixture)
dashboard/ server.ts, shell.ts                                            `webnav dev dashboard` local operator UI
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
