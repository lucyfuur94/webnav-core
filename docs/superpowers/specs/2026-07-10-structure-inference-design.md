# Structure inference — site-agnostic recording→graph (design)

**Date:** 2026-07-10 · **Status:** proposed (awaiting user sign-off) · **Supersedes:** the one-shot heuristics inside `draftFromEffects` (`stablePathKey`/`pathSlug`/ID_SEG, snapshot union, ≥60% sidebar rule) and the narrow per-symptom fixes proposed for report-list-2 / data-value pollution.

## Why (the recurring failure)

Every site we've mapped broke a *different* single-observation heuristic. The user's requirement: **a structure that just works across websites** — no more per-site pointing.

| Symptom (real, observed) | Failed heuristic |
|---|---|
| `report-list-2` ghost state (the analytics SPA) | `stablePathKey` keeps version/tenant segments → pre-redirect `/v3/report/list` ≠ `/v3/9999/report/list`, name collision suffixed |
| OrangeHRM hub-and-spoke mesh (memory) | same class: pre/post-redirect URL mismatch, no alias concept |
| `Publisher`/`Country`/`02 Jul 2026`/`X Remove` stored as affordances; 28 dimension names in `shadow.filters` (the analytics SPA) | mutation-after snapshots unioned into the page's nodes; interior-synthesis + shadow read the union with no overlay/data concept |
| `dashboard` state fingerprint = `heading:Demo User` (the logged-in user's name!) | one-shot fingerprint from a single landing — instance data as state identity |
| dashboard names (`ASJDH`, `Demo Report`) inside the dashboard-list draft | single landing = no variance signal, trusted anyway |
| slug ids (`/products/blue-widget`), locale segments, hash/query SPA routing — will break next | `ID_SEG` digit/hex regex, last-2-segment `pathSlug`, strip-query-always |
| `(N) records found` regex in "generic" shadow code | OrangeHRM-ism baked into core |

Common root: **deciding from a single observation with a regex what only multiple observations (or the page's own declarations) can tell you.**

## Prior art (this is a solved class of problem)

- **Wrapper induction / template detection** (25 yrs of IE literature): comparing structurally similar pages of one site "reverse-engineers the page generation process to find and remove the website's skeleton, leaving only the content" — i.e. template (structure) vs slots (data) by cross-page comparison, never regexes.
- **Crawljax / WebMate / FRAGGEN** (SPA crawling): state identity is an *equivalence function over observed UI structure* (DOM/fragment/actionable-based), because URL alone is neither necessary nor sufficient.
- **WAI-ARIA landmarks**: pages *declare* their own chrome (`banner`/`navigation`/`main`/`complementary`/`contentinfo`) and their own transient containers (`dialog`/`menu`/`listbox`) — reading them is principle #1 ("the web announces its own roads"), not inference.

webnav's design = wrapper induction over a11y snapshots + Crawljax-style joint state equivalence + ARIA declarations, kept judgment-free (#5a).

## The model — five site-agnostic evidence axes

All rules below are observational; **zero site-specific tokens** anywhere in src.

1. **Settledness (time).** A state's face is a **settled landing** snapshot (readiness-gated). A navigation records its full URL chain: `requested → settled`; every non-settled URL becomes an **alias** of the settled state, never a state. Overlay open/close cycles within a page are repertoire evidence, never states. *(Kills: redirect ghosts — the analytics SPA report-list-2 AND OrangeHRM's mesh gap, one mechanism.)*

2. **Declaration (ARIA).** Landmarks declare shell; `dialog`/`alertdialog`/`menu`/`listbox`/`tooltip` declare transient overlay containers; `option`/`menuitem*` declare **value domains**. A click on a node inside an overlay container is a *value selection or the overlay's own control* — attributed to the opening affordance's children (reveal model, unchanged), never to the page body. *(Kills: picker options, date literals, Apply/Cancel as page affordances.)*

3. **Cross-page variance (shell).** Nodes present on ≥80% of a site's distinct pages are the shared shell, stored ONCE on a site-level shell record; their navigate edges are from-anywhere edges (projection unchanged). Landmark declaration and cross-page constancy corroborate each other — either alone suffices when the other is absent. *(Kills: sidebar duplicated per state, `O Overview Merged Change` everywhere; gives do-not-click policies one home.)*

4. **Cross-visit / cross-instance variance (template core).** A state's durable face = what **repeats across its settled landings** (majority-presence k-of-n, not strict intersection, to tolerate A/B noise); the varying remainder = data slots, never stored. URL segments constant across the whole site = base (`v3/1041`); constant within a template = identity; varying = `{param}`. **Identity is joint**: URL-template groupings *propose*, structural similarity *disposes* (so `/dashboard/list` vs `/dashboard/8001` stay separate despite `/dashboard/{param}`; SPA same-URL states split on structure; the three `/report/7001/{viz}` variants merge). **With one observation the state is `provisional`** — kept, marked, and the map *reports what would confirm it* ("visit a second report"). Priors (a digit/hex segment is probably a param; a heading on a parameterized page is probably data) are allowed only as *provisional* markings that evidence later confirms or refutes — never silent truth. *(Kills: `heading:Demo User` fingerprints, dashboard-name leakage — proven: 2-landing `download-list` core is clean, 1-landing `dashboard-list` isn't → provisionality is the honest difference.)*

5. **Within-page repetition (parameterized affordances).** N same-role siblings sharing a name pattern under a repeating container (table rows, chip rows: 50× `Delete`, 7× `<X> Remove`) are **one affordance template** (`scope: 'row'` / value-bound), resolved at walk time with a row/value anchor (the existing `near` + escalation mechanism). *(Kills: `OS Remove`…`eCPM Remove` enumeration; un-drops the row buttons interior-synthesis currently discards as ambiguous.)*

### What the map stores vs refuses to store
- **Stores:** templates (URL + structural core), parameterized affordances, shell, aliases, provenance (`sessions`, `landings`, `instances`, `confirmed|provisional`).
- **Refuses:** overlay option values, instance data (row contents, instance headings, record counts, dates), anything visit- or instance-scoped. Value domains are read **live** at walk time — never persisted (they go stale; the user's rule: "we can't store specific values").

## Prototype evidence (real the analytics SPA effects, 185 observations, zero site rules)

- **URL axis:** base `v3/1041` inferred by constancy; ghost `/v3/report/list` merged automatically; templates `/{x}/list`, `/report/7001/{viz}` found; `/dashboard/{param}` over-merge correctly *rejected* by the structural check (44-node list face vs viewer face).
- **Shell axis:** exactly the 13 sidebar/topbar nodes (incl. `Admin`, `Switch to Classic`, `O Overview Merged Change`, `Dark Mode`, logo links).
- **Core axis:** `download-list` (2 landings) → clean 36-node structural core (tabs, pagination, search — zero data rows); `help-center` (2 landings) → clean 26; `dashboard-list` (1 landing) → leaks dashboard names → *provisional* is the correct verdict; `dashboard/8001` → an unsettled landing poisoned the intersection → settledness gate is required, not optional.
- **Overlay axis:** clicked `Publisher`/`Country`/`United States`/`Last 30 Days`/`This Month`/`Bid Requests…` → in-overlay (data); `Share`/`Download as formatted CSV`/`Table`/`Charts`/`Save Visualization` → page-level (structure). Clean split.

## Changes by pipeline stage

- **record** (small, gated): snapshot only after readiness (`classifyReadiness` exists); record the navigation's requested vs settled URL (alias capture). Recording stays judgment-free — it captures *more* truth (settledness, chains), decides nothing.
- **draft** (the heart, rewritten): the five-axis inference replaces the heuristic set. **Deleted:** `ID_SEG` regex, last-2 `pathSlug`, `RECORD_COUNT_RE`, `subTabContainer` opt, numeric `-2` collision suffixes (unresolvable collision → `needsFix`, never silent), union-of-mutation-afters into page nodes (they feed overlay/repertoire analysis only).
- **store**: `aliases` table (url → state); provenance + `provisional` on states; `scope` on affordances; site shell record; `urlPattern` may carry `{param}` templates. Migrations additive.
- **walk**: resolves against template-core fingerprints (strictly more reliable — no `Demo User`); row-scoped affordances require an anchor at pause time (existing escalation protocol, unchanged).
- **analyse/viewer**: shell rendered once; provisional states badged with *what would confirm them* ("record a second report instance"); templates displayed as `/report/{id}`. The map asks for the observations it needs — the record→verify→build loop gains a third arrow: **refine**.

Unchanged (settled principles all hold): affordance-primary model, reveal children, projected edges, elementFp `{role,name,near}`, zero-LLM, judgment-free evidence, walk-vs-use split, two-tier coordinates (tier-1 addressability becomes *verified* — a stored URL is addressable because a goto reproduced the fingerprint, not assumed).

## Acceptance ("just works" bar — same code, no site conditionals)

1. **the analytics SPA**, rebuilt from the same 5 approved sessions: no ghost states; no dimension/metric/date/option values anywhere in states or shadow; shell extracted (≈13 nodes); `report` ≤ ~25 page-level affordances + parameterized row templates; no fingerprint contains instance data; names clean without numeric suffixes.
2. **saucedemo**: seeded walk login→checkout-complete still completes e2e (no regression).
3. **OrangeHRM**: the redirect-mismatch case (unit fixture from the documented failure) yields a full mesh via aliases — and a fresh live record-and-build when a machine with a browser is available.
4. `grep` finds zero site-specific strings/regexes in `src/`.
5. Single-landing states are `provisional` and the analyse output says what to record next.

## Phases

- **A — record settledness + aliases** (small; unblocks everything).
- **B — draft rewrite** (five-axis inference + tests; fully verifiable OFFLINE against the stored the analytics SPA effects — no browser needed).
- **C — store/walk/viewer deltas** (aliases, provenance, scope, shell; provisional badges).
- **D — end-to-end re-verify** (acceptance 1–5; live walk for saucedemo).

## Risks / honest limits

- **Single-visit provisionality is intrinsic** — by design it's *reported*, not guessed away. A cheap future `dev confirm` walk can revisit addressable states to confirm templates automatically.
- Thresholds (80% shell, k-of-n core, similarity cut) are documented, evidence-defaulted tunables — knobs, not site rules.
- Heavily personalized/A/B surfaces shrink cores → majority-presence + self-heal absorb; worst case more escalations, never wrong-clicks.
- Canvas/a11y-hostile apps remain out of scope (detect + escalate, unchanged posture).
