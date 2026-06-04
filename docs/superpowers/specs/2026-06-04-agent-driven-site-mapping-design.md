# Agent-Driven Site Mapping — Design

**Date:** 2026-06-04 · **Status:** approved (brainstorm complete) · **Increment:** site-mapping (record → analyse → edit-graph)

## Problem

webnav can *use* a site's navigation skeleton (`recall`/`route`/`hop`/`walk`), but it has **no way to BUILD one by exploring an unknown site**. Today the two known skeletons (GitHub, saucedemo) are hand-authored TypeScript (`github-skeleton.ts`, `saucedemo-skeleton.ts`) and written by `seedGraph`. To map any new site, a human writes code. We want an **agent** to explore a website, understand its broad structure, and have a clean navigation graph built and persisted from what it observed — the "Google Maps was built from observed data" thesis (principle #1), applied to map-building itself.

The hard constraint: **webnav contains ZERO LLM (#5a).** All *judgment* — what a page-type means, what to name it, whether two pages are "the same place," which forks need a human — belongs to the **calling agent**. webnav supplies mechanics and structure, never opinion.

## The shape (settled in brainstorm)

The exploration loop lives in the **agent**, not in a CLI verb. There is no autonomous `explore` verb (it would either need an LLM inside webnav, or be a dumb crawler that emits noise). Instead webnav provides a **record → analyse → edit** substrate, and the agent drives:

```
dev record-start                       # begin capturing; returns a session id
use navigate / click / type / snapshot / read / …   # agent explores; each page is buffered
dev record-stop <session>
dev graph-analyse <session>            # mechanical: buffer -> proposed structure (per site), NO prose
   ↓  agent reads the structure, applies judgment (name clusters, merge/split, mark forks)
dev graph-edit --node <url> --graph <json>   # upsert the agent's VALIDATED graph (creates node if new)
dev graph-show --node <url>            # inspect the current skeleton to validate against
```

- The agent does all judgment: **before** analyse (where to navigate, what to play with) and **after** analyse (validate, name, correct).
- webnav does only the mechanical work: capture observations, dedup pages into state-TYPES by structural fingerprint, derive edges from declared links, persist what the agent commits.

### Two CLI categories (settled)

- **`use`** — runtime: browser-driving primitives + map-query verbs. ("Use webnav.")
- **`dev`** — authoring the map: the record/analyse/edit flow + inspect/teach verbs.

The mapping flow interlocks across both: `dev record-start` flips on capture → agent drives via `use` primitives (buffered) → `dev graph-analyse`/`graph-edit` author the map. Existing consumer verbs (`recall`, `search`, …) move under `use`. Verbs are **entity-first** (`record-start`, `node-add`), and existing `dev` verbs are renamed to match.

## Principles this honors

- **#1 Observe-first:** mapping is built from *reading what pages declare* (snapshot, hrefs, form targets) — the agent navigates, webnav reads structure. No driving-every-road.
- **#2 Never traverse a commit point / #5a escalate-don't-decide:** the agent decides where to go; forks that truly need a human (login, pay, destructive confirm) are recorded as **fork edges** (`needsInput: true` + `why`) and NOT auto-traversed. Ordinary navigation the agent can do (search, follow a link) is a normal traversable edge, not a fork.
- **#5/#5a webnav is judgment-free, zero-LLM:** `graph-analyse` returns **data, not prose** — clusters, fingerprints, url-patterns, counts, declared edges. It never says "these look similar" or "this is the repo-detail page" (that would be webnav judging its own output). The agent reads the raw structure and judges for itself.
- **#6 skeleton = structure only:** one node per page-TYPE/template (deduped by fingerprint), never one per instance. All repos share a structure; we graph the structure.

## Components

### 1. Record buffer (new) — `MapStore`-backed

A scratch table `record_observations(session_id, seq, url, fingerprint, declared_links, declared_forms, captured_at)` plus `record_sessions(session_id, active, started_at, stopped_at)`. `dev record-start` opens a session row (active=1) and returns its id; `dev record-stop` sets active=0. While a session is active, every `use` browse primitive that loads/changes a page appends one observation row (url + the page's structural fingerprint + the links/forms it declared). The buffer is webnav-owned (option A from brainstorm) — the agent does no observation-bookkeeping; it just drives through `use` verbs.

**Contract:** webnav can only record what flows **through webnav**. During a record session the agent MUST drive the site via `use` primitives, not raw playwright MCP (webnav buffers its own adapter's page-loads only). One record-session = one browser session (`-s=<session>`).

### 2. `use` browser primitives (extend) — recordable navigation wrapper

Today: `read`, `eval`, `network`, `snapshot` (internal), `go-back`/`reload`. Add the **navigation subset of playwright-cli** as first-class recordable `use` verbs, in webnav's token-efficient framing (clean output, ref-from-snapshot data-flow help):
- **`use navigate <url>`** — goto.
- **`use click <ref>`** — click an element (ref from a prior snapshot).
- **`use type <ref> <text>`** — fill/type into a field.
- **`use snapshot`** — the page's accessibility snapshot (the agent's read of the page).
- **`use wait-for <condition>`** — wait for readiness (reuses `classifyReadiness`).
- existing `read`/`eval`/`network`/`go-back`/`reload` stay, now categorized under `use`.

Each, when run inside an active record session, appends an observation. The remaining playwright verbs (hover, select, press-key, screenshot, tabs, drag) are **out of scope for v1** (noted as fast-follow) — v1 needs the navigation subset to map structure.

### 3. `dev graph-analyse <session>` (new) — deterministic, zero-LLM, no prose

Reads the session's observation buffer and emits a **proposed structure, grouped per site (domain)**:

```jsonc
{
  "sites": [
    { "node": "github.com",
      "states": [ { "label": "state-type-1", "fingerprint": [...], "urlPatterns": ["github.com/*/*"],
                    "pageCount": 12, "sampleUrls": [ "…" ] }, … ],
      "edges":  [ { "from": "state-type-1", "to": "state-type-3", "via": "declared link \"Issues\"" }, … ] },
    { "node": "pypi.org", "states": [ … ], "edges": [ … ] }
  ],
  "crossSiteEdges": [ { "from": "github.com", "to": "pypi.org", "via": "declared link …" } ]
}
```

- **Grouped by domain** — a session may roam across sites; each site gets its own interior graph.
- **Cross-site links** the agent traversed become **internet-graph node-edges** (the `route`/`hop` layer) — one record session can populate both a site interior AND the inter-site graph.
- **States = pages deduped into TYPES by structural fingerprint** (same set of roles/landmarks + same url-pattern shape → one state-type). Labels are **machine labels** (`state-type-1`), never semantic names.
- **Edges = declared links/forms** between those state-types.
- **Mechanical metadata only** (counts, fingerprints, url-patterns, sample urls, which links were declared). **No prose, no opinion** — never "similar", "consider", "this is X". The agent sees the raw structure and judges.
- Reuses existing `deriveEdges` (`src/explorer/explorer.ts`) and `fingerprint.ts`. No browser, no network, no LLM → fully unit-testable.

**Acknowledged + intended crudeness:** fingerprint-only clustering will sometimes over-merge (two different pages, same landmarks) or over-split (logged-in vs logged-out variant). That is fine: analyse produces a *first-draft* structure; the agent's validation + `graph-edit` is the corrector. Making analyse "smart" would sneak judgment into webnav — explicitly rejected.

### 4. `dev graph-edit --node <url> --graph <json>` (new) — the agent's write API

Upserts the agent's **validated, named** graph into the site's interior. Single data-driven verb (no flag-zoo): the agent expresses add / merge / rename / insert-between / classify-fork by **how it shapes the JSON**, because position/relationships live in the **edges** (a state alone is a floating place):

```jsonc
{
  "states": [ { "label": "repo-detail", "urlPattern": "github.com/*/*", "fingerprint": [...] } ],
  "edges":  [ { "from": "result-list", "to": "repo-detail", "via": "follow a result link" },
              { "from": "repo-detail", "to": "login", "via": "click Sign in",
                "needsInput": true, "why": "requires credentials" } ]
}
```

- **Upsert semantics:** referencing an existing state by label links to it; a new label creates it. Covers "add after this node", "insert between", "branch a fork" — all expressed as edges.
- **`--node <url>` required** — the site-node is the scope. If the node doesn't exist (brand-new site), `graph-edit` **creates it** → folds in the "auto-learn a new node" win.
- **Fork edges** carry `needsInput: true` + `why` (login/pay/destructive/CAPTCHA/account-specific). These are recorded, never auto-traversed (#2/#5a).
- No separate `graph-commit` — analyse doesn't persist; the agent validates then writes the corrected graph via `graph-edit`. One write verb. Idempotent.

### 5. `dev graph-show --node <url>` (new) — read current skeleton

Returns the persisted interior (states + edges) for a node so the agent can validate its analysis against what's stored and confirm its edits landed. Thin read over MapStore (the live-graph viewer's `/api/node/:id/interior` already does this server-side; this is the CLI equivalent).

## Data flow (end to end)

1. `dev record-start` → `{ session }`, capture on.
2. Agent (Haiku) explores: `use navigate`, `use snapshot`, `use click`, `use read`, … — each page buffered (url + fingerprint + declared links/forms).
3. `dev record-stop <session>` → capture off.
4. `dev graph-analyse <session>` → per-site proposed structure + cross-site edges (data only).
5. Agent validates + names clusters, decides merges/splits, marks true forks.
6. `dev graph-edit --node <url> --graph <validated>` → upsert (per site). Cross-site edges → node-edges.
7. `dev graph-show --node <url>` → confirm; loop back to 5 if corrections needed.

## Error handling

- **record-start with an already-active session for the same browser session** → error (one record-session per browser session).
- **graph-analyse on an empty/unknown session** → exit 3 (ran-fine-but-empty) with a hint.
- **use browse primitive with no active record session** → works normally, just records nothing (recording is opt-in via record-start; not an error).
- **graph-edit referencing an edge endpoint label that doesn't exist and isn't in the payload** → error (can't link to a non-existent state) with the offending label named.
- **bot-wall / interstitial during exploration** → the `use` primitive detects + escalates (reuses `classifyReadiness`), never evades (#hard-line). The agent sees the block and stops; the page is still recorded as "blocked".

## Testing strategy

- **Unit (no browser/LLM):** `graph-analyse` is the core — feed synthetic observation buffers (hand-written url+fingerprint+links rows) and assert the per-site clustering, edge derivation, cross-site edges, machine labels, mechanical metadata, and that output contains **no prose fields**. Fingerprint dedup edge cases (over-merge/over-split are *expected*, assert the deterministic behavior, not "smartness").
- **Unit:** record buffer (start/stop/append/group-by-domain), `graph-edit` upsert semantics (add/link/fork-edge/create-node-if-new/dangling-endpoint error), `graph-show` read.
- **Unit:** the new `use` primitives parse playwright-cli output cleanly (mock the adapter `run`), and append exactly one observation per page-load when a session is active.
- **Gated live e2e (`WEBNAV_LIVE=1`):** a Haiku subagent records a short GitHub exploration via `use` verbs, `graph-analyse` returns a sane multi-state structure, the agent edits a named graph, `graph-show` confirms it. (Haiku per the subagent-model rule.)
- **Migration safety:** moving consumer verbs under `use` — update bench harness, e2e, docs, per-verb help; full suite stays green.

## Out of scope (v1)

- Autonomous `explore` verb (rejected — judgment belongs to the agent).
- The non-navigation playwright verbs (hover/select/press-key/screenshot/tabs/drag) — fast-follow.
- Making `graph-analyse` "smart" (semantic clustering) — explicitly rejected (#5a).
- Auto-detecting *when* to re-map a changed site (self-heal-on-use already covers drift on known routes).

## Migration / breaking changes

- Consumer verbs (`recall`, `search`, `locate`, `route`, `hop`, `list-goals`) move under **`use`** — breaking for the bench harness, e2e tests, and docs that call them bare. Mechanical: update call sites + per-verb help + tests.
- Existing `dev` verbs renamed **entity-first**: `add-node` → `node-add`, `add-edge` → `edge-add` (others already noun-led or fine).
