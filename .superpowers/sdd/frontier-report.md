# `webnav dev frontier` — report

The upstream fix for "is exploration complete?" being *guessed* instead of
*measured*. progneo was explored by hand-picking targets and an obvious declared
surface (an account/model switcher sitting unopened in `_shell`) was missed.
`frontier` reports every declared affordance the map recorded an opener for but
never followed to a resolved state — a worklist the explorer drives to empty.

## Definition (all from stored data — zero LLM)

An affordance is on the frontier iff it is one of:

1. **`dangling-target`** — a `navigate` **or** childless `reveal` with
   `toState == null`. Opener recorded, destination never captured.
2. **`unopened-panel`** — a `reveal` whose `children` is null/empty. The panel
   contents were never recorded. (A reveal *with* children is already explored —
   its children carry the transitions, per the affordance model.)
3. **`ambiguous-action`** — a `mutate` or `input` whose label does **not** match a
   known in-place-action shape. It might open a new surface an explorer should
   verify (the account/model switcher is exactly this case).

**Never flagged** (already resolved / generalized):
- a `navigate` with `toState` set (resolved edge),
- a `reveal` **with** children (panel captured),
- a `mutate`/`input` whose label matches an in-place shape,
- any affordance with `scope: 'row' | 'widget'` (already a generalized template).

Reveal **children** are NOT recursed into — they are a node's exposed repertoire,
not separate openers. Only each state's top-level declared affordances are judged.

### The in-place-action shape list (the knob)

A `mutate`/`input` is treated as in-place (NOT frontier) when its label matches
any of these declared-evidence-only, case-insensitive patterns. This is the
tuning knob — too broad hides a real switcher, too narrow makes every button
scream "explore me". Tuned in `src/graph/frontier.ts::IN_PLACE_SHAPES`, never
downstream.

- **pagination** — `page`, `page size`, `first/previous/next/last page`
- **refresh / reload** — `refresh`, `reload`
- **sort / order** — `sort`, `ascending`, `descending`, `order by`
- **toggle / select / check** — `toggle`, `check(ed/box)`, `uncheck`,
  `select all`, `deselect`, `row selection`, `dark mode`, `light mode`, `legend`
- **dismiss / teardown** — `close`, `cancel`, `dismiss`, `done`
- **in-place view controls** — `secondary axis`, leading `remove`, `view all`,
  `expand drilldown`, `full screen`, `columns`, `functions`
- **search / filter inputs** — `search`, `filter`
- **form-fill inputs** — leading `enter `/`type `, `username`, `password`, `email`
  (an input fills a field; per the affordance model it never routes)
- **add-to-cart / add-X** — `add … to …`, `add an item`, leading `add`
  (the canonical declared in-place mutate; the empty cart is a valid state)

## Exclusions (caller-supplied — the map stays judgment-free)

Because the map holds no judgment, webnav does not know a site's hard "never
click" list. The caller (agent) passes it: repeatable `--exclude <label>`
(case-insensitive substring). A matched frontier item moves to `excluded[]`
(visible, off the worklist) rather than being dropped, so the exclusion is
auditable. No site names are hardcoded in `src/` (enforced by
`tests/guidelines.test.ts`).

## The verb

```
webnav dev frontier --node <host> [--exclude <label>]... [--json]
→ { status:'ok', node, total, frontier:[{state,kind,label,reason,hint}], excluded:[…], byState:{id:count} }
```

- **hint** — one human line per reason: `dangling-target` → "follow this to
  capture where it leads"; `unopened-panel` → "open this and record the panel
  contents"; `ambiguous-action` → "fire this and see if it opens a new surface to
  map".
- **Exit 0** = frontier empty (fully explored, minus exclusions). **Exit 3** =
  frontier non-empty (ran fine, work remains) — the ran-but-incomplete
  convention, same as `outline`/`mermaid`. Missing node → `status:'empty'`, exit 3.

## Verified live

| Check | Result |
|---|---|
| saucedemo (complete map) | `total 0`, **exit 0** — fully explored |
| progneo (hand-explored) | `total 29`, **exit 3** |
| progneo `--exclude "Switch to Classic"` | `total 28`, `excluded:["Switch to Classic"]` |
| missing node | `status:"empty"`, exit 3 |
| `dev frontier --help` | renders (self-describing) |

## The REAL progneo frontier — 29 items (27 ambiguous-action, 2 unopened-panel)

`byState`: `_shell:2 · announcements:2 · dashboard-category:5 · dashboard-list:3
· help-center:7 · report:6 · report-list:4`

```
[ambiguous-action] _shell             mutate  "O Overview Merged Change"   ← THE MISSED SWITCHER
[ambiguous-action] _shell             mutate  "Switch to Classic"
[ambiguous-action] announcements      mutate  "Feature release"
[ambiguous-action] announcements      mutate  "Update"
[ambiguous-action] dashboard-category mutate  "09 Jul 2026 - 10 Jul 2026 UTC"
[unopened-panel]   dashboard-category reveal  "09 Jul 2026 - 10 Jul 2026 UTC"
[ambiguous-action] dashboard-category mutate  "Customize"
[ambiguous-action] dashboard-category mutate  "CATEGORY"
[ambiguous-action] dashboard-category mutate  "SERIES"
[ambiguous-action] dashboard-list     mutate  "Test_demo - Jul 8, 2026 12:20 IST devbrat.r"   ‡
[ambiguous-action] dashboard-list     mutate  "Testuser - Jan 13, 2026 19:31 IST devbrat.r"   ‡
[ambiguous-action] dashboard-list     mutate  "New Dashboard"
[ambiguous-action] help-center        mutate  "Overview"
[ambiguous-action] help-center        mutate  "Working with Reports"
[ambiguous-action] help-center        mutate  "Downloading Data"
[ambiguous-action] help-center        mutate  "Viewing Dashboards"
[ambiguous-action] help-center        mutate  "FAQs"
[ambiguous-action] help-center        mutate  "Help Center"
[ambiguous-action] help-center        mutate  "Accessing the Interface"
[ambiguous-action] report             mutate  "Last 7 Days (CD) : 02 Jul 2026 - 08 Jul 2026UTC"
[ambiguous-action] report             mutate  "Download as formatted CSV"
[ambiguous-action] report             mutate  "Save Visualization"
[ambiguous-action] report             mutate  "Charts"
[unopened-panel]   report             reveal  "Last 7 Days (CD) : 02 Jul 2026 - 08 Jul 2026UTC"
[ambiguous-action] report             mutate  "New Report"
[ambiguous-action] report-list        mutate  "Owned/Shared"
[ambiguous-action] report-list        mutate  "Favourites"
[ambiguous-action] report-list        mutate  "Standard"
[ambiguous-action] report-list        mutate  "New Report"
```

**The switcher surfaces at the top of `_shell`** — the exact declared surface the
hand-exploration missed. The two `unopened-panel` reveals are the date-range
pickers never opened.

‡ **Honest note on data-value pollution.** Two `dashboard-list` items
(`"Test_demo - Jul 8…"`, `"Testuser - Jan 13…"`) and the help-center article
titles are DATA VALUES, not structure — per the settled principle the map should
store structure, never data values, so they should not be in the map at all.
That is an **upstream draft/recording defect**, not a `frontier` bug. `frontier`
honestly reports what the map actually stores; it does **not** scrub them
downstream (that would violate the fix-upstream HARD RULE and would require
webnav to *judge* "which mutate is a data instance" — LLM territory the map must
not enter). Fixing the pollution is a `draftFromEffects` change; when that lands,
these rows disappear from the frontier automatically.

## What was NOT expanded on the spec's prose expectation

The task's prose named "download Share/Copy" as expected frontier. In the CURRENT
stored map, `download-list`'s `Share` and `Copy` reveals **have children**
(`Share` children=5, `Copy` children=1), so by the definition they are
already-explored panels and are correctly NOT on the frontier. The definition is
the contract; the report follows the map's real state, not the prose.

## Files

- `src/graph/frontier.ts` — `computeFrontier(node, states, exclude)` (pure).
- `src/cli.ts` — parse + dispatch (exit 0/3).
- `src/cli-spec.ts` — self-describing `frontier` verb entry.
- `tests/graph/frontier.test.ts` — 11 unit tests (all definition rules + exclusions).
