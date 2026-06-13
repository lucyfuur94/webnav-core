# webnav

[![CI](https://github.com/lucyfuur94/webnav-core/actions/workflows/ci.yml/badge.svg)](https://github.com/lucyfuur94/webnav-core/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](https://www.typescriptlang.org/)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
![zero-LLM](https://img.shields.io/badge/runtime-zero--LLM-7c4dff.svg)

**A navigation memory for AI agents.** Your agent maps a website **once** — then travels it
forever with `webnav walk`: deterministic, zero-LLM, page-to-page autopilot that pauses only
at genuine forks (what to buy, an irreversible button) and hands the wheel back. webnav is
the map and the mechanics; the agent keeps all the judgment.

## See it

A real run against saucedemo's full checkout flow (map + credentials already recorded):

```console
$ webnav walk --start www.saucedemo.com:login --goal www.saucedemo.com:checkout-overview
{ "status": "needs-navigation",
  "semanticStep": "open the shopping cart",
  "question": "before \"open the shopping cart\", fire these in-page affordances: aff_addcart",
  "snapshot": "…", "session": "walk-w-…", "browserSession": "w-…" }
   # ^ paused at a REAL fork: webnav won't decide what you buy. The agent picks from the snapshot:

$ webnav use click e54 --session w-…          # add-to-cart — the agent's one judgment call
$ webnav walk-resume walk-w-… --ref e124      # continue; e124 = the icon-only cart badge
{ "status": "done", "cost": { "playwright_calls": 12 } }
```

**4 agent-visible CLI calls**, login → inventory → cart → checkout form (**auto-filled from
locally-stored creds** — never in the map) → overview. 12 browser actions underneath, zero
agent tokens spent on navigation. In our [benchmark](bench/results/2026-06-13-nav.md), an
agent ad-hoc-driving the same flow with a raw browser spent **16–22 reasoned actions** per
task, each ingesting a full page snapshot — and fell into saucedemo's login-session trap in
**3 of 4 runs** (webnav's map already knows that icon-only cart link needs a URL jump).

## Why

Web agents re-discover the same websites every single day, paying the same token bill every
time: snapshot → reason → click → snapshot. For sites you (or your agents) use repeatedly —
internal tools, automation testing, back-office workflows — that navigation should be
**remembered, not re-reasoned**. webnav stores the durable *intent* of each step, replays it
deterministically, self-heals when the site drifts, and **never** auto-fires an irreversible
action: commit points always pause for the agent (or you) to decide.

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
  internal tools, back-office workflows, recurring agent tasks. (An earlier GitHub-recall
  + internet-graph engine — the v1 proof-of-engine — was removed from the tree 2026-06-13;
  it lives in git history if that surface ever returns.)
- **The map persists and self-heals.** It's saved to `~/.webnav/webnav.db` and reused on
  every run — you do **not** rebuild it each time. When a remembered step drifts (a renamed
  or moved element), a `walk` escalates once for the agent to pick the element, then **writes
  the fix back** so the next run resolves it deterministically (principle #3). Routes you use
  stay fresh. Credentials for login-gated sites live **outside** the
  map, locally, at `~/.webnav/credentials.json` (chmod 600) — never in the DB, never shared.
- **Mapping a NEW site — hand your AGENT the learn prompt.** webnav is built for agents, so you
  don't map by hand: you give an agent (even a cheap one — we use Haiku) the reusable prompt in
  **[`docs/LEARNING-A-SITE.md`](docs/LEARNING-A-SITE.md)** and let it run autonomously. It drives the
  site once through webnav's `use` primitives while recording, then `dev graph-analyse --draft` folds
  that into a SELF-VERIFIED map (absolute URLs, unique element fingerprints, the in-page affordance
  repertoire, the declared domain shadow) which it persists with `dev graph-edit`. No hand-authoring
  of fingerprints or URLs. (That prompt learned the seeded OrangeHRM map — login + 11 modules,
  exercised — in a single one-shot run.) Re-learn cleanly with `dev node-clear`.
- **Or skip learning — import a map pack someone already made.** A map travels as a pack, so only the
  first person learns a site. `webnav dev import-map <pack.json>` loads a site's skeleton; set your own
  login with `dev creds set` (packs are skeleton-only, never carry credentials). Two packs ship in
  **[`mappacks/`](mappacks/)** (saucedemo, OrangeHRM); `dev export-map <site>` makes your own to share.
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
webnav search "<query>" [--top N]            open-web search -> extracted evidence
webnav eval <url> "<js>" | network <url>     targeted JS extraction | the page's API calls

# Author a site's map (the record -> analyse -> edit flow)
webnav dev record-start / record-stop        bracket a mapping session
webnav dev graph-analyse --session S [--draft]  mechanical structure from what you recorded
                                             (--draft = a self-verified, ready-to-edit graph spec)
webnav dev graph-edit --node <id> --graph J  write the validated graph
webnav dev effects --session S               the RAW recorded before/after snapshots
webnav dev outline <site> | mermaid <site>   completeness check | renderable diagram
webnav dev graph-show --node <id>            a site's stored states + edges (JSON)
webnav dev export-map <site>                 a site's map pack as JSON (skeleton only, no creds)
webnav dev dashboard [--port N]              local operator UI: sites + JSON map + credentials
webnav dev list                              the sites you have maps for + state counts
webnav dev node-clear / node-rm --node <id>  empty a site's map (re-learn) / delete it entirely
webnav dev node-add / edge-add / capture     teach + inspect helpers
```
`webnav <verb> --help` for details. Output is JSON on stdout; exit 0 ok / 2 error / 3 empty.

### MCP server

`webnav mcp` serves every verb as an MCP tool over stdio — point an MCP client at it and
agents get the verbs natively (no shelling out). Tools are generated from the same command
registry as `--help`, and every call runs the real CLI, so the two surfaces can't drift:

```json
{ "mcpServers": { "webnav": { "command": "webnav", "args": ["mcp"] } } }
```

Consumer verbs can also be invoked canonically as `webnav use <verb> ...` and map-authoring verbs as `webnav dev <verb> ...`; bare consumer verbs (e.g. `webnav read ...`) still work too.

### Inspect a site's map
The map is for the calling AGENT (walk), not a human dashboard. To inspect
what's captured, use the text views — no UI:
```bash
webnav dev outline www.saucedemo.com    # top-to-bottom states + affordances + completeness cues
webnav dev mermaid www.saucedemo.com     # paste into GitHub/mermaid.live to render
webnav dev graph-show --node <id>        # raw JSON
```

## Architecture (one CLI, three components, ZERO LLM)

- **Explorer** — reads a site's declared structure (observe-first), folds a recording into a
  self-verified map draft (states, typed affordances, the declared domain shadow), recognizes states.
- **MapStore** — SQLite persistence: states (+ affordances + declared shadow), projected edges, the
  site-node index, and record sessions.
- **Router** — walks a route, replays it (cached selector → deterministic fingerprint re-resolve),
  self-heals, returns evidence OR a `needs-navigation`/`needs-classification` "your move" response for
  the agent. Never judges, never calls an LLM.

## Source map (`src/`)

```
cli.ts, cli-spec.ts, cli-help.ts     CLI: parsing, command registry, help rendering
protocol.ts, contract.ts             walk response types · published @dikshanty94/webnav types
paths.ts, creds.ts, hosted.ts        ~/.webnav paths · local credential store · remote-map client
mcp/       server.ts                 `webnav mcp`: every verb as an MCP tool (generated from cli-spec)
mapstore/  types.ts, store.ts, record.ts, schema.sql   SQLite persistence (states+affordances+shadow, edges, nodes, node_edges, record sessions)
playwright/ adapter.ts, snapshot.ts, capture.ts, fingerprint.ts, sessions.ts, throttle.ts   playwright-cli child-process · a11y snapshot parser · element fingerprints · session guardrails
explorer/  analyse.ts, diff.ts, draft.ts, shadow.ts, fingerprint.ts, fingerprint-page.ts   analyse a recording → self-verified draft (affordances + declared domain shadow) + state recognition
router/    resolve.ts, replay.ts, path.ts, walk.ts, walk-live.ts, walk-session.ts   deterministic resolve/replay + interactive multi-step walk + pathfinding
           readiness.ts, extract.ts, extract-content.ts, tokens.ts, browse.ts, read.ts   bot-wall detection · signal/content extraction · token-savings · page reading
           search.ts, search-providers.ts, search-live.ts                 multi-provider open-web search
           catalog.ts                                                     dev list (the map index)
graph/     seed.ts, teach.ts, edit.ts, show.ts, coverage.ts               map authoring + inspection (saucedemo seed, graph-edit, graph-show, outline/mermaid)
dashboard/ server.ts, shell.ts                                            `webnav dev dashboard` local operator UI
```
Tests mirror this under `tests/`. The live e2e walk tests are gated behind `WEBNAV_LIVE=1`.

## Principles (full list in CLAUDE.md)

1. Observe first, traverse rarely. 2. Never traverse a declared commit point. 3. Store durable
semantic routes; cache selectors. 4. Usage-learned weights are a hosted-service concern. 5. The map
surfaces evidence; the **agent** judges. **5a. ZERO LLM in webnav** — all reasoning offloaded to
the calling agent via a call-and-response protocol. 6. The map is a use-case-independent
navigation skeleton; goals declare signal interests. **Never evade bot-walls** — detect + escalate.

## Status

All current work is merged to `main`, tests green. See **`docs/STATUS.md`** for the live
checklist, pending work, and known limitations; **`CLAUDE.md`** holds the settled design,
mental model, and principles. Design docs: `docs/superpowers/specs/`.

## Contributing

PRs welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md) (the settled principles, dev setup, and how
to contribute a **site map** — the highest-leverage contribution). Report security issues privately
per [`SECURITY.md`](SECURITY.md). Be excellent to each other: [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## License

[Apache License 2.0](LICENSE). Free to use, modify, and redistribute (including commercially)
**with attribution**: retain the copyright notice and the [`NOTICE`](NOTICE) file. Includes an
explicit patent grant. Copyright 2026 Dikshant Yadav.
