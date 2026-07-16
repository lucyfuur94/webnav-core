# Sensor gaps — landing name-probe (X6), hover/right-click probe (X2), structure audit (2026-07-16)

> Goal-1 first increment ("record everything in scope, miss nothing"), user-approved with the
> describe-and-wait gate satisfied in-session. Grounding: `2026-07-12-structure-coverage-matrix.md`
> (gaps X2/X6 open; X1/X3 shipped 07-12), roadmap items 1a/1b/1c. Capture-engine files remain
> gated by the standing rule; this spec IS the approved description.

## Problem

Three sensor blind spots keep recordings incomplete no matter how much we record:
1. **X6 — unnamed icon controls on landings.** `NAME_PROBE_JS` runs only on CLICKED elements;
   a landing of icon-only buttons stores a nameless snapshot, and every draft gate that requires
   an accessible name (draft.ts:1095/1115/1149/1309/1260) silently drops the repertoire — the
   0-affordance dashboard class.
2. **X2 — hover-/right-click-only affordances.** Hover mega-menus and context menus appear in no
   settled snapshot and declare no trigger; the map honestly omits a site's primary nav. Zero
   test coverage today (confirmed by exploration).
3. **Audit half.** The video review compares frames to steps; "video shows 6 widgets, snapshot
   has 6 nameless divs" passes silently — blind spots stay unmeasured per session.

## 1. Landing name-probe (X6)

- **Probe helper** (new `src/recorder/probe.ts`): `probeNames(adapter, nodes, cap=16)` — over the
  parsed landing snapshot's NAMELESS interactive nodes (role in button/link/menuitem/tab/checkbox/
  radio/switch + has ref), serialized ref-scoped `NAME_PROBE_JS` evals (no batch eval exists;
  refs are playwright-internal, so per-ref is the only honest keying), capped, each result
  filtered through `enrichName` (rejects error blobs). Returns `Record<ref, name>`; empty results omitted.
  Fires ONLY when nameless interactive nodes exist — zero cost on well-named pages.
- **Carry**: `ActionEffect.nameHints?: Record<string, string>` — new `name_hints TEXT` column on
  `record_observations` via the existing `migrate()` ALTER pattern (effect-level, because bare
  navigations have `action: null`). Round-trips through append/actionEffects.
- **Populate** (agent path v1): `recordNavigateEffect` and the agent-session `navigate` branch run
  the probe on the settled landing before appending. The HUMAN tick loop does NOT probe (each eval
  is a 300-500ms serialized child process — it would lag the overlay); human-path enrichment is
  deferred and noted honestly. One-shot `use navigate` gets it free via recordNavigateEffect.
- **Consume** (draft): ONE seam — where `draftFromEffects`'s `pushLanding` parses `toSnapshot`
  (draft.ts:554), patch parsed nodes: a nameless node whose ref has a hint gets `name = hint`.
  All five downstream name gates then see the observed name. Hints are OBSERVED evidence
  (tooltip/aria/title text read from the live DOM) — never invented, judgment-free (#5a intact).

## 2. Hover / right-click probe pass (X2)

- **Adapter**: `rightClick(ref)` = `click <ref> right` (playwright-cli's click already takes a
  button arg — no new primitive).
- **New dev verb** `webnav dev hover-probe --session <S> [--limit N] [--right-click]` — an OPT-IN,
  separate pass over the CURRENT page of an existing live session (attach by name, the
  `dev verify` plumbing shape; appends to the recording session like the agent-session loop):
  1. snapshot → candidates (pure function, structural + judgment-free): nodes with
     `aria-haspopup`, plus named interactive nodes inside banner/navigation landmarks, plus
     `menuitem`s — capped at `--limit` (default 12).
  2. per candidate: hover → bounded settle → snapshot → diff; a non-empty ADDED diff records an
     `ActionEffect` with `action: {…, hover: true}` (shape already flows end-to-end since the
     ledger work) + a ledger event. Politeness: intra-session, no throttle needed; move pointer
     to a neutral corner between candidates so reveals don't stack.
  3. `--right-click` mode: same loop with `rightClick`; records `action: {…, rightClick: true}`.
     REVEAL ONLY — the probe never clicks anything inside a revealed menu (commit rule untouched).
- **Draft**: hover/rightClick same-page effects with added subtrees are reveal evidence through
  the SAME branch as click reveals (the effect decides; implementer verifies the existing
  `hover:true` handling in draftFromEffects and extends the kind marker to rightClick).
- Uniform JSON stdout: `{status, session, probed, revealed}`; exit 3 when nothing revealed.

## 3. Structure audit (review half)

- Pure summarizer in `src/recorder/coverage.ts` (or sibling): per distinct landing page (dedupe
  toSnapshots by URL path), counts of interactive nodes named vs NAMELESS.
- `dev review` computes it, adds a `LANDING STRUCTURE` section to the prompt ("pages with many
  nameless controls are sensor gaps — compare against what the frames show"), includes
  `structure` in the output JSON + review.json.

## 4. Fixtures + guardrails

- Grammar tests (draft-level, synthetic effects — the existing tests/grammar pattern):
  - X6: landing with nameless icon buttons + nameHints → affordances EMITTED (positive);
    same landing WITHOUT hints → honest omission (keep the existing collections.test.ts case).
  - X2: synthetic hover effect with added flyout subtree → reveal affordance + children;
    rightClick effect → same; NO hover effect → flyout absent (honest omission).
- Candidates function + probeNames: unit tests with fake adapters.
- Matrix bookkeeping: update `2026-07-12-structure-coverage-matrix.md` verdicts for X2/X6 rows
  when shipped, and record the current status of X4/X5/X7/X8/X9 (audit vs main — several may
  have closed since 07-12).

## Out of scope (unchanged posture)

Human-tick-loop probing (latency); drag-and-drop (X13); cross-origin embeds (X14); canvas (X12);
800px video cap. Context-menu ITEM firing (reveal-only).

## Verification

Unit + grammar green; live headless E2E against a LOCAL fixture page (python http.server, scratch
`WEBNAV_DB` — never the real db): record a landing of icon-only buttons → draft emits named
affordances; run hover-probe on a hover-flyout fixture → draft shows the flyout repertoire.
