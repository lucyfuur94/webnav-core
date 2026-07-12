# Tenant-as-param + instance-content-state-names — RCA + fix + verification

Worktree `worktree-tenant` (base `43d4333`). Two progneo accounts now recorded in
`~/.webnav/webnav.db`: `/v3/1041/...` (Overview, 295 obs) and `/v3/1045/...` (Deal Reporting,
10 obs), same product, tenant id in the URL. The second account exposed two upstream defects.

---

## RCA — DEFECT 1: tenant id stays a literal base segment (no cross-account merge)

### Observed
`dev graph-analyse --host progneo.analytics.mn --skip-review-gate --draft` (both accounts) →
`report-list`, `report-draft`, `report`, `dashboard-list`, `dashboard-draft` all land in
**needsFix "name collision unresolved"** instead of being ONE state each. The 1041 and 1045
variants of each page never merge; cross-account variance therefore never runs.

Observed URLs (distinct `to_url`, progneo), varying position after `v3`:
```
/v3/1041/report/list       /v3/1045/report/list
/v3/1041/dashboard/list     /v3/1045/dashboard/list
/v3/1041/report/draft       /v3/1045/report/draft
/v3/1041/dashboard/draft    /v3/1045/dashboard/draft
/v3/1041/report/16116/…     /v3/1045/report/16137/…
/v3/report/list  (pre-redirect ghost — "Page not found", no tenant seg)
```
Segment-frequency at the position after `v3`: `1041` ×295, `1045` ×10, module-word ghosts ×4.

### Why (root cause, `inferUrlModel`/`keyOf` in `src/explorer/infer.ts`)
`inferUrlModel` peels the site base greedily: a leading segment shared by ≥80% of paths is
locked as a constant base segment. `v3` is 100% → base. The next position is 295/309 ≈ 95%
`1041` → **still ≥80%, so `1041` is locked as a literal base segment too**. `keyOf` then strips
`v3/1041` where present, so `/v3/1041/report/list` → `/report/list` but `/v3/1045/report/list` →
`/1045/report/list` — DIFFERENT keys. Two accounts' identical pages never share a
`landingsByKey` bucket, so they can never merge; `labelFromKey` names both `report-list`, they
collide, and both fall to needsFix.

Correct when only 1041 existed; wrong once a second tenant appears. The fix is NOT to hardcode
"strip the segment after v3". The principled rule: **a base position whose observed value VARIES
across URLs is not a constant base segment — it is a PARAM.** Guard (task-mandated, reuses the
existing `isOpaqueSeg` word-vs-opaque distinction): the position is a param only when its
dominant value is an opaque id AND ≥2 DISTINCT opaque-id values are observed there — so `1041`
alone stays literal base (single-tenant unchanged), `{1041,1045}` becomes `{param}`, and a
genuinely different top-level path (a module WORD like `report`) never becomes param.

---

## RCA — DEFECT 2: SPA-split promotes instance CONTENT to state labels

### Observed
Same build → states named `announcements-renamed-dimensions-and-metrics`,
`help-center-interface-user-guide`, `dashboard-deal-performance-dashboard`. Each label's tail is
instance CONTENT, not structure. (Fingerprints are already structural — `heading:Announcements`,
`heading:Help Center` — so the leak is in the LABEL discriminator, and in the SPLIT that forced
one.)

`/announcements` recorded twice:
- `shot5 seq0` — captured EARLY: only `heading:Announcements` (list items not rendered yet).
- `sidebar-nav seq26` — fully rendered: `heading:Announcements` + item titles
  `heading "Renamed Dimensions and Metrics" [level=2]`, `heading "Introducing New Reporting
  Interface" [level=2]` — these are announcement-ITEM titles (DATA).

### Why (root cause, SPA-split label path in `src/explorer/draft.ts`)
Rule-4 SPA-split single-link-clusters a key's landings on their shell-subtracted identity faces.
The sparse early landing and the full landing have different faces → **2 clusters**. The split
then names each cluster with `${labelBase}-${slug(distinguishingHeading(...))}`.
`distinguishingHeading` returns the FIRST `heading:`/`tab:` token unique to a cluster — and the
only heading unique to the full cluster is the item title `Renamed Dimensions and Metrics`. So a
data heading becomes the discriminator and the label.

Two failures compound:
1. **The split itself is wrong.** These are two visits of ONE page (the second just has more data
   rows). They are instances of one template and should MERGE, not split. The sparse landing is a
   partial/pre-data render; the full landing is the settled one.
2. **The discriminator is content.** Even where a split is genuine, a discriminator that is
   per-instance data (a level-2 item title) must never name a state.

Per the fix-upstream rule and the task: a SPA-split discriminator must be STRUCTURAL; if the only
thing telling two clusters apart is instance content, they are instances of one template → MERGE
(provisional), don't split-and-name-by-content. This reuses the opaque-sibling non-contradiction
merge already in the dispose/SPA-split.

---

## FIX (upstream, general, no site tokens)

### Fix 1 — varying opaque-id base position → `{param}` (`src/explorer/infer.ts`)
`inferUrlModel`'s greedy peel now detects a VARYING opaque-id position and treats it as a `{param}`
base entry: at each position, if the dominant head is opaque AND ≥2 DISTINCT opaque-id values are
observed there, push `{param}` (not the majority literal) and consume one opaque segment from every
path. `keyOf` emits `{param}` at a param position only when the actual segment is opaque; a non-opaque
segment there (a pre-redirect ghost) is left in place. Guard reuses `isOpaqueSeg` (moved to
infer.ts as the canonical word-vs-opaque home; draft.ts now imports it — one rule, no divergence):
- single tenant → still literal base (unchanged, `['v3','1041']`);
- two tenants → `['v3','{param}']`, so `/v3/1041/report/list` and `/v3/1045/report/list` both key to
  `/{param}/report/list` (merge);
- a varying MODULE WORD (blog/shop) stays distinct (not a param).

### Fix 2 — SPA-split / name-collision discriminator must be STRUCTURAL (`src/explorer/draft.ts`)
Three upstream changes so a state is never named after instance content:
1. **SPA-split clusterCore** excludes FOLDED template-member names (`templateFolds.gatedNames`) AND
   DEEP content headings (`[level ≥ 2]` — a help-article / announcement-item title; the page's own
   title is the level-1 `h1`). What's left is structure only.
2. **Merge-not-split**: if, after that exclusion, NO cluster has a structural discriminator, the
   clusters differ only by data → they are ONE page → MERGE (provisional), never split-and-name nor
   drop the odd (sparse pre-data) landing to needsFix. A genuine SPA split keeps its distinct
   structural heading/tab, so it still splits.
3. **Param-page discriminator = tab-first, heading-fallback**: on a `{param}`/opaque-tail page a
   heading is likely the instance TITLE (`Testuser`, a dashboard name), so `distinguishingHeading`
   prefers a `tab:` (view tab-set = structural) and falls back to a heading only when no tab
   distinguishes (two different page-TYPES with no tabs — `Grid List` vs `Grid Viewer` — keep their
   title). Same instance-data prior `candidateTokensFor` already uses for the fingerprint.
4. **Ordering fix (exposed by the merge)**: error-page landings are now detected BEFORE the
   name-collision pass, so a pre-redirect `Page not found` ghost keyed onto a real page's label no
   longer forces the healthy state to take a disambiguating suffix (`report-list` → `report-list-reports`).

## VERIFICATION (re-run from source, both accounts)

Build: `dev graph-analyse` over the 5 review-approved canonical sessions + `exp-var` (the
cross-account drive), `--skip-review-gate --draft`. Persisted via node-clear → graph-edit (11 states).

**Cross-account merge (urlPattern / template):**
- `report-list` — ONE state, both tenants' `/report/list` merged (keyed `/{param}/report/list`).
- `dashboard-list`, `download-list`, `announcements`, `help-center` — ONE clean state each.
- `report` (builder) — ONE state, template `/{param}/report/{param}/{param}` spanning 16116 (1041),
  16128 (1041), 16137 (1045). fp `tab:Table`.
- `dashboard-setup` — ONE state, template `/{param}/dashboard/{param}` (1210+1159), fp tabs only.

**Variance stripped (report affordances):** all structural controls (Remove, Download as formatted
CSV, Save Visualization, Charts, Table, Add dimensions/metrics/filter, Share, Save As / Schedule …).
Account-specific names Publisher / eCPM / Curator Fee / "Performance by Deal" — GONE (templateCore
drops per-account tokens; fp is `tab:Table`, not any instance name). One residual: `Deal Performance
Dashboard` persists as a per-ITEM navigate LINK on `dashboard-list` — a PRE-EXISTING list-item-link
folding gap (baseline single-tenant already listed `Testuser` there), NOT the tenant-merge defect;
identity/fingerprints are clean of it. Noted for a separate follow-up (fold list-item navigate links
into a `scope:row` navigate).

**No content-named states:** state labels = report-list, help-center, dashboard-list, download-list,
announcements, report, dashboard-setup, report-draft, dashboard-draft, dashboard, _shell. grep for
`deal-performance` / `interface-user-guide` / `renamed-dimensions` / `testuser` → none.

**Canonical review-gated build still works:** 5 approved sessions (no `--skip-review-gate`, single
tenant) → 8 clean states, excludedUnverified 0, no content-named states, no tenant split. Offline
acceptance test (`tests/acceptance/progneo-local.test.ts`, the 5-session bar) PASSES.

**Frontier (`dev frontier --node progneo.analytics.mn`) data-value rows: 26 → 4** (total 109 → 41).
The dashboard-draft chart/viz-name bloat (Revenue by Media Type, eCPM Trend, MTD ( Revenue ) …) is
gone; the 4 residual are report-draft dimension/metric names on the seen-once NEW-report builder
(provisional) — not tenant-merge related.

**Release suite (`packs/suites/progneo.suite.json`, 7 cases):** all 7 referenced states
(report-list, report, dashboard-list, download-list, help-center, announcements) EXIST in the built
map — structural prerequisite met. The live 7/7 WALK needs a browser + progneo SSO login (interactive
gate) — not driven here per the headed-window + SSO rules; structural readiness verified instead.

**Suite / tsc / guidelines:** full `vitest run` 903 passed, 7 skipped (live e2e); `tsc --noEmit`
clean; guidelines (no site tokens / no banned heuristics) green. Synthetic TDD added for both fixes.

