# Map-model defect fixes — report

Branch `worktree-map-model`. Two user-reported map-model defects + a display fix, all in the
recording→graph producing logic (upstream), verified end-to-end on the real progneo DB.

## Defect 1 — a shell-navigate target got a parent

### Diagnosis (real DB, `~/.webnav/webnav.db`, node `progneo.analytics.mn`)
The stored `report-list` had `role=detail, parent_state=download-list`. `report-list` IS a
`_shell` navigate target (shell has `link:Reports` and `link:Logo Logo` → report-list). The
exact parenting edge: **`download-list` carries a navigate affordance to `report-list` whose
`label` is the literal `"report-list"`** (not the sidebar's "Reports"/"Downloads"). The hierarchy
`parentOf` pass classifies a drill-in as content vs sidebar by `isSidebarLink(a.label)` =
`shell.has('link:'+label)`. `link:report-list` is NOT a shell token → the edge read as a content
drill-in → `parentOf['report-list'] = 'download-list'` (first-content-drill-in-wins). So a
section got parented because ONE content link on another page happened to be labeled with the
target's slug rather than its sidebar name.

### Fix (upstream, `src/explorer/draft.ts`, hierarchy pass)
Compute `shellTargetLabels` — the set of state labels the `_shell` navigates to, resolved with
the SAME `labelByKey.get(fromPageKey(href))` resolution the shell-state block uses (so the two
agree by construction). The `parentOf` pass now skips any edge whose target is a shell-navigate
target (`!shellTargetLabels.has(a.to)`), in addition to the existing `!isSidebarLink(a.label)`.
A shell target therefore never receives a parent and stays `role=section`. The durable signal is
the shell's OWN targets, not the incidental label of some body link.

### Result (real rebuild)
`report-list` → `role=section, parent=None`. Verified in both the approved-only and skip-gate
rebuilds, and after graph-edit into the store (graph-show).

Synthetic TDD: `tests/explorer/draft.test.ts` → "shell-navigate targets are always sections
(Defect 1)" — a shell target reached by a content link labeled with its slug stays parentless.

### Deeper root (reviewer-ruled follow-through): slug leaking into affordance LABELS
The slug labels that made Defect 1 possible originate at `draft.ts` affordance synthesis:
`label: fp?.name ?? toLabel` — a navigate recorded via bare `use navigate` (no element clicked,
no matching link found on the from-page) stamped the target's state SLUG as the user-facing
affordance label. Blast radius on the real map: **3/15 navigate affordances, all `elementFp=null`**:

| from | label BEFORE | label AFTER |
|---|---|---|
| `download-list` → report-list | `'report-list'` | `'Reports'` |
| `report-list` → report-list | `'report-list'` | `'Reports'` |
| `dashboard-category` → self | `'dashboard-category'` | `'Testuser'` |

Fix (at the label's origin): `label: fp?.name ?? displayNameOf(toLabel) ?? toLabel` where
`displayNameOf` = the target page's first core `heading:` token (document order — the same
human-name source display layers read). The slug survives only as last resort when the target has
no core heading. **All 3 real cases resolved to headings** ('Testuser' is that dashboard
instance's own page title — exactly what a display layer shows for it), so the optional
`synthetic: true` marker field was skipped (YAGNI — add it if a real map ever exercises the
no-heading fallback). Rebuild grep: **zero slug-labeled navigate affordances** in BOTH the
approved and skip-gate builds and in graph-show from the store.

Synthetic TDD: "a bare navigate with NO recovered element name is labeled by the TARGET heading,
never the slug".

## Defect 2 — opaque-param instance siblings must merge on non-contradiction

### Diagnosis (real dispose-arm numbers, normFace'd + shell-subtracted)
`/dashboard/1210` (dashboard-category) and `/dashboard/1215` (dashboard) are two instances of the
`/dashboard/{param}` opaque template, stored as separate states. Instrumented the dispose:

- `/dashboard/1210` face `{heading:Testuser, button:<date-range>, heading:Outline, widget:91c36ef2}`
  (control-face size 1), `/dashboard/1215` face `{heading:Overview Dashboard, heading:Outline,
  widget:91c36ef2, widget:0258a480}` (control-face size 0).
- `1210 vs 1215`: jaccard ≈ 0.20 (< 0.5 → **full-face `sameFace` can't fire**),
  containment(smaller in larger) = **0.50**, both control-faces below the ≥4 gate (1 and 0 →
  **control arm `sameControlFaces` can't fire**). They share `widget:91c36ef2` + `heading:Outline`.
- The `/dashboard/{param}` proposal ALSO contained the WORD segment `list`, so the positional pass
  had `opaqueParams=false` — but that never mattered: 1210/1215 were only compared to the
  `/dashboard/list` anchor (a different page), never to EACH OTHER. The fixpoint pass compares
  canonical keys pairwise, which is where 1210 meets 1215.

### Fix (upstream, `src/explorer/draft.ts`, dispose + SPA-split + heading-only holdout)
New predicate `nonContradictoryFaces(a,b)` applied ONLY between opaque-param members
(`bothOpaque`), in both dispose passes:
- merge when `containment(smaller,larger) ≥ 0.7` (broad ⊆-compatibility, tunable), OR
- when BOTH control-faces are below the ≥4 control-evidence gate (too few controls to assert a
  rival page-type) AND `containment ≥ 0.5` (share real structure, not a disjoint contradicting
  page). Genuine contradiction — two RICH faces with disjoint controls / near-zero containment —
  still splits.

Ponytail note (reviewer): the 0.5 thin-arm overlap floor is calibrated to the ONE observed real
case — the two live dashboards sit at containment exactly 0.50, so the floor admits them with zero
margin. A thin instance pair sharing slightly less structure will split. Deliberate ceiling
(marked with a `ponytail:` comment at `NONCONTRA_OVERLAP` in draft.ts); retune only on a real
counterexample, not speculatively.

The control-gate (not raw token count) is the key discriminator: two report VIZZES under one
`/report/{id}` template each carry 3-4 real controls (Table/Charts/Export vs Flat/Search/Download)
sharing only a title (containment ~0.2) → they contradict and split by tab; a data-grid LIST vs a
WIDGET viewer carry disjoint `widget:<sig>` tokens (containment 0) → also split. Two icon-only
dashboards (0-1 controls, containment 0.5) merge.

Consequential fixes so the merge survives the rest of the pipeline (union semantics, as with
existing template merges):
- `priorMergedTemplates` tracks templates joined via the prior (not observed agreement). The
  merged state's `provisional` = **'merged on URL-template prior — record more visits to confirm
  shared structure'** (takes precedence over templateCore's seen-once note).
- The opaque-template **SPA-split predicate** for a prior-merged key now also includes
  `nonContradictoryFaces` — else the SPA clusterer immediately re-splits the two instances the
  dispose just merged (they land in separate clusters, find no distinguishing heading, and drop to
  needsFix). Same principle the code already applies for the control arm.
- The **heading-only holdout** (`isParam && headingOnly && provisional` → needsFix, a 1-instance
  gate) is skipped for prior-merged states: a prior-merged state has ≥2 instances whose SHARED
  heading survived templateCore intersection — that repetition is structural, not instance data.

### Result (real rebuild, skip-gate, where BOTH instances exist)
The two dashboards merge into ONE state `dashboard`, `urlPattern=/v3/1041/dashboard/1210`,
`template=/dashboard/{param}`, `provisional='merged on URL-template prior — …'`. No needsFix
entry for either instance. (In the approved-only build only `/dashboard/1210` was recorded, so
there is nothing to merge — correct: a lone instance stays as-is.)

Synthetic TDD (`tests/explorer/draft.test.ts`):
- "thin + rich opaque siblings merge to ONE provisional /dashboard/{param} state"
- "two RICH contradictory opaque siblings still SPLIT (distinct control faces)"
- list-vs-instance (word segment) and single-opaque-instance cases unaffected (existing RULE 3 +
  dispose + normalization mutation locks all still green).

## Display fix — `template` threads into the store

`draftFromEffects` already emitted `template` on DraftState, but graph-edit dropped it:
`EditState` didn't declare it and `makeState(...)` didn't pass it, so it never reached the store —
viewers only ever saw an instance URL. Threaded through additively (like `provisional`):
- `src/mapstore/types.ts`: `State.template?: string | null`.
- `src/mapstore/store.ts`: `url_template` column (ALTER-TABLE migration), write + `rowToState`.
- `src/graph/edit.ts`: `EditState.template`; on re-edit take incoming else keep prior (like
  `urlPattern`).
- `graph-show` returns full `State`s, so `template` surfaces automatically (no cli.ts change).

Result: `report` state carries `template=/report/{param}/{param}`, `dashboard` carries
`/dashboard/{param}`, both readable via graph-show from the store. Test:
`tests/graph/edit.test.ts` → "threads urlPattern template into the store".

## Verification

- `npm test`: **885 passed, 7 skipped** (live/e2e). `tsc --noEmit`: clean. `guidelines.test.ts`
  (map-stores-structure-not-data): pass.
- Real rebuild (node-clear → analyse → graph-edit → graph-show) on `~/.webnav/webnav.db`:
  - Skip-gate build (task recipe, both dashboard instances present): 7 page states + `_shell`;
    `report-list` section/no-parent; ONE `dashboard` (template `/dashboard/{param}`, provisional);
    `report` template `/report/{param}/{param}`. **Matches the task's expected output.**
- Release suite (`webnav test --suite packs/suites/progneo.suite.json --headless`, live, auth via
  the `default` profile): **7/7 PASS on the clean approved-only canonical build** (which is what
  the review gate exists to select; original suite labels unchanged, no data-pinning needed).

### Suite / store decision (transparency)
The two builds diverge only because of the review gate:
- **Approved-only build** (5 review-passed sessions): clean labels (`help-center`,
  `announcements`, `report-list`), Defect 1 fixed, **suite 7/7**. This is the persisted release
  map (review-gated = canonical).
- **Skip-gate build** (all 18 steps>0 sessions): additionally pulls unreviewed PROBE sessions
  (`shot4`, `shot5`) that captured `help-center` with a help ARTICLE open and a variant
  `announcements` landing. These SPA-split and rename the states to
  `help-center-interface-user-guide` / `announcements-renamed-dimensions-and-metrics` (transient
  content leaking into a label). Under skip-gate the suite is 5/7 — the two failures are
  label-resolution on those polluted names, NOT the defect fixes (the other 5 cases, including
  every shell-nav / addressable-jump case that exercises Defect 1, pass live).

Defect 2's merge needs `/dashboard/1215`, which lives only in an unreviewed session (`pg7712`), so
it is demonstrable only on the skip-gate build (documented above) + unit tests. Persisting the
skip-gate build would cement probe-session noise (`shot4`/`shot5`) into the released map, against
the review-gate principle, so the store is left on the clean approved build. The suite file is
therefore NOT modified (no legitimate label change on the canonical build).

## Named follow-up: SPA-split data-derived state renames (third defect, out of scope here)

The skip-gate SPA-split lets a transient in-page article/variant landing rename a section state to
a data-derived label: `help-center` → `help-center-interface-user-guide` (a probe session,
`shot4`, captured the page with a help ARTICLE open), `announcements` →
`announcements-renamed-dimensions-and-metrics` (`shot5`, a variant landing). This is the same
complaint class as the slug-label fix above — technical/transient identifiers leaking into
user-facing surfaces — but in the SPA-split NAMING path (`distinguishingHeading` picks a content
heading from one noisy landing), independent of the two defects fixed here. It also degrades the
renamed state (the polluted help-center lost its addressable-jump and article-section mutates
leaked into its repertoire). Fix belongs upstream in the split-naming/landing-trust logic; tracked
as its own defect, not patched here.
