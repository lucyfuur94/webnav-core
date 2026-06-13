# graph-analyse proposes a DRAFT graph (smooth, webnav-native learning)

**Date:** 2026-06-13 · **Status:** spec for review (not yet built) · **Trigger:** mapping
OrangeHRM thrashed — capture a page → hand-guess a state's fingerprint + URL → walk fails
→ re-capture → patch. Worse, the patches were done with raw `sqlite3 UPDATE` (NOT webnav),
and the hand-authored URLs came out RELATIVE (broke the walk). The learning was neither
entirely-through-webnav nor smooth.

## Principle (settled with user, 2026-06-13)

- **Learning a site happens ENTIRELY through webnav** — both exploration AND authoring. No
  hand-editing the DB; if the map is wrong, the recording/authoring FLOW produces the fix.
- **The learning flow must be SMOOTH** — drive the site once, accept the captured map. No
  per-state hand-thrash. Time taken doesn't matter; the back-and-forth does.
- The agent still VALIDATES/NAMES (zero-LLM in webnav, #5a) — but it should validate a
  correct DRAFT, not author from scratch.

## The gap (why it thrashed)

The recording buffer ALREADY captures, per action-effect (verified): `fromUrl`, **`toUrl`
(absolute)**, **`toSnapshot`** (the full landing page), `action.elementFp` (Phase 4's
recovered role+name+near), `navigated`, diff. Everything a state/edge needs is there.

But `graph-analyse` is "structure-neutral" — it returns raw observations and makes the AGENT
invent state labels, fingerprints, and urlPatterns by hand. That hand-step is the thrash:
- fingerprints guessed from eyeballing → wrong → walk escalates → re-capture.
- urlPatterns hand-typed → came out RELATIVE → walk opened a hostless path → blank shell.

Neither failure can happen if the draft is computed FROM the capture.

## Design: `graph-analyse --draft` emits a ready-to-edit graph spec

Add a draft mode to `graph-analyse` (or a new `dev graph-draft <session>`): mechanically
fold the recorded action-effects into the `graph-edit` JSON shape, so the agent's job is
"review + rename, then pipe straight to graph-edit" — not author from nothing.

For each DISTINCT landing page in the recording:
- **state keying = `(toUrl + landing fingerprint)`, NOT toUrl alone (review fix — SPA tabs).**
  OrangeHRM PIM's Employee-List / Add-Employee / Reports are all `/url:"#"` (no path change);
  keying on `toUrl` alone collapses them and drops their edges. When two effects share a
  `toUrl` but their `toSnapshot` differs materially, emit two states with disambiguated slugs.
  `urlPattern` = the absolute `toUrl` (the relative-path bug can't recur — it's whatever the
  browser actually navigated to). Slug collisions get a numeric suffix (editGraph keys states
  by label and silently overwrites on collision).
- **`fingerprint` = the MINIMAL UNIQUENESS-DRIVEN token set, NOT a heading slice (BLOCKING
  fix A — the heading-only rule is falsified by the real map: `login` has ZERO headings;
  `dashboard`'s discriminators are links; `maintenance` needs a textbox).** Compute greedily
  over `{heading|button|textbox|link}:name` tokens from this page's `toSnapshot`: start with
  the most distinctive token, add the next until `matchState` resolves THIS state UNIQUELY
  against all other drafted states. Optimizes the exact metric the walk checks
  (`matchState` requires every token present + exactly one hit). Deterministic, zero-LLM. Do
  NOT reuse `fingerprintPage` (roles-only, no names — too coarse for matchState).
- **edges — handle BOTH capture shapes (BLOCKING fix B):**
  - `use click`/`use type` actions carry `action.elementFp` → navigate affordance with it verbatim.
  - `use navigate` records `action: null` (the OrangeHRM case — modules reached by URL!) → there's
    NO captured element. Reconstruct: scan the FROM page's `toSnapshot` for a declared link whose
    `/url` matches the next effect's `toUrl`, and synthesize a navigate affordance with
    `elementFp {role:'link', name:<that link's name>}`. `declaredLinks(nodes)` already emits
    `{to:url, via:name}` per link; `resolveByFingerprint` handles unique role+name. Without this,
    the draft yields edgeless states the walk can't leave.
- **Emit the elementFp as a `navigate` AFFORDANCE, not a bare `edges[]` row (fix C):** `editGraph`
  drops `elementFp` from a plain edge row (`findNavTarget` only folds metadata onto an existing
  navigate affordance). The draft puts `{kind:'navigate', to, elementFp}` on the from-state's
  affordances; `edges[]` carries only `needs`/`core`.
- **Login input affordances + `acceptsInput` — WIRE in v1, do NOT defer (review: else every authed
  site PAUSES at login forever).** A `use type` on a textbox → an `input` affordance; the navigate
  that followed → `needs:[those] + acceptsInput:'credentials'`. (Honest limit: `walk-live`'s live
  fill vocabulary is hard-coded to `'credentials'`/`'shipping'` with literal `Username`/`Password`/…
  field names — a learned site whose fields differ still needs slot-resolution generalizing; that's
  a follow-up. The draft captures the STRUCTURE regardless.)

### Self-verify pass (turns "accept then discover failures at walk-time" into "accept a proven draft")
Before output, the draft runs its OWN consistency check (the same checks the walk will):
- each drafted state's `toSnapshot` → `matchState` against the full drafted set must return a
  unique `matched`; else tag the state `_warning: non-unique fingerprint`.
- each edge's `elementFp` → `replayStep`/`resolveByFingerprint` against its FROM snapshot must
  return `ok`; else tag `_warning: edge won't resolve`.
The agent sees flagged states up front (curate them) instead of hitting them mid-walk.

Output: the `{node, states, edges}` JSON `graph-edit` accepts, on stdout (uniform JSON), plus a
**receipt**: the resulting start/goal state ids + a ready-to-run `walk` example (discoverability —
the user can't walk without the internal ids). The agent reviews/renames/curates, pipes to
`graph-edit`. The agent NEVER hand-writes a fingerprint or URL again.

## The smooth flow (what learning becomes)

The raw flow (what `--draft` enables):
```
dev record-start --session map         # begin
use navigate <site> --session map      # drive the site THROUGH webnav (agent clicks into
use snapshot / click / type …          #   each section + back; click/type capture elementFp)
dev record-stop --session map
dev graph-analyse --session map --draft  # → a complete, SELF-VERIFIED {node,states,edges} draft
dev graph-edit --node <id> --graph <draft, lightly curated>   # accept
```
The headline, built on top (the "easy for anyone"): **`dev map <url> --session S`** — ONE
orchestration verb that chains record-start → (agent drives) → record-stop → analyse --draft →
graph-edit → self-verify, auto-threading the same session, surfacing the draft + any flagged
states for the agent to accept. NOT autonomous (zero-LLM #5a: webnav can't decide what to click;
the agent still drives + curates), but it removes all the glue. No sqlite, no per-state guessing.

**Distribution (the other half of "easy for anyone"):** for COMMON sites nobody should re-learn —
`dev export-map` already emits a shareable pack (`orangehrm-mappack.json` is one); `walk --hosted`
+ walk-live already seed from packs. Most users IMPORT a pack; only the first mapper LEARNS.
Document this in `--help` as the primary path; `dev map` is for YOUR own/internal sites.

## Build order (per review)
1. `draftFromEffects(effects) -> {node,states,edges}` pure fn WITH fixes A–D + login-input wiring.
2. Self-verify pass folded in (matchState + replayStep over the draft's own snapshots).
3. Wire `--draft` into `graph-analyse` (emit the shape + the walk-example receipt).
4. `dev map <url> --session S` orchestration verb (thin glue; not autonomous).
5. RE-AUTHOR OrangeHRM through `dev map` as the verb's acceptance/dogfood test — deletes the
   sqlite-patched provenance. (Do NOT block the draft on this; the fixture stays a test oracle.)
6. Document `export-map` packs as the primary distribution path in `--help`.

## OrangeHRM right now (settled)
The current OrangeHRM node was hand-patched via raw `sqlite3 UPDATE` — NOT webnav-built — which
violates "learning happens ENTIRELY through webnav." Do NOT hand-fix it further. Keep
`tests/fixtures/orangehrm-mappack.json` FROZEN as a test oracle (it's the ground truth that
falsifies the heading-only rule — every drafted fingerprint must resolve uniquely via matchState
just as the pack's tokens do). Re-author live through `dev map` once step 4 lands.

## Honest scope / limits
- The draft is a STARTING POINT — the agent still curates (drop noise pages, merge dupes, name).
  Legitimate #5a judgment, not thrash.
- `near` quality is only as good as Phase-4 deriveNear (already proven).
- Login slot-resolution beyond literal `Username`/`Password` (walk-live's hard-coded fill) is a
  follow-up; the draft captures input STRUCTURE regardless.
- No clustering / no auto-structure — proposes the obvious page→state mapping; agent reshapes.

## Testing (must exercise walk-time checks, not "edge present" — review fix D)
- pure `draftFromEffects(effects)` over fixtures built from REAL captures (saucedemo-inventory +
  orangehrm-pim-table shapes): asserts absolute urlPatterns; **each drafted state's `toSnapshot`
  → `matchState` against the full set returns a UNIQUE match** (the uniqueness fingerprint works);
  **each edge's `elementFp` → `replayStep` against its FROM snapshot returns `ok`** (the edge
  resolves); `use navigate` (action=null) edges get a link-scan `{role:link,name}` affordance;
  login `use type`s become input affordances + the navigate gets acceptsInput=credentials.
- SPA same-url: two effects, same toUrl, different toSnapshot → two states (not collapsed).
- round-trip: draft → `graph-edit` → `edgesFrom(state)` returns an edge whose `viaAffordance`
  points at an affordance CARRYING the `elementFp` (proves the key survived projection — fix C).

## Out of scope
- Auto-naming states beyond a URL-slug (agent renames).
- Auto-detecting in-page mutate affordances (add-to-cart) — those stay agent-authored
  (they're judgment: is this a gate?).
