# Learning the CORE of a website (beyond the navigation skeleton)

**Date:** 2026-06-13 · **Status:** spec for review (not yet built) · **Supersedes nothing; extends**
the affordance model (2026-06-09) and the draft flow (2026-06-13-graph-analyse-draft-design.md).

## Trigger

A fresh Haiku agent re-learned OrangeHRM end-to-end through webnav and produced a clean 5-state
map — but a coverage audit showed it captured **~1–5% of each page's declared interactive
elements**, all of them sidebar navigation links. The user's pushback reframed the goal three
times, and the third reframing is the real one:

1. page-to-page (where webnav started)
2. + in-page affordances (the 2026-06-09 affordance model)
3. **the FEATURES a site offers and how they INTERACT** — "a website isn't just navigation +
   in-page things, it's also how things interact with each other; the site gives features that
   *look like* nav + in-page to the agent but are more."

That third framing is correct and not pedantic: **a website is a domain model wearing a UI.**
OrangeHRM's value is *hire someone / take leave / clear the approval queue* — jobs over entities
(Employee, Leave Request, User) with relationships. Those features MANIFEST as nav + in-page
elements but are NOT reducible to them. A page map remembers "a node called `pim-employee-list`,
fingerprint `heading:PIM`" and discards everything that makes PIM *PIM*.

## The core is DECLARED — we just discard it (the key realization)

This must NOT become "webnav reasons about the domain" — principle **#5a** (webnav is zero-LLM,
judgment-free) holds absolutely. The trick that makes "learn the core" compatible with #5a:
**the core is declared in the markup.** Learning it = **stop discarding the observable skeleton**,
never interpreting it. Evidence from OrangeHRM's own captured snapshots
(`tests/fixtures/orangehrm-pim-table.yml`):

- **The PIM filter form (lines 99–140) is a typed query interface.** Its six fields — `Employee
  Name`, `Employee Id`, `Employment Status`, `Supervisor Name`, `Job Title`, `Sub Unit` — ARE the
  Employee entity's attributes and foreign keys. The `Job Title` / `Sub Unit` / `Employment Status`
  selects are populated from the *related* lookup entities (the dropdown options literally ARE the
  JobTitle / SubUnit / Status tables).
- **The table column headers (lines 150–190) are the entity's projected attributes** (`Id | First
  Name | Last Name | Job Title | Employment Status | Sub Unit | Supervisor`), and `(132) Records
  Found` says this is a *query result over a collection*, not "a page."
- **The row actions are the operations on an instance** (Edit/Delete per row; `Add` in the topbar
  names the entity; row is `cursor=pointer` → detail). Full CRUD + report, declared on one screen.
  `Delete` is a commit point (map by inference, never fire — #2).
- **The "Employee Name" column in the Admin → System Users table is the `User IS-LINKED-TO
  Employee` relationship** — surfaced as a column, not announced as a join.
- **The topbar sub-tabs** (Leave's Apply / My Leave / Assign Leave / Entitlements / Reports /
  Configure; Admin's User Management / Job / Organization / Qualifications) are **workflow entry
  points**, not pages.

A page map throws ALL of this away. The fix surfaces it as **evidence tied to a state**; the
calling agent reads the evidence and reconstructs the domain model in ONE cheap pass — which is
exactly the token/wall-clock cost webnav exists to kill, applied one level up.

## The hard line (#5a) — STORE the observable, never INTERPRET

| webnav CAN capture (observed/declared) | webnav must NOT do (agent's judgment) |
|---|---|
| Full per-state affordance repertoire (mutate/reveal/input/commit), not just navigate edges | Decide what an entity MEANS or name its purpose |
| Entity SHADOW: table columns, filter-field names + dropdown option-sets, Add-button entity name | Infer business rules ("can't approve leave > entitlement") |
| Workflows as multi-step routes with declared precondition + commit flag + outcome fingerprint | Rank/recommend features; name a workflow's purpose |
| Cross-state coupling edges (feeds/governs/gates), RECORDED never auto-fired | Classify a button destructive by reasoning (→ needs-classification / pre-tagged) |
| The repeated UI template (filter+Add+table+row-actions+pagination) as a structural pattern | Any LLM call, any per-goal scoring rubric |

The CORE-as-meaning lives in the calling agent; webnav stores the **observable skeleton of that
core** richly enough that the agent reconstructs the semantics cheaply instead of re-deriving them
from a pile of buttons on every run.

## Observe vs. DO (principle #1 — observe first, traverse rarely)

Most of the core is readable from a single snapshot; one class is not. This split decides which
parts the record flow harvests passively vs. which need an explicit before/after capture:

- **Observable by READING (declared — pure snapshot text):** the entity shadow (columns / filter
  names / Add-button entity / sub-tab labels); `config-governs-control` (a Leave Type dropdown's
  options and the Leave-Types admin list share a vocabulary — readable across two snapshots);
  `selection-gates-bulk-action` (a "Delete Selected" ships `disabled`/`aria-disabled` until rows
  are checked — the gate is in the markup); a quantitative gate's EXISTENCE (Apply-Leave displays
  an entitlement `max` — the gate is declarable; the bound value is fresh data, never stored).
- **Only learnable by DOING (a safe, reversible action + before/after diff):** `data-availability`
  couplings — adding an Employee in PIM makes that name appear in Leave's "Assign Leave" picker.
  Nothing on the Assign-Leave page declares where its async options come from; the edge can only be
  established by creating an employee (reversible → safe per #1) and observing it appear. This is
  the one class of core knowledge that genuinely requires *doing*, and it's the most valuable to
  store once learned (expensive to rediscover, can't be re-derived from one snapshot).

## Why the current learn captured none of this (Q2 — three layers, none is "learning broke")

0. **The richer 12-state map the user remembers was HAND-BUILT via raw `sqlite3`** (seed machinery
   now deliberately removed). "What we know about OrangeHRM" never came from the flow — it came from
   manual authoring, which is *why* the rebuild makes record→analyse the source of truth. Even the
   hand-built version was only a page-graph (every edge "Dashboard") — manual authoring ALSO missed
   the entity/workflow/coupling layers, because there was no schema slot for them.
1. **Coverage:** the recorded session was 7 actions — login + 4 sidebar clicks. ZERO in-page
   actions performed → zero in-page effects to learn. "Map the modules" was conflated with "use the
   modules." Session-recipe gap, not a webnav bug.
2. **Pipeline:** even a perfect recording would be filtered to the nav spine. `draftFromEffects`
   (`src/explorer/draft.ts:121–150`) survives only `navigated → navigate` and `non-navigated
   textbox → input`; every other effect `return`s early and vanishes. Structurally navigate-only.

Two independent reasons, each sufficient. Both must be fixed.

## Design — four layers, sequenced

### Layer 1 — Capture the full affordance repertoire (no new schema; highest leverage)

The `Affordance` type ALREADY supports `mutate`/`reveal`/`input` + `commit` + `children`
(`src/mapstore/types.ts:15–38`). The gap is purely that the learning flow drops them. Two changes:

- **Recipe (fixes Q2-A):** the mapping agent must EXERCISE each landing page, not just visit it —
  run a filter, sort a column, open a sub-tab, open a row's actions, open the profile/overlay menu,
  press Add (then cancel — reversible) — and return to the hub. Encode this as the documented
  record loop (the draft-design spec already mandates "click into each section + back"; extend it to
  "and exercise each section's repertoire"). This is instruction/recipe, NOT code.
- **Pipeline (fixes Q2-B):** in `draftFromEffects`, stop early-returning non-navigating effects.
  First widen `DraftAffordance.kind` from `'navigate' | 'input'` to all four (`+'mutate' | 'reveal'`)
  and add an optional `children?: DraftAffordance[]` (review blockers #7) — today it can't even
  represent the new kinds. Then, instead of the textbox-only early return at `draft.ts:127–131`,
  branch on the recorded effect (`StoredActionEffect.diff` already carries `{added, removed}` — review
  confirmed it's sufficient):
  - a non-login `use type` (textbox) → an **`input`** affordance (today only login textboxes survive).
  - a non-navigating click with an `elementFp` and `diff.added.length === 0` (page changed in place,
    nothing newly appeared) → a **`mutate`** affordance.
  - a non-navigating click with `diff.added.length > 0` (an overlay/menu opened) → a **`reveal`**
    affordance whose `children` are the **added nodes that carry an ARIA role in {button, menuitem,
    link, tab, checkbox, combobox, textbox} AND a name** — extracted as `{role, name}` only, NEVER an
    inferred purpose. If an added node has no resolvable role/name, it is NOT synthesized — it is left
    for the agent (a diff report), never guessed (review #2, #9). Self-verify each child via
    `resolveByFingerprint` against `e.toSnapshot`; drop children that don't resolve.
- **Interior-synthesis pass — STRICT ARIA predicates, zero layout inference (review #1, #13).** A
  per-page pass (parallel to the cross-link mesh) scans each landing snapshot's OWN declared
  interactive nodes and synthesizes affordances for declared-but-unclicked structure, by EXACT role:
  - `role ∈ {textbox, combobox, checkbox}` with a name → **`input`** affordance.
  - `role = button` with a name → **`mutate`** affordance.
  - `role = link` to a known state → already handled by the cross-link mesh (skip).
  - **The only signal is the ARIA role + accessible name. webnav NEVER infers from layout, position,
    proximity, color, or grouping** (the refuted-but-bounded review #13: no "buttons near a form are
    filter actions" heuristic — that's interpretation). A button is a `mutate`; what it mutates is the
    agent's call. Over-synthesis is harmless (agent curates); layout-guessing is forbidden.
    Self-verify each via `resolveByFingerprint`; skip if an affordance for that element already exists.
- **Commit candidates flagged, never set (review #12, #2/#5a).** A new `needsClassification?: boolean`
  on `DraftAffordance`: set when an affordance's declared name matches a conservative commit-word set
  (`/\b(delete|remove|save|submit|confirm|place order|pay|apply)\b/i`) — this is a STRING match on the
  declared label surfacing a CANDIDATE, not a judgment. `commit` stays `false`; the agent classifies.

This alone moves OrangeHRM from a sidebar star to nodes with real interiors. (Review note: blockers
#7–#11 are this layer's IMPLEMENTATION checklist — `DraftAffordance` kind widening, the three-way
effect branch, the diff-based reveal, the interior pass — not doc defects; they're listed in the
build order below as Layer-1 acceptance criteria.)

### Layer 2 — Entity/relationship SHADOW as evidence (new field; read-only)

Add to `State` a judgment-free evidence container, populated from declared structure:

```ts
// on State — declared domain shadow, EVIDENCE not interpretation (#5a). The agent reads
// this and reconstructs the entity model; webnav never names an entity or asserts a relation.
declaredShadow?: {
  collections?: { heading: string | null; columns: string[]; recordCount: number | null }[]; // tables
  filters?: { field: string; control: 'text'|'select'|'date'|'checkbox'; options?: string[] }[]; // query interface
  createsEntity?: string | null;   // the Add-button's owning heading text, verbatim (e.g. 'Employee Information')
  subTabs?: string[];              // topbar tab labels (workflow entry-point names), verbatim
} | null;
```

Everything here is a verbatim declared string. The repeated-column / shared-option-set
*relationships* are LEFT FOR THE AGENT to spot across states — webnav just records the columns and
options. (No `Entity`/`Relationship` type in webnav — that would be interpretation.)

### Layer 3 — `Workflow` as a first-class object (new type)

A workflow is a named, ordered composition over EXISTING affordance/state ids — the "feature" the
site offers. The schema has `State` and projected `Edge` but no home for a job-to-be-done:

```ts
export interface Workflow {
  name: string;                 // verbatim/agent-named, e.g. 'apply-for-leave'
  site: string | null;
  precondition: string | null;  // declared required start-state id / role (e.g. 'logged-in-employee')
  steps: { state: string; affordance: string }[];  // ordered (state, affordance-id) pairs
  commitStep: number | null;    // index into steps of the irreversible commit (mapped, never fired)
  outcomeFingerprint: string[]; // how you recognize success (e.g. a 'pending request' row appears)
}
```

**Authoring is AGENT-judged, never webnav-projected (review #2 — #5a).** webnav must NOT decide that
a recorded sequence "IS a coherent feature" — that's interpretation. Instead: webnav records the raw
session (the ordered `(state, affordance)` pairs the walk/record already produces); a `dev workflow-add`
verb takes a session id (or an explicit step list) plus the agent-supplied `name`, `precondition`, and
`commitStep`, and persists the `Workflow`. webnav does the mechanical parts only — resolve step ids,
capture the `outcomeFingerprint` from the final landing snapshot, validate that each `(state,affordance)`
exists. The "is this a meaningful workflow?" judgment stays with the agent. The walk can then REPLAY a
stored workflow (precondition gates it; the commit step pauses for classification — #2).

**Persistence (review blocker #5):** a new `workflows` table — `(name PK-with-site, site, precondition,
steps JSON, commit_step INT, outcome_fingerprint JSON)`; `MapStore.migrate()` adds it idempotently
(`CREATE TABLE IF NOT EXISTS`), matching the existing migration pattern (`store.ts` migrate). `IMapStore`
gains `upsertWorkflow`/`getWorkflow`/`listWorkflows`. The Layer-3 build MUST include a migration test
(an old DB opens and gains the table without data loss).

### Layer 4 — Cross-state coupling relation (new relation; one kind needs DOING)

`Affordance.needs` is same-state; `Edge.requiresAffordances` is same-state; `NodeEdge` is
inter-site. There is NO cross-STATE dependency edge. Add one, judgment-free, recorded-never-fired:

```ts
export type CouplingKind = 'feeds' | 'governs' | 'gates' | 'enables';
export interface Coupling {
  fromState: string; fromAffordance: string;   // the source feature
  toState: string;   toAffordance: string;     // the dependent feature
  kind: CouplingKind;                           // declared/observed relationship, never a business rule
}
```

`governs`/`gates`/`enables` are read from snapshots (Layer-2-adjacent). `feeds` (PIM Add →
Assign-Leave picker) is the DOING case: established by a safe-reversible before/after diff in the
record flow, then stored. webnav records that the coupling EXISTS; the agent decides whether to
satisfy it.

**Matching is EXACT, never fuzzy (review #3 — keeps `feeds` observational).** `feeds` is established
ONLY when a value typed into a Layer-1 `input` affordance (webnav already captured what was typed)
reappears as an **exact-string** new option/row in the target state's after-snapshot. Fuzzy or
delay-dependent matches are NOT guessed — they surface as a coupling-CANDIDATE for the agent. If the
coupling is async and the immediate after-snapshot misses it, that's the agent's cue to re-record with
a wait step. webnav never invents a coupling from a partial match.

**Persistence (review blocker #5):** a new `couplings` table — `(from_state, from_affordance, to_state,
to_affordance, kind, UNIQUE(from_state,from_affordance,to_state,to_affordance))`; added in
`MapStore.migrate()` (`CREATE TABLE IF NOT EXISTS`). `IMapStore` gains `upsertCoupling`/`couplingsFrom`.
Migration test required, as for Layer 3.

## Contract-package implication (must not skip)

`State`, `Affordance`, `Edge`, `NodeEdge`, and **`MapPack`** are exported from `src/contract.ts` and
published as `@dikshanty94/webnav`; **webnav-site imports these types** (e.g. `lib/metering.ts` consumes
`MapPack`). The factory functions (`makeState`/`makeAffordance`/`makeEdge`) are NOT exported — they're
internal, so changing their defaults is safe (review #4). Rules to stay backward-compatible:

- **Layer 1 — NO contract change** (uses existing affordance kinds; `DraftAffordance` is internal to
  `src/explorer/draft.ts`, not exported).
- **Layer 2** — `declaredShadow?` is an OPTIONAL field on `State`; `makeState` defaults it to `null`
  (`init.declaredShadow ?? null`). Optional ⇒ a types-only consumer is unaffected.
- **Layers 3–4** — `Workflow` and `Coupling` are NEW exported types, and **`MapPack` carries them as
  SEPARATE optional top-level fields** (`workflows?: Workflow[]`, `couplings?: Coupling[]`) — NOT nested
  inside `states`/`edges` (review #6). This keeps existing `MapPack` parsing valid and lets webnav-site
  adopt them when ready. A MINOR version bump (e.g. 0.3.0) on release suffices — all additions are
  optional, none break a current consumer.

## Build order (doc reviewed 2026-06-13; 12/14 findings folded in — Layer 1 first)

1. **Layer 1** — recipe + pipeline (no contract change). **Acceptance criteria (= review blockers
   #7–#11, the implementation checklist):**
   - widen `DraftAffordance.kind` to all four + add optional `children` (#7);
   - replace the textbox-only early return with the three-way branch — input / mutate / reveal —
     using `StoredActionEffect.diff.added` (#8, #9, #11);
   - reveal children synthesized ONLY from added nodes with an ARIA role+name, self-verified via
     `resolveByFingerprint` (#9);
   - the strict-ARIA interior-synthesis pass (#10);
   - `needsClassification` flag on commit-word matches, `commit` stays false (#12).
   TDD in `draft.test.ts`: a recorded non-navigating click → `mutate`; a menu-open effect
   (`diff.added` non-empty) → `reveal` with resolvable children; a filter form on a landing page →
   synthesized `input`s; a "Delete" affordance → `needsClassification:true`, `commit:false`. Then
   re-run the Haiku learn with the exercise-each-section recipe; expect node interiors, not a sidebar
   star. **HIGHEST leverage, smallest change, unblocks the rest.**
2. **Layer 2** — `declaredShadow?` on `State` (read-only; optional contract field; `makeState` default
   `null`). Bump package minor.
3. **Layer 3** — `Workflow` type + `workflows` table + `MapStore.migrate()` + migration test +
   `dev workflow-add` (agent supplies name/precondition/commitStep) + walk replay. `MapPack.workflows?`.
4. **Layer 4** — `Coupling` type + `couplings` table + migration test; `governs/gates/enables`
   (snapshot-read) first, `feeds` (exact-match before/after diff in record flow) last. `MapPack.couplings?`.

Each its own increment on its own worktree, merged when green, contract bumped (minor) where touched.

## Honest scope / non-goals

- NOT an ORM/schema reconstructor — webnav stores declared shadows; the agent builds the model.
- NOT business-rule inference — quantitative gates are recorded as "a max is displayed," never as
  the rule. Fresh values (the actual balance, the 132 records) are NEVER stored (they change).
- NOT auto-classification of commits — Delete/Save/Apply surface as candidates; the agent decides.
- The `feeds` coupling is the only part that requires DOING; everything else is observe-first (#1).
