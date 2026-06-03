# webnav CLI framing (playwright-style) + browser primitives — design

**Date:** 2026-06-03 · **Status:** approved (brainstorm), pending spec review

## Why

webnav shells out to `playwright-cli`, which is notably legible to an agent: its
`--help` groups commands by category (Core / Navigation / Keyboard / …) and each
per-command help teaches the **data-flow** — e.g. `click <ref>` documents `<ref>`
as *"exact target element reference from the page snapshot"*, which silently tells
the agent the workflow (snapshot → get ref → click ref). webnav's own `--help` is
flat and does not teach how its verbs chain. Result: agents don't naturally see
that, e.g., `recall` needs a goal-id from `list-goals`, or that `read` takes a URL
`locate` can give.

This work makes webnav **framed the way playwright-cli frames itself** (grouped +
data-flow-teaching help) FIRST, then adds the high-value browser primitives we're
currently not exposing — each with the same quality of description. Principle:
**no point adding a primitive if it isn't added properly for the agent** — a verb
the agent can't figure out how to use is worse than no verb.

## Decisions (settled in brainstorm)

- **Phase 1 (reframe) lands first; Phase 2 (new primitives) builds on it.** One
  spec, sequenced.
- **Group `--help` by purpose:** `Find` / `Read` / `Navigate` / `Inspect(dev)`.
  - Find (where is it): `locate`, `route`, `list-goals`
  - Read (get content/evidence): `read`, `recall`, `search`
  - Navigate (drive a page) — Phase 2: `eval`, `network`, `go-back`, `reload`
  - Inspect/teach: under `webnav dev` (already done).
  (`hop` sits in Find or Navigate — place under Navigate since it moves the
  current page.)
- **Per-verb help teaches data-flow** (playwright's `<ref>=from snapshot` move):
  each arg/summary names where its input COMES FROM and where output GOES. E.g.
  `recall <goal-id>` → "goal id from `list-goals`"; `read <url>` → "a URL, e.g.
  from `locate`"; `hop <url>` → "url of the page you're currently on".
- **Phase 2 primitives:** `eval <url> <js>` (run JS → just the value),
  `network <url>` (read the JSON/API calls the page makes), `go-back` / `reload`
  (step within the current `-s=` session). Each with playwright-style help.
- **Reframe is presentation-only** — zero behavior change; existing tests stay
  green.
- **Invariants:** zero-LLM (eval runs the AGENT's JS in the page; webnav just
  passes it through — webnav itself reasons about nothing), escalate-not-evade (a
  page that won't load → honest failure, never bypass a wall).

## Phase 1 — Reframe the CLI

### CommandSpec gains a `group` field
`src/cli-spec.ts`: add `group: 'find' | 'read' | 'navigate' | 'dev'` to
`CommandSpec`. Tag each consumer command. (Dev commands already partitioned into
`DEV_COMMANDS`; they render under `webnav dev --help` unchanged.)

### Grouped top-level help
`src/cli-help.ts` `topLevelHelp()` renders consumer commands UNDER group headers
in a fixed order (Find, Read, Navigate), each header with a one-line gloss:
```
Find:      (where is it)
  locate <place>              URL coordinate of a known place (no navigation)
  route <request>             which site(s) serve a request + signals
  list-goals                  recall goal-ids you can use

Read:      (get content / evidence)
  read <url>                  open a URL → distilled content
  recall <goal-id> <query>    replay a goal's route → evidence bundle (agent ranks)
  search <query>              open-web search → extracted evidence

Navigate:  (drive a page)
  hop <url> --to-...          move from the current page to a related site
  eval <url> <js>             run JS on a page → just the value you need   [Phase 2]
  network <url>               read the JSON/API calls the page makes        [Phase 2]
  go-back | reload            step within the current browser session       [Phase 2]
```
Followed by the existing `webnav dev --help` pointer + global flags.

### Data-flow in arg descriptions
Enrich the `ArgSpec.description` of each consumer verb to name the source/sink:
- `recall` arg `goal`: `'Goal id from `list-goals` (defaults to github-repos).'`
- `recall` arg `query`: `'Search term fed into the goal\'s entry.'`
- `read` arg `url`: `'A URL to open — e.g. one from `locate`.'`
- `locate` arg `place`: `'A known place name (see `list`).'`
- `hop` arg `url`: `'The page URL you are currently on.'`
- `route` arg `request`: `'What you want to do; returns candidate sites to act on.'`
Per-verb `commandHelp(name)` already renders args; no renderer change needed
beyond the enriched strings.

### Phase 1 testing
- `topLevelHelp()` contains the group headers (`Find:`, `Read:`, `Navigate:`) and
  lists each consumer verb under the right header (assert ordering: a verb's line
  appears after its header and before the next header).
- Arg descriptions: `commandHelp('recall')` mentions `list-goals`;
  `commandHelp('read')` mentions `locate`.
- No behavior change: full existing suite stays green.

## Phase 2 — Browser primitives (Navigate group)

Each is a thin wrapper over playwright-cli via the existing adapter, with a
playwright-style per-verb help block (signature + one-line desc + args/flags). All
open their own `-s=` session and close it.

### `eval <url> <js>`
Open `url`, run `js` (a `() => <value>` expression) in the page, return the value
as JSON. The cheap-extraction primitive: grab the one number/string instead of
the 53k-token snapshot. Adapter already wraps playwright-cli `eval`.
- Result: `{ status:'done', url, value }` | `{ status:'failed', url, reason }`.
- Help arg `js`: `'A () => <value> JS expression evaluated in the page (returns the value).'`

### `network <url>`
Open `url`, return the network requests the page issued (method, url, and JSON
response bodies where available) — often the real structured data behind the DOM.
Wraps playwright-cli `network`.
- Result: `{ status:'done', url, requests:[{method,url,...}] }`.
- Help: note this surfaces the API calls the page makes — frequently cleaner than
  scraping rendered HTML.

### `go-back` / `reload`
Operate on the current `-s=<session>` browser: step back / reload. For multi-step
nav within a session the agent is driving. Thin wrappers over playwright-cli
`go-back` / `reload`.
- Result: `{ status:'done' }` (or failed).

### Phase 2 testing
- Unit (injected runner, no real browser): `eval` returns the value the (fake)
  page eval produced; `network` parses the (fake) network output into the result
  shape; both map a fetch error to `failed`. Mirror how `read`/adapter tests
  inject a fake run function.
- Per-verb help: `commandHelp('eval')` shows the `<url> <js>` signature + the
  `() => <value>` arg framing; `commandHelp('network')` explains the API-calls
  framing.
- CLI surface: the new verbs appear under `Navigate:` in `topLevelHelp()`.
- Gated live e2e: `eval https://github.com/psf/requests "() => document.title"`
  returns a title; `network` on a JSON-backed page returns at least one request.
  (Gated by `WEBNAV_LIVE`, like the other e2e.)

## Out of scope (designed-for, not built)
- Storage/auth verbs (`state-save/load`, cookies) — the door to logged-in sites;
  a later increment.
- screenshot/pdf — webnav is text/evidence-oriented; skip unless a need appears.
- tabs / mouse / keyboard low-level verbs — internal to the walk; not consumer
  surface.

## Success criteria
1. `webnav --help` groups consumer verbs under Find/Read/Navigate headers and
   each verb's help teaches where its inputs come from / outputs go (playwright
   style) — verifiable by reading `webnav --help` + `webnav <verb> --help`.
2. `eval`, `network`, `go-back`, `reload` exist as Navigate verbs, each with a
   proper per-verb help block, and work (gated live).
3. `eval <url> "() => …"` returns a targeted value WITHOUT ingesting the full
   page snapshot (the cheap-extraction path that addresses the big-snapshot cost).
4. Zero-LLM + escalate-not-evade preserved; Phase 1 changes no behavior (suite
   stays green).
