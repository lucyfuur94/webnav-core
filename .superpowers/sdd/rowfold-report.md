# rowfold — upstream fix for data-value leaks in `draftFromEffects`

Surfaced by `dev frontier --node progneo.analytics.mn` (baseline **29** frontier items).
HARD RULE: the map stores STRUCTURE, never data values; fix the producing stage, never
scrub downstream. RCA written BEFORE any code, grounded in the real recorded observations
(`record_observations` in `~/.webnav/webnav.db`), not guesses.

---

## RCA (per class) — why it became a stored affordance, why existing machinery missed it

### Class 1 — LIST ROWS (`dashboard-list`)
Polluting stored affordances:
- `[mutate] "Test_demo - Jul 8, 2026 12:20 IST devbrat.r"`
- `[mutate] "Testuser - Jan 13, 2026 19:31 IST devbrat.r"`

**What actually happened (from the recording):** in session `dashboard-download-lists` the
agent recorded two NON-navigating clicks whose action role is `row`:
```
seq2 role=row nav=0 name="Test_demo - Jul 8, 2026 12:20 IST devbrat.r"
seq3 role=row nav=0 name="Testuser - Jan 13, 2026 19:31 IST devbrat.r"
```
The FROM snapshot shows a real `grid`: `rowgroup → row "<title> - <date> <user>" → gridcell…`,
with 6+ sibling rows. The row's accessible NAME is title+date+user — pure per-instance data.

**Why it became an affordance:** the recorded-click producer (draft.ts §3a, the
`if (e.action.name)` mutate/reveal branch) emits an affordance straight from `e.action.name`
with `label = e.action.name`. A recorded click bypasses `templateFolds` entirely — that fold
runs only on the interior-synthesis path (§3c) over a page's `coreNodes`. So a clicked row
becomes a first-class mutate carrying its instance label.

**Why folding missed it:** `templateFolds`/`subtreeFolds` fold ≥3 same-shape sibling SUBTREES,
but they only ever run on §3c's declared-structure pass. The two rows here are RECORDED CLICKS
(§3a), not synthesized declared structure — a code path the fold never touches. And only 2 of
the 6 rows appear precisely because only 2 were clicked; they're not "3 declared siblings," they
are "2 recorded per-instance interactions." (The genuine open-a-dashboard edge — a `role=link`
`nav=1 "Testuser"` navigate with a distinct toState — is a different, legitimate affordance and is
out of scope: navigates with distinct toStates don't fold the same way.)

**Right model:** a recorded click whose element role is a COLLECTION role (`row`/`gridcell`/`cell`)
is a per-row instance interaction. The durable affordance is ONE row-scoped template, not the
specific row's data. → fold to a single `scope:'row'` affordance with a STRUCTURAL label (the
collection role, e.g. `"row"`), instance name + fp dropped; N such clicks dedup to one.

### Class 3 — COMPOSITE DATE-RANGE LABEL (`dashboard-category`, `report`)
Polluting stored affordances:
- `dashboard-category`: `[mutate] "09 Jul 2026 - 10 Jul 2026 UTC"` AND `[reveal] "09 Jul 2026 - 10 Jul 2026 UTC"`
- `report`: `[mutate] "Last 7 Days (CD) : 02 Jul 2026 - 08 Jul 2026UTC"` AND `[reveal] "Last 7 Days (CD) : 02 Jul 2026 - 08 Jul 2026UTC"`

**What happened:** recorded clicks on the date-range PICKER OPENER:
```
dashboard-viewer seq9/10  role=button name="09 Jul 2026 - 10 Jul 2026 UTC"
report-builder   seq12/33  role=""    name="Last 7 Days (CD) : 02 Jul 2026 - 08 Jul 2026UTC"
```
The opener's accessible name is its CURRENT VALUE (the selected range). The click sometimes
opened an overlay (→ reveal) and sometimes stayed in-place (→ mutate), so the same value-label
appears as both kinds.

**Why the value gate missed it:** the existing `DATA_LITERAL` gate is `^…$`-ANCHORED on a BARE
date/number (`09 Jul 2026`, `2026-07-09`, `$12`). It deliberately refuses only whole-name literals
so it never eats a labelled control like `"Due 09 Jul 2026"`. A COMPOSITE like
`"Last 7 Days (CD) : 02 Jul 2026 - 08 Jul 2026UTC"` — preset prefix + date RANGE + TZ suffix — is
not a bare literal, so it slips through.

**Right model:** the durable affordance is "open the date-range picker"; its stored label must be a
stable control name, never the current range. There is no separate durable name on this control
(the accessible name IS the value), so the honest structural move is to REFUSE the affordance whose
label is dominated by a date-range value — same posture as `DATA_LITERAL`, extended to the
`<date> - <date>` (range) shape rather than only a lone date. Applied at the same assembly value
gate so it covers reveal + mutate + reveal-children uniformly.

### Class 2 — HELP-CENTER ARTICLE/SECTION TITLES (`help-center`) — ADJUDICATED: LEAVE (borderline-structural)
Affordances: `[mutate] "Overview" / "Working with Reports" / "Downloading Data" /
"Viewing Dashboards" / "FAQs" / "Help Center" / "Accessing the Interface"` (+ a folded
`[mutate:widget] "Interface User Guide"`).

**What happened:** the help-center is a declared accordion — `heading "Interface User Guide" →
region → listitem → button "Overview"|"Working with Reports"|…`, plus standalone `button
"Glossary"/"Videos"/"API Guide"/"FAQs"`. These are DECLARED named buttons in the page's core, so
interior-synthesis (§3c) emitted each as a mutate. `subtreeFolds` folded the one repeated
listitem>button cluster into `mutate:widget "Interface User Guide"`; the rest are structurally
distinct buttons (different parents / standalone) so they didn't fold.

**Adjudication — LEAVE them.** These are accordion SECTION titles that name durable content areas.
They sit on the borderline between structure and content, and the task explicitly says to leave
borderline-structural titles rather than over-fix. Decisively: there is NO site-agnostic SHAPE that
separates a help-article title ("Working with Reports") from a genuine structural opener
("Add dimensions", "New Report", "Save Visualization") — the only thing that distinguishes them is
CONTENT SEMANTICS, and judging content is forbidden to webnav (#5a). Any regex broad enough to kill
"Working with Reports" also kills real openers. So the correct upstream call is to leave them; a
"fix" here would be either a site token (banned by `guidelines.test.ts`) or a content judgment
(banned by #5a). Reported, not fixed.

---

## Fix (upstream, per RCA — surgical, general, no site tokens)

Both fixes live in `src/explorer/draft.ts`; both are role/shape-based (site-agnostic, pass
`guidelines.test.ts`).

**Fix A (Class 1) — collection-role recorded clicks fold to a row template.** In the §3a
recorded-click producer, before building the mutate/reveal affordance: if the clicked element's
role is a COLLECTION role (`row`/`gridcell`/`cell`), emit ONE `scope:'row'` mutate with a
structural label (the role name) and `elementFp: null` (a folded template has no single durable
coordinate; mutates never route). `pushAff`'s existing (kind+label+to) dedup folds every such click
into one row template. General: fires on ANY grid/table row click on any site.

**Fix B (Class 3) — value gate extended to date-RANGE labels.** Add an `isDateRangeValue` companion
to `isDataLiteral`: a label whose content contains a `<date> - <date>` range span (date =
`D Mon YYYY` or `YYYY-MM-DD`) is instance data. Applied at the same assembly value gate (and to
reveal children) as `isDataLiteral`. Verified against the full progneo label set: kills both
composites, survives every real opener ("New Report"/"Add dimensions"/"Search"/…).

Skipped: no change to the navigate branch (the genuine open-dashboard edge is a distinct-toState
navigate, correctly kept). No Class-2 change (adjudicated above).

---

## Verify — proof it's UPSTREAM, not a scrub

### Method note — why a controlled old-vs-new comparison, not the raw stored 29
The stored 29-item map was a hand-curated subset (specific edited states: `dashboard-category`,
`report`, …). A naive `dev node-clear → graph-analyse --host --draft → graph-edit` re-derives from
ALL of the host's reviewed sessions and produces a DIFFERENT, larger state set (`dashboard-draft`,
`help-center-faq`, `report-draft-time`, …), so its 109-item frontier is not comparable to 29 — the
state set changed, not just the code. To prove the fix is UPSTREAM without that confound, I ran the
producing stage (`draftFromEffects`) on the IDENTICAL input (the real 185 effects from the 5
review-approved progneo sessions in `~/.webnav/webnav.db`), OLD code vs NEW code, and diffed. The
original stored map was backed up and RESTORED afterward (frontier re-confirmed at 29).

### Controlled result — same 5-session input, only the code differs

**Draft affordances (draftFromEffects on the 5 approved sessions):**

| target data-value affordance | OLD code | NEW code |
|---|---|---|
| `Test_demo - Jul 8, 2026 12:20 IST devbrat.r` (dashboard-list) | PRESENT (mutate) | **ABSENT** |
| `Testuser - Jan 13, 2026 19:31 IST devbrat.r` (dashboard-list) | PRESENT (mutate) | **ABSENT** |
| `09 Jul 2026 - 10 Jul 2026 UTC` (dashboard-category) | PRESENT (mutate + reveal) | **ABSENT** |
| `Last 7 Days (CD) : 02 Jul 2026 - 08 Jul 2026UTC` (report) | PRESENT (mutate + reveal) | **ABSENT** |
| `New Report` / `New Dashboard` / `Search` / `Add dimensions` | PRESENT | **PRESENT** |

NEW draft adds `dashboard-list → mutate:row "row"` (the 2 instance rows folded into one template).
Total affordances 98 → 93 (−6 pollutants, +1 row template = −5 net).

**Frontier (`computeFrontier` on the identical 5-session state set, excludes = the progneo
do-not-click prefs `Admin`/`Switch to Classic`):**

| | OLD code | NEW code |
|---|---|---|
| frontier total | **43** | **37** |
| date/list DATA-VALUE frontier items | **6** | **0** |

The 6 dropped frontier items (OLD→NEW) are EXACTLY the target rows:
`Test_demo…`, `Testuser…`, `Last 7 Days (CD)…` (×2: mutate+reveal), `09 Jul 2026 - 10 Jul 2026 UTC`
(×2: mutate+reveal). No structural opener dropped. (The task's baseline of 29 is the curated
stored map; the honest confound-free measurement on identical inputs is **43 → 37, −6 data-value
rows, 0 remaining**.)

### Article-title verdict — LEFT (borderline-structural), as adjudicated in the RCA
The 7 help-center titles remain on the frontier. No site-agnostic SHAPE distinguishes a help-article
title from a real opener; only content semantics do, and webnav may not judge content (#5a). A
"fix" would need a site token (banned) or a content judgment (banned), so leaving them is the
correct upstream call.

### Suite verdict
- Full unit suite: **898 passed, 7 skipped, 0 failed** (`vitest run`). Includes the offline progneo
  acceptance (`tests/acceptance/progneo-local.test.ts`, 2/2) run against the REAL 5-session data —
  the design's acceptance bar, still clean with the fix.
- `tsc --noEmit`: **clean**.
- `tests/guidelines.test.ts`: **passed** — no site tokens re-introduced (both fixes are role/shape).
- Live release suite `packs/suites/progneo.suite.json` (`dev test --headless`): **7/7 passed**
  (fresh headless browser per case, all reaped after).
- Test changes: 2 new synthetic TDD tests (grid-row fold → one scope:row template; date-range
  composite refused) + updated `tests/grammar/pickers.test.ts` X10 (2 opener-classification tests
  now assert the value-labelled opener is REFUSED — they had pinned the OLD leak; the day-cell
  never-stored + page-durable-actions invariants are unchanged and still pass).
