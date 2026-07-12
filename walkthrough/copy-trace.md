# Copy trace — every on-screen sentence → the map facts it derives from

Per the standing brief §1/§6: the GRAMMAR is ours, the FACTS are the map's. Every
on-screen word below traces to a stored heading, affordance, column, or filter in
`walkthrough/map.json` (node `progneo.analytics.mn`, 8 states). The derivation RULES live
next to the data in `src/mapData.ts` (`displayName`, `tiersFor`, `purposeSentence`,
`shellDestinations`); this file is the human-readable audit of the result.

## Display names (§1) — from the product's own heading token

| On screen | Derived from (map fact) | Rule |
|---|---|---|
| Reports | `report-list.fingerprint = ["heading:Reports"]` | `displayName` reads `heading:` fp |
| Dashboards | `dashboard-list.fingerprint = ["heading:Dashboards"]` | same |
| Downloads | `download-list.fingerprint = ["heading:Downloads"]` | same |
| Help Center | `help-center.fingerprint = ["heading:Help Center"]` | same |
| Announcements | `announcements.fingerprint = ["heading:Announcements"]` | same |
| The report builder | `report` state has NO heading fp; role `detail`, parent `report-list` | composed name (parent+role), still map-derived |
| The dashboard viewer | `dashboard-category` has NO heading fp; role `detail`, parent `dashboard-list` | composed name |

No technical id (`report-list`, `_shell`, urlPatterns, state ids) is ever shown.
`displayName` strips any `nodeId:` prefix so a state ref never leaks the node-prefixed id.

## Cold open one-liner (§5.1)

> "Reporting for publishers — Reports, Dashboards, Downloads, Help Center, Announcements."

- "Reports, Dashboards, Downloads, Help Center, Announcements" = `shellDestinations()` — the
  navigate affordances of `_shell` (`sh_234..sh_238`), each rendered by `displayName`.
- "Reporting for publishers" = the product's self-description in the Help Center Overview
  still (4-help-center.png: "the redesigned reporting environment … for publishers"). It is
  the product's own framing, not a marketing superlative.

## Orientation area strip (§5.2)

> Reports · Dashboards · Downloads · Help Center · Announcements

- All five = `shellDestinations()` (the `_shell` navigate affordances), via `displayName`.
- The live clip (`clip-nav`) shows the real move Reports → Dashboards (the recorded session).

## Purpose sentences (§1) — every noun/verb traces to an affordance / filter / column

| State | Sentence | Facts it derives from |
|---|---|---|
| Reports | "Find any report by name, switch between Standard, owned and favourite views, or start a new one." | Search input (`inp_search`) · tabs `Standard`/`Owned/Shared`/`Favourites` (`aff_168/165/167`) · New Report (`aff_182`) |
| The report builder | "Shape a view with dimensions, metrics and filters, read it as a table or charts, then download or schedule it." | reveals `Add dimensions`/`Add metrics`/`Add filter` (`aff_126/128/131`) · tabs `Table`/`Charts` (`aff_112/106`) · `Download as formatted CSV` (`aff_98`) · `Save As / Schedule` (`aff_141`) |
| Dashboards | "Browse your dashboards, open one to read its charts, or build a new one." | dashboard row links → `dashboard-category` (`aff_40`) · New Dashboard (`aff_35`) · viewer has a chart (dashboard-category) |
| The dashboard viewer | "Read a dashboard live, adjust its date range, and share it with your team." | date-range button (`aff_7`) · Share reveal (`aff_24`, children incl. team-member search + Share) |
| Downloads | "Track your exported files, switch to ones shared with you, and share or re-download any of them." | Owned/Shared tabs (live in clip) · Share reveal (`aff_67`) · Status column (download rows) |
| Help Center | "Search the guides or jump to a topic — reports, downloads, dashboards and FAQs." | Search help input (`aff_220`) · topic buttons `Working with Reports`/`Downloading Data`/`Viewing Dashboards`/`FAQs` (`aff_222/223/224/225`) |
| Announcements | "See product updates and feature releases, filtered by type." | Search input (`aff_228`) · filters `Feature release`/`Update` (`aff_229/230`) |

## Tiers (§2) — derived by `tiersFor`, three visibly distinct levels

Rule (in code): **Tier 1** = create verbs (`New …`) + build reveals (`Add …`) + the page's
`Search` input. **Tier 2** = remaining named reveals/mutates, themed (Get it out / View it /
Organise). **Tier 3** = one summary line for `scope:'row'|'widget'` + pagination-shaped labels.

| State | Tier 1 (large, accent) | Tier 2 (grouped) | Tier 3 (summary) |
|---|---|---|---|
| Reports | Search, New Report | Organise: Owned/Shared, Favourites, Standard | plus per-row actions and list controls |
| The report builder | Add dimensions, Add metrics, Add filter | Get it out: Download as formatted CSV, Save Visualization, Share, Save As / Schedule · View it: Charts, Table, Functions, Columns · More: Remove | plus list controls |
| Dashboards | Search, New Dashboard | — | plus list controls |
| Downloads | Search | Get it out: Share, Copy | plus per-row actions and list controls |

Every Tier-1/2 label above is an affordance `label` in the state (data-values like specific
dashboard names + timestamps, and shell chrome, are filtered by `looksLikeDataValue` /
`isShellChrome` so they never appear as a capability).

## Live clip captions (§4) — one intention each, from the recorded action

| Clip | Caption | Recorded action (clips.md) |
|---|---|---|
| clip-nav | (orientation) | lands on Reports, clicks Dashboards in the nav |
| clip-reports | "Searching for a report by name" | clicks Search, types "Device", clears it |
| clip-open-report | "Opening a report" | clicks the "OS and Device Report" row → builder |
| clip-builder | "Adjusting a report's dimensions" | settled report; opens a dimension chip's menu |
| clip-dashboards | "Opening a dashboard" | clicks the "Testuser" dashboard → chart renders |
| clip-downloads | "Switching to files shared with you" | clicks the Shared tab (Owned → Shared) |

## Close (§5.4)

> "Learn more in the Help Center" · "generated from the product's webnav map · 8 states, built by observation"

- "Help Center" = `displayName('help-center')` (heading fp).
- "8 states" = `Object.keys(STATES).length` from the map. Provenance line per §5.4.
