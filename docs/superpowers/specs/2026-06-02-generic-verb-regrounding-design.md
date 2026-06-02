# webnav generic verb re-grounding — design

**Date:** 2026-06-02 · **Status:** approved (brainstorm), pending spec review

## Why

R1.1 benchmarking exposed that webnav fumbles a trivial task ("how many open
issues does psf/requests have"): the agent thrashed `locate → recall → search →
capture` because **the verbs are website-specific and the basic "open a URL and
read it" primitive is missing**. Root causes found in the code:

- `recall` is hardcoded GitHub-repo-discovery (search URL + goal + extractor all
  literal in `live.ts`) wearing a generic-sounding name. It returned `failed` on
  a non-discovery query.
- `locate`'s gazetteer is a hardcoded GitHub table.
- There is **no verb to open an arbitrary URL and return its (distilled)
  content** — `capture` does it but is a dev/test-fixture helper that writes to a
  file.
- `--help` floods 12 flat verbs (8 are admin/dev/introspection), steering the
  agent down wrong paths.

The fix (backed by web-agent research — Agent-E arxiv 2407.13032, AgentOccam
2410.13825: **generic primitives + per-site knowledge as DATA + payload
distillation**): re-ground webnav's public surface on **generic verbs that
operate over map DATA**. A verb never names a website; adding a site = adding
data, not code.

## Decisions (settled in brainstorm)

- **Consumer verbs:** `locate`, `read`, `recall`, `search`, plus `list-goals`.
- **Admin/dev verbs moved to a `webnav dev <verb>` namespace** (out of the
  consumer `--help`): `graph`, `add-node`, `add-edge`, `list`, `describe`,
  `capture`. Still available; just not flooding the consumer surface.
- **`recall` becomes generic + DATA-driven.** `recall <goal-id> "<query>"`:
  deterministic lookup of a stored Goal record → replay that goal's **site-bound**
  route → run the goal's named extractor → return an evidence bundle. NO GitHub
  literals in the verb.
- **Goal selection is EXPLICIT (zero-LLM).** The agent passes the exact goal id;
  webnav does a deterministic id lookup (no NL interpretation — the agent holds
  the brain, #5a). The `query` is natural only in the sense that it's the search
  term fed into the goal's entry template.
- **Goals are SITE-BOUND.** A goal names its site + route. The agent (with its
  LLM) picks which goal fits its need. Site-independent intent→site routing stays
  the separate `route` verb's job; it is NOT entangled with `recall`.
- **Goal discovery:** a `list-goals` consumer command (id + one-line description
  + signals it returns) AND the same list in `recall --help`.
- **`read <url> [--raw]`** — the missing primitive: open any URL → readiness-check
  → return DISTILLED content (reusing `extractContent`/`classifyReadiness`).
  `--raw` returns the full snapshot (folds in `capture`'s consumer use).
- **Build scope:** re-ground the surface + make `recall` data-driven + add `read`
  + dev namespace + help, with **GitHub-repos as the ONE seeded goal**, verified
  end-to-end. A second site is data-only to add later (no code change) — designed
  for, not built now.
- **Invariants preserved:** zero-LLM (extractors/readiness/replay are
  deterministic; the agent ranks); never evade walls (`read`/`recall` escalate
  honestly, never bypass).

## Consumer verbs (the only ones in the main `--help`)

| Verb | Generic role | Site knowledge lives in |
|---|---|---|
| `locate <place>` | name → URL coordinate, no navigation | gazetteer DATA (per-site entries) |
| `read <url> [--raw]` | open any URL → distilled content (or full snapshot) | nothing site-specific |
| `recall <goal-id> "<query>"` | replay a goal's site-bound route → evidence bundle | the Goal record |
| `search "<query>"` | open-web search → distilled evidence | provider list (data) |
| `list-goals` | list known goal ids + descriptions + signals | the goals table |

`webnav dev <verb>`: `graph`, `add-node`, `add-edge`, `list`, `describe`, `capture`.

## The Goal record (the data that makes recall generic)

The existing `goals` table already has `name`, `visit`, `surface`,
`candidate_limit`. Extend it (and the `Goal` type) with the bindings recall needs:

- `site` — the node/skeleton this goal runs on (e.g. `github.com`).
- `entry` — entry URL / query template (e.g.
  `https://github.com/search?q={query}&type=repositories`); `{query}` filled at
  call time.
- `extractor` — a NAMED extractor (string key into a registry), not a hardcoded
  function.

Migration: idempotent `ALTER TABLE goals ADD COLUMN site/entry/extractor`,
backfilled for the one existing goal. (Same pattern as the states.node_id
migration that already exists.)

### Extractor registry
A goal record can't store a function, so it stores an extractor NAME. A small
registry maps name → deterministic parser:
```
const EXTRACTORS = { 'github-repo-signals': extractRepoSignals, … };
```
`recall` does `EXTRACTORS[goal.extractor]`. Adding a site = register one extractor
by name + seed its goal record. This is the single seam where a new site's
"how to read signals" plugs in. Still zero-LLM (extractors are parsers).

## Data flow

**`recall <goal-id> "<query>"`:**
```
recall("github-repos", "python retry")
  ├─ MapStore.getGoal("github-repos") → { site, entry, visit, surface, extractor, candidateLimit }
  │     (unknown id → {status:"failed", reason:"no such goal; see `webnav list-goals`"})
  ├─ resolve entry template with query → concrete start URL
  ├─ replay the goal's route on its site (existing recallViaMap + skeleton)
  ├─ per candidate: run EXTRACTORS[goal.extractor] (unknown name → {status:"failed", reason})
  └─ {status:"done", evidence:{ goal, query, candidates:[{id,url,signals}] }}
```

**`read <url> [--raw]`:**
```
read("https://github.com/psf/requests")
  ├─ adapter.open(url) → snapshot
  ├─ classifyReadiness(snapshot) → ready | loading | interstitial
  │     └─ not ready: brief retry; still blocked → {status:"blocked", reason} (NEVER evade)
  ├─ extractContent(snapshot) → distilled content
  └─ stdout {status:"done", url, content}   (--raw → full snapshot instead)
```

**`locate <place>`** — mechanism unchanged (deterministic gazetteer match); the
gazetteer is framed/documented as per-site DATA so a new site's entries slot in
without code changes.

## Error handling

- Unknown goal id → `{status:"failed", reason:"no such goal; run \`webnav list-goals\`"}`.
- Goal references an unknown extractor name → `{status:"failed", reason}` (caught
  explicitly, not a silent crash).
- `read` blocked/interstitial → `{status:"blocked"|"needs-navigation", …}` —
  detect + report, never bypass.
- `read` unreachable URL → `{status:"failed", reason}`.
- **Backward-compat:** `recall "<query>"` with no goal id defaults to the seeded
  `github-repos` goal, so existing callers/tests keep working; help notes the
  goal is now selectable.

## CLI / help changes

- Top-level `--help`: one-line identity ("webnav is a generic map of the
  agent-internet; here are the moves"), then the 5 consumer verbs with crisp
  one-liners, then "Run `webnav dev --help` for teach/inspect tools."
- `recall --help`: lists goal ids (from `list-goals`), stops saying "GitHub" in
  its summary — says "replay the known route for a goal."
- `webnav dev` subcommand router dispatches the admin verbs (their existing
  handlers move under it unchanged).

## Testing (TDD)

- **Goal record + migration:** new fields round-trip; idempotent ALTER; backfill
  of the one existing goal. (Mirror the states.node_id migration tests.)
- **Extractor registry:** name → function lookup; unknown name → explicit failure.
- **`recall` generic path:** with a seeded `github-repos` goal, `recall
  github-repos "<q>"` resolves entry, replays, extracts via the named extractor,
  returns the bundle — using the existing fake-browser test harness (no live
  net). Unknown goal id → failed. No-arg `recall "<q>"` → defaults to github-repos.
- **`read`:** given a fixture snapshot, returns distilled content; a
  loading/interstitial fixture → blocked (never evades); `--raw` → full snapshot.
  (Reuse existing readiness/extract fixtures.)
- **CLI surface:** consumer `--help` shows exactly the 5 consumer verbs and NOT
  the admin verbs; `webnav dev --help` shows the admin verbs; `list-goals` prints
  the seeded goal.
- **Live e2e (gated):** `recall github-repos "python retry"` still returns real
  GitHub evidence end-to-end (proves the re-grounding didn't break GitHub).
- Full build + suite green before merge.

## Out of scope (designed-for, not built)

- A second site's goal/skeleton/extractor (npm/PyPI) — adding one is data +
  one registered extractor, no `recall` change. Proves genericity later.
- Site-independent intent→site routing for recall (stays the `route` verb's job).
- Any LLM in webnav.

## Success criteria

1. Consumer `--help` shows 5 generic verbs; admin verbs live under `webnav dev`.
2. `recall <goal-id> "<query>"` is data-driven (no GitHub literals in the verb);
   GitHub-repos is one seeded goal; a 2nd site would be data-only.
3. `read <url>` exists and returns distilled content (the gap that broke gh-issues
   is closed) — an agent now has one obvious "go read this page" move.
4. GitHub recall still works end-to-end (gated live test).
