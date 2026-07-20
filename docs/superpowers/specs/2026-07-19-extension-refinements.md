# Extension refinements — user feedback round 2 (2026-07-19)

> Six items from live use of the agent sidebar. Five are UI/rendering (webnav-extension/);
> one (#3a) is a real backend wiring fix (agent-serve ignores authored maps). Regression fence
> from the polish/hardening passes still applies — do not touch execAction/SSE/mode/approve-deny/
> stop/pause/token-auth/goto behavior.

## #1 — Enter to send (likely ALREADY works; verify + harden)
`sidepanel.ts:724-726` ALREADY does: plain `Enter` (no shift, not composing) → `preventDefault()` + `startRun()`. So plain Enter SHOULD send. If the user still had to click, they were on a pre-polish build (reload needed) OR a focus/guard edge. ACTION: verify the handler is correct and unconditional (fires whenever the composer is focused); if solid, this is a reload issue — note it. Do NOT regress Shift+Enter=newline or the IME guard.

## #2 — Ask / Auto / Act difference not clear in the UI
The 3-mode switch has only a shared `title` tooltip. Make the distinction legible IN the panel:
- Under/next to the mode switch, show a ONE-LINE description of the CURRENTLY-selected mode that updates on switch. Exact copy:
  - **Ask** — "Shows a plan and waits for your approval before doing anything."
  - **Auto** — "Runs on its own; asks before navigating to a new site."
  - **Act** — "Runs fully autonomously (commit points still pause)."
- Keep it subtle (small, --ink-faint), one line, in the composer area. Update it in `applyMode`.

## #3a — TRUE CAUSE FOUND: account-id URL mismatch, not a db/wiring bug (investigated 2026-07-19)

Investigation result (do NOT re-investigate the db — settled): webnav.db HAS 12 authored the analytics SPA
states and agent-serve DOES load them (`new MapStore()` = same `dbPath()` both for `graph-analyse`
and agent-serve; `allStates()` returns all 47 incl. the analytics SPA). So it is NOT a "seed-only" or
"wrong db" bug — my earlier hypothesis below was WRONG, kept only for history.

**The real cause:** the map was recorded on account path `/v3/9999/…` (e.g.
`app.example.com:report-list` → `.../v3/9999/report/list`), but the user was browsing
`/v3/9999/report/list` — a DIFFERENT account id in the path. `check_route`/`matchState`'s
URL-template comparison treats `9999 ≠ 8888` as different states, so no start state matches → the
agent honestly says "no map." Same site, same page type, different account segment.

**FIX (the correct, valuable one):** URL-template matching should parameterize the volatile
account/id path segments so `/v3/{account}/report/list` matches regardless of the account number.
This is squarely the project's settled "URL-template × structural-template" identity model
(CLAUDE.md structure-inference: URL is an ATTRIBUTE, a template with variable segments — not a
literal). Concretely:
- Find where states carry their URL pattern/template and where matchState / check_route / findPath
  compare a live URL to a state's URL (grep `urlPattern`, `template`, `matchState`, and any URL
  compare in `src/router/` + `src/explorer/fingerprint.ts` + `src/mapstore/`). The design intends a
  TEMPLATE with `{var}` segments; verify whether templates are being stored/derived with the
  numeric account segment as a literal (the bug) vs a variable.
- Make the comparison treat numeric/opaque id path segments (the `1041`/`1033` and per-report ids
  like `/report/7001/…`) as WILDCARDS when matching a live URL to a stored state's template —
  so a state recorded on account 9999 matches the same page on account 8888.
- This is an UPSTREAM fix (CLAUDE.md: fix the producing logic, not a downstream scrub). If templates
  are derived at record/draft time, the durable fix may be in template derivation (`draftFromEffects`
  / structure inference) AND/OR in the match-time comparison. Prefer the match-time normalization if
  it's safely site-agnostic (numeric/hex path segments → wildcard); do NOT hardcode the analytics SPA.
- Keep zero-LLM. After the fix: on `/v3/9999/report/list` with the 9999-recorded map, check_route
  should MATCH the report-list state (or honestly report the specific structural miss if the page
  genuinely differs — but the account number alone must NOT cause a miss).
- ⚠️ This is the meatiest item — if it's larger than a match-time normalization, the implementer
  should report scope and we split it out. The other 5 items (UI) do NOT depend on it.

### (historical / WRONG hypothesis — kept for the record)
Earlier guess below assumed agent-serve only saw the seed; investigation disproved it (the analytics SPA IS
loaded). Ignore the "load the authored map" framing — the map is already loaded; the issue is
template matching across account ids.

## #3a-OLD — agent-serve must use the AUTHORED map, not just the seed (DISPROVEN — see above)
`src/cli.ts` agent-serve `onGoal` builds `states` from `ensureSeeded(mapStore); mapStore.allStates()`. `ensureSeeded` (graph/seed.js) loads ONLY saucedemo + the GitHub skeleton. The user's RECORDED maps (the analytics SPA, OrangeHRM, etc.) live in the SAME `webnav.db` (MapStore default `dbPath()`), authored via `dev record`/`graph-analyse` — but `check_route`/`matchState` only see the seeded states, so on the analytics SPA it correctly-but-uselessly says "no map."
FIX: agent-serve should load the FULL authored map from `webnav.db`, not force-reduce to the seed.
- `new MapStore()` already opens `webnav.db` (dbPath default) and `allStates()` returns EVERYTHING in it (seed + authored). So the fix is: still call `ensureSeeded(mapStore)` (harmless — ensures saucedemo exists) BUT `states = mapStore.allStates()` ALREADY returns the authored the analytics SPA states too IF they're in webnav.db. VERIFY: are the user's `dev record` maps written to the same `webnav.db` MapStore that agent-serve opens? Grep how `graph-analyse`/`draftFromEffects` persist states (which store/db). If authored states ARE in webnav.db, then `allStates()` already includes them and the bug is elsewhere (e.g. matchState fingerprint miss on the the analytics SPA landing) — investigate and report the TRUE cause. If authored states are in a DIFFERENT db/table than what MapStore opens, wire agent-serve to load that too.
- Either way: after the fix, on `https://app.example.com/v3/9999/report/list` with an authored the analytics SPA map present, `check_route`/the agent should find the map (or honestly report why a specific state didn't match — a fingerprint miss is a real answer, "no map at all" is the bug).
- This is the recall payoff finally reaching the user's own sites (for VIEWING flows already recorded). Keep zero-LLM: check_route stays matchState+findPath.

## #3b — the `mcp__webnav__check_route` label leaking to the UI
Not a bug, but confusing. The Agent SDK exposes webnav's tools as an in-process MCP server (`createSdkMcpServer({name:'webnav'})`, loop.ts:195), so tool names get the `mcp__webnav__` prefix internally. That raw string is showing in the panel's action narration. FIX (presentation only): in the narration (loop.ts narrate labels + sidepanel.ts narrateAction / the tool_use rendering), show a FRIENDLY name — strip the `mcp__webnav__` prefix and humanize (e.g. `check_route` → "checking the map", `get_page_ax` → "reading the page", `click`/`type`/`goto` already friendly). Never surface `mcp__webnav__*` to the user. Do NOT change the actual tool wiring (the prefix is required for the SDK allowedTools).

## #4 — all tool-call lines render blue
Investigate: `.msg.action .verb` (sidepanel.html:208) — what color is the verb? If every action verb uses `--accent` (blue) regardless of action type, that's the "all blue." Make the ROUTINE actions (read/click/type) use a calm neutral (--ink-soft / --ink-faint), reserving the accent (blue) ONLY for the LIVE/current action (`.msg.action.live` already exists) or a meaningful highlight. Result: the trail-log reads as calm neutral history with the current step accented — not a wall of blue.

## #5 — Claude's reply shows raw markdown (`**bold**`, backticks, lists)
`assistantBubble.textContent += e.text` (sidepanel.ts turn handler) renders RAW text, so `**x**`/`` `code` ``/`- item` show literally. FIX: render the assistant's streamed text as light markdown. Constraints: streaming (text arrives in deltas), CSP (no external lib — write a TINY safe inline renderer or accumulate + re-render on each delta). Support the common subset: **bold**, *italic*, `inline code`, ``` code blocks ```, `- ` / `1.` lists, line breaks. MUST be XSS-safe (escape HTML first, then apply markdown to the escaped text — never innerHTML raw model output). Simplest safe approach: keep a per-bubble raw-text buffer; on each delta, escape it, run a small regex markdown pass, set innerHTML of the bubble. Keep the copy-button-in-endTurn working (copy should copy the RAW text, not the HTML). Apply to assistant bubbles AND the done summary (#6).

## #6 — the "Done" bubble is too loud + doubled + maybe unnecessary
Currently `bubble('done', 'Done — ' + e.summary)` in a green-background/green-border box (`.msg.done`). Problems: (a) "Done — Done. ..." doubles because Claude's summary already starts with "Done"; (b) the big green panel is too heavy for a routine completion.
FIX:
- DROP the "Done — " prefix. The summary IS the completion message; render it as-is.
- Make completion SUBTLE: render the final summary as a normal ASSISTANT-style message (same treatment as Claude's prose, markdown-rendered per #5), with at most a small, quiet ✓ affordance or a thin top-rule — NOT a filled green box. Reserve loud color for ERRORS only.
- Reconsider whether a separate `done` bubble type is needed at all: if the final `agent.message` text already rendered as an assistant bubble, `done` may only need to (a) flip running→idle state (activity indicator off) and (b) optionally add a subtle ✓ to the last message. If `done.summary` duplicates the last assistant text, don't render it twice — either the assistant stream OR a subtle done marker, not both. Decide and implement the cleaner one; the bar is "subtle, not a green box, no doubling."
- Keep ERROR loud/red (errors SHOULD stand out) and the `stopRun`/`pauseRun` done-bubbles (those are status, keep them but restyle to the subtle treatment).

## Regression fence (unchanged)
execAction/action-vs-narrate split; SSE + watchdog; mode STATE + persistence (this only adds a description line, doesn't change the value sent); approve/deny gate; stop/pause machine; token auth; goto/drivable-tab/tab-group. Element IDs the JS uses stay. 2-space/single-quote/ESM.

## Verification
Extension: `cd webnav-extension && npm run build` tsc exit 0; every JS ID resolves. src (#3a/#3b): `npm test` + `npx tsc --noEmit` green. Markdown renderer (#5): a unit test or an assert-based self-check that `**x**`→bold and that HTML in model text is ESCAPED (XSS). #3a: state plainly whether authored the analytics SPA states are now reachable, or the true cause if it was a fingerprint miss. User-gated: the visual (subtle done, neutral trail, markdown render, mode description) on a real load.
