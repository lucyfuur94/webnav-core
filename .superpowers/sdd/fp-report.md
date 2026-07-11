# Fingerprint-exclusivity walk-blocking defect — diagnosis, fix, verification

Branch: `worktree-fp-exclusivity` (off `main` tip `986245c`). Site: progneo.analytics.mn.

## The symptom (from evidence.md)

A live walk `report-list → report-flat` escalated `needs-navigation` with
`observed ambiguous` on a fully-rendered report page, twice, deterministically.
Stored `report` fp = `{tab:Table, tab:Charts, button:New Report, button:View All,
button:Cancel}`; stored `report-flat` fp = `{tab:Table, tab:Charts, tab:Flat}`.

## Diagnosis (evidence-first — real data from `~/.webnav/webnav.db`)

### 1. Why draft-time exclusivity passed but the live walk failed — the skew token

The two states are two SPA renders of the SAME report **16116**, under different
opaque builder hashes:

| state | key | recorded landings | face |
|---|---|---|---|
| `report` | `/report/16116/c8c6c374…` | 1 nav landing, **mid-query** | 27 tok, `hasCancel=true, hasFlat=false`, `status "Running query…"` |
| `report-flat` | `/report/16116/13fe32057…` | 1 nav landing, **settled** | 182 tok, `hasFlat=true, hasCancel=false` |

The draft's fingerprint-exclusivity loop (`draft.ts`, the `for tok of cands` loop)
grows `report`'s fp until no OTHER good page's **landing face** contains the whole
prefix. In this corpus `report-flat` has ONE settled ready-landing, and it lacks
`button:Cancel` — so `report`'s 5-token prefix (ending in the transient `Cancel`)
read as "exclusive" and was stored.

At WALK time `matchState` runs the stored fp against the LIVE page. The live report
page is the FULL repertoire — it presents `New Report` + `View All` (persistent
report chrome, both listed in `report-flat`'s affordances) AND, while a query runs,
`Cancel`. **The skew token is `button:Cancel`: `report`'s ONLY token absent from
`report-flat`'s union face is `button:Cancel`** (measured: `report` union 27 tok,
`report-flat` union 182 tok; the one difference the exclusivity leaned on is a
transient loading-button). So `report`'s fp is a subset of the live report page's
tokens with **no durable discriminator**, and `matchState` returns
`{ambiguous:[report, report-flat]}` forever.

Additionally: **`_shell` carries an empty fingerprint `[]`.** `[].every()` is
vacuously true, so `_shell` matched EVERY page — the walk's `matchState` set
included it, so even after the two report states collapsed to one, the walk still
reported `ambiguous:[report, _shell]`. Second, independent root of the same symptom.

### 2. The deeper question — should `report` and `report-flat` be two states? NO → merge

They are ONE `/report/16116/{param}` instance; the split is an artifact of render-depth
skew defeating the dispose's control arm.

- The fixpoint proposal `/report/16116/{param}` merging both keys **exists**.
- On RAW faces the dispose control arm passes: control **containment 0.923 ≥ 0.9**,
  `sameControls = true` → MERGE.
- But the dispose compares `normFace`'d faces. `normFace` folds the settled grid's
  metric chips into ONE `widget:*` sig (settled → 0 chip controls) while the
  mid-query render's chips stay flat controls → their control faces DIVERGE:
  **control containment collapses 0.923 → 0.500**, `sameControls = false` → the
  dispose wrongly SPLIT one report instance into two states.

Verdict: **MERGE** (Fix B), plus close the two remaining leaks the merge exposes.

## Fix (upstream, three coordinated corrections)

All in the producing logic, so the symptom disappears for every consumer.

1. **Dispose control arm reads the RAW control skeleton** (`draft.ts`). The control
   arm's whole point is "one template's instances share their controls" — a
   render-depth-STABLE identity. `normFace`'s widget-folding corrupts exactly that
   when two renders differ in depth. Added `ctlFor` (raw control face per key, from
   `controlFace(minusShell(faceOf(mainScope(landing0))))`), routed through a new
   `sameControlFaces(ca, cb)` at both dispose sites (positional + fixpoint). The
   full-face `sameFace` arm is unchanged (still `normFace`'d — instance data must
   still be folded out of the identity FACE; only the CONTROL comparison went raw).

2. **Opaque-template SPA-split reads the RAW control skeleton too** (`draft.ts`).
   After the dispose merges the two keys, the SPA-split must not re-split the
   instance's mid-query + settled landings on their `normFace`'d controls.
   `clusterFaces` was refactored to `clusterFacesByIndex(n, same(i,j))` so the
   opaque predicate consults each landing's normFace'd identity face AND its raw
   control face by position.

3. **Loading render excluded from a state's CORE** (`draft.ts`, axis-1 settledness).
   Once merged, the mid-query landing still polluted the merged core (its transient
   `status "Running query…"` + `Cancel` made containment only 0.88, so the existing
   partial-render arm missed it), dropping the settled `tab:Flat` identity. Added
   `isLoadingRender` (a WAI-ARIA live-region role `status`/`alert`/`progressbar`
   whose text matches loading PHRASES — site-agnostic, same class as `ERROR_HEADING`
   / interstitial patterns) and excluded such landings from CORE when a settled
   sibling exists (kept when EVERY landing is loading → honest provisional).

4. **`matchState` ignores empty fingerprints** (`fingerprint.ts`). An empty fp
   identifies nothing; `_shell` and degenerate stubs carry `[]` and are routing
   sources, never match candidates. One-line guard in the shared function, so no
   caller has to remember. (The draft's own self-verify already relied on this
   exclusion — now it holds universally, incl. the walk.)

## TDD

New synthetic repro `render-skew: mid-query + settled landings of ONE report merge`
(`tests/explorer/draft.test.ts`): a `/report/16116/{hash}` mid-query landing (flat
chips + `status "Running query…"` + `Cancel`) and a settled landing (chips folded as
2-node widget cards + a 12-row grid). It reproduces the EXACT stored fps
(`report`=`[Table,Charts,New Report,View All,Cancel]`, `report-flat`=`[Table,Charts,Flat]`)
and FAILED on current code (`expected 2 to be 1`). After the fix it passes: ONE
`report` state built from the settled identity (settled affordances, no `Cancel`),
and `matchState` on the settled page is unique.

## Verification

- **New test**: fails pre-fix (`expected 2 to be 1`), passes post-fix.
- **Real map rebuilt**: `graph-analyse --host progneo.analytics.mn --draft`
  (review-gated: `progneo-confirm`, the source of the old 16128 `report`, is
  excluded — never reviewed) → `node-clear` → `graph-edit`. Result: **8 states, the
  `report`/`report-flat` subset-fp pair collapsed to ONE `report`** (fp `[tab:Table]`,
  built from the settled `bd5a` landing with the full settled repertoire — no
  `Cancel`, no mid-query husk).
  - One SEPARATE, pre-existing quirk surfaced: session-ordering can drop the `/1041/`
    tenant segment from `report-list`'s urlPattern (URL-alias pick, unrelated to this
    fix — confirmed by stashing my diff; corrected the one urlPattern by hand for the
    walk, noted as out-of-scope).
- **Live WALK** (ONE fresh headless session, `--profile default`):
  `walk --start progneo.analytics.mn:report-list --goal progneo.analytics.mn:report`
  → navigated report-list → clicked "OS and Device Report" → **`{"status":"done"}`**,
  `playwright_calls: 4`, ZERO `needs-navigation` escalations. (Goal is `report`
  because `report-flat` no longer exists — merged.) No Admin / Switch-to-Classic
  clicked. Session reaped; `sessions list` → empty.
- **`npx tsc --noEmit`**: clean.
- **Full suite**: 865 passed, 7 skipped, 0 failed (incl. `guidelines.test.ts` — no
  site-specific names in `src/`).

## Files changed

- `src/explorer/draft.ts` — dispose/SPA control arm on raw control skeleton
  (`ctlFor`, `sameControlFaces`, `clusterFacesByIndex`), loading-render CORE exclusion
  (`isLoadingRender`).
- `src/explorer/fingerprint.ts` — `matchState` ignores empty fingerprints.
- `tests/explorer/draft.test.ts` — render-skew repro test.
