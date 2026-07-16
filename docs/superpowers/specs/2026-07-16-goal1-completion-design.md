# Goal-1 completion — X4/X5/X7/X8/X9 + X6-human, validated on the analytics SPA (2026-07-16)

> Closes every remaining category-(a) gap in `2026-07-12-structure-coverage-matrix.md`, then
> proves "record everything, miss nothing" with REAL recordings on the analytics SPA. User-approved
> ("Finish whatever is needed to achieve goal 1, do actual recordings on the analytics SPA").
> Matrix rows carry the per-gap detail; this spec fixes the decisions.

## X9 — file-upload primitive (smallest)

`playwright-cli upload <file>` exists. `PlaywrightAdapter.upload(file: string)` wraps it.
Agent-session gains an `upload` command (`{cmd:'upload', file}`): runs adapter.upload after a
`click` on the file-input trigger is NOT required by playwright's model (upload targets the
chooser opened by the LAST action) — implementer verifies playwright-cli's exact semantics via
its help/behavior and records an ActionEffect (same-page mutate evidence, `action:{upload:true,
name:<file basename — never the full local path>}`) + ledger event. The map stores that an
upload happened as STRUCTURE (an upload-capable affordance), never file contents or full paths.

## X4 — guarded/conditional redirects: alias only when reproduced

Today `draftFromEffects` (draft.ts:523-532) aliases requestedKey→settledKey on ONE observation
(host-guarded only). Change:
- An alias needs REPRODUCTION: ≥2 observations of the same requested→settled pair (any session)
  OR the settled key equals the requested key's own landing evidence elsewhere.
- A single-observation pair: no alias; the requested key stays a dangling/provisional edge and
  the draft's `receipt.requests` asks to re-drive it (the existing confirm-visit idiom).
- CONTRADICTION (same requested key observed settling on ≥2 different keys): no alias, emit a
  `needsFix` entry naming both settleds (guarded redirect — auth/state-dependent), never silent.
- The existing foreign-host (SSO-wall) guard stays.
Acceptance: all three real-corpora acceptance tests stay green — the analytics SPA's known-good aliases
must still form (they repeat across sessions), and a synthetic single-shot alias must not.

## X7 — structural settledness for live regions

Settledness/stability today compares raw snapshot text; ticking dashboards never settle.
- New pure `structuralSignature(nodes: SnapNode[]): string` — role+name tree shape EXCLUDING
  (a) subtrees under `log`/`status`/`marquee`/`timer`/`alert` roles (declared live regions) and
  (b) text-only churn (a node's name change with identical role/position counts as churn ONLY
  for value-bearing leaf roles — keep it structural: signature uses role skeleton + names of
  INTERACTIVE nodes only, not headings/text).
- Wire where consecutive-sample stability is judged: `settleSnapshot` (browse.ts) gains
  signature-equality as its settle condition between retries (a page whose consecutive samples
  differ only inside live regions counts as SETTLED); the walk's non-hydration/stable-snapshot
  check and live-record's `classifyReadiness !== 'loading'` gate stay as-is (classifyReadiness
  is single-snapshot readiness, different concern — do not conflate).
- Honest limits: a page whose INTERACTIVE structure genuinely churns still escalates as today.

## X8 — baseline-presence precedence for overlay roles

In the draft's overlay/transient analysis: a `menu`/`listbox`/`dialog`-role subtree that is
PRESENT in the page's settled baseline landing face is page/shell structure — it must never be
classified as a transient overlay nor its items folded as overlay value-selections (AntD
persistent sidebar menus). One explicit precedence check where transient/overlay sets are built
(`transientByPage`/`openedOverlay` region, draft.ts ~1055/1200). Grammar test: AntD-style
persistent role=menu sidebar → nav affordances, not overlay children; the same menu appearing
ONLY after a click stays an overlay.

## X5 — container-scoped folding for nested value domains

Per the standing `ponytail:` follow-up (draft.ts ~186-199): give `subtreeFolds` a
CONTAINER-SCOPE grouping pass — ≥3 same-role/depth leaf siblings split across heterogeneous
per-category wrappers WITHIN one owning container (tag-picker triggers, dialog day-grids) fold
to that container's value domain instead of leaking into the page repertoire. Success = the
`enumeratedNames` fallback narrows further or deletes (its comment names this exact pass);
existing overlay/value-domain grammar tests stay green; new fixture: tags-in-trigger + day-grid
in dialog → ONE value-domain affordance each, zero per-value affordances.

## X6-human — idle-tick landing probe

The human tick loop probes ONLY on idle ticks (a tick that drained ZERO events and has no
pendings), budgeted ≤3 refs per idle tick, resuming across idle ticks until the current
landing's nameless refs are done (cap 16 total, same as agent path); any drained event aborts
the in-progress budget immediately (human latency wins). Hints attach to the landing's most
recent stored effect via a new `RecordStore.mergeNameHints(session, seq, hints)` (upsert into
the effect's name_hints). Off switch: `WEBNAV_NO_IDLE_PROBE=1`. Honest limit: a page the human
leaves quickly may stay unprobed — the structure audit surfaces it.

## The analytics SPA validation (the proof — REAL recordings)

Standing rules: NEVER click Admin or Switch-to-Classic; headless; ONE browser; serial sessions;
distinct profile reuse (existing logged-in profile); CF first-load-per-session pattern; reap
after. Real db (`~/.webnav/webnav.db`) — recordings are additive and review-gated before any
graph merge; no map edits without the gate.
1. `dev frontier --node app.example.com` → worklist.
2. Record fresh agent sessions over the frontier + the main viewing pages; run `dev hover-probe`
   (and `--right-click`) on each major page inside the session.
3. Audits: `dev review --session` per session (structured; coverage + LANDING STRUCTURE must
   show ≈0 nameless controls on key pages); draft `--draft` unknowns list empty or each
   explained; ledger coverage: dropped events enumerated and explained.
4. "Not missing anything" verdict = structure audit + review gaps + unknowns + frontier delta,
   reported honestly with evidence — including anything STILL missed (that becomes the next
   increment, not a cover-up).

## Out of scope

Canvas (X12), drag-and-drop (X13), cross-origin embeds (X14) — posture unchanged (map
fallbacks, escalate honestly). Firing context-menu items. Any LLM inside webnav.
