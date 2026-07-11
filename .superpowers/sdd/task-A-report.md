# Task A report — `dev profile-status` verb + classification engine

## Implemented

Design item 1 of `docs/superpowers/specs/2026-07-11-profile-status-design.md`:
- `webnav dev profile-status --profile <p> --site <host> [--url <u>]`
- The reusable classification engine `classifyAuthLanding`

Items 2 (wall-retry-in-fresh-session) and 3 (dashboard Profiles tab UX) are explicitly OUT of scope — left for later tasks. The engine is exported from its own module precisely so item 2 can import it without touching `browse.ts`'s action-recording concerns.

## Engine home: `src/router/auth-status.ts` (new file)

Considered putting it in `src/router/browse.ts` (named as an option in the prompt) but chose a new file:
- `browse.ts`'s existing exports (`runEval`, `runNetwork`, `recordNavigateEffect`, `runActionRecorded`, `settleSnapshot`) are all about **driving a browser and recording effects into RecordStore**. `classifyAuthLanding` is pure judgment-free **classification of an already-settled snapshot** — no adapter, no RecordStore, no side effects. Different axis of concern.
- It needs to be reused by Task 2 (walk/use-navigate wall-handling escalation), which lives in `src/router/walk.ts` / `walk-live.ts` / `cli.ts`'s navigate handler — none of which currently import `browse.ts` for this kind of thing. A dedicated `auth-status.ts` is an equally-cheap import for either caller and doesn't bloat `browse.ts` with an unrelated concern.
- Consistent with the existing pattern of one-concern-per-file in `src/router/` (`readiness.ts`, `extract-content.ts`, `tokens.ts` are each a single pure classifier/helper).

`classifyAuthLanding(landedUrl, snapshotYaml, site, states)` → `{ auth: 'valid'|'needs-login'|'unknown', loginUrl? }`. Order of checks (matches the design doc exactly):
1. Foreign host (`new URL(landedUrl).host !== site`) → `needs-login` + `loginUrl`.
2. `classifyReadiness(snapshotYaml) === 'interstitial'` → `needs-login` + `loginUrl`.
3. A `textbox` node whose name matches `/password/i` → `needs-login` + `loginUrl`. (Honest signal used: `SnapNode` from `parseSnapshot` carries no HTML `type=` attribute — playwright-cli's accessibility snapshot doesn't expose it — so role+name-pattern is the only signal actually available, as the design doc anticipated.)
4. Else `matchState(nodes, states)` — `matched` → `valid`; anything else → `unknown`.

## The verb (`src/cli.ts`)

- New `ParsedArgs` variant `{ cmd: 'profile-status'; profile: string; site: string; url?: string }` + parse branch (flag-only, following the `verify`/`graph-show` pattern).
- Handler:
  - `--profile`/`--site` both required → else `{status:'error', hint}` exit 2 (matches `verify`'s usage-hint convention).
  - Resolves `homeUrl` from `store.getNode(args.site)` (node id === host, confirmed by reading `export-map`/`outline`/`graph-show`'s existing `--node <host>` convention); `--url` overrides. Neither present → exit 2 with a hint to pass `--url` or map the site first.
  - Session id: `pchk-` + 4 random base36 chars (short, for the macOS daemon-socket-path cap — same reasoning as `capture-loop`'s `stamp` truncation).
  - Profile resolution reuses `resolveProfile` + `prepProfile` (orphan-lock clearing) exactly as `use navigate` does, so the check runs under the identical login state a real walk would use.
  - Opens **headless** (`{headed:false, persistent:true, profile: profileDir}`) — this is an automated background check, not the one interactive case that gets a visible window (per the project's no-headed-window-for-automated-checks rule).
  - `adapter.open(url)` → throttle is respected automatically (`PlaywrightAdapter.open` calls `throttleOpen` internally — confirmed in `src/playwright/adapter.ts:65`; no extra plumbing needed here).
  - Settles via the existing `settleSnapshot` from `browse.ts` (reused, not reimplemented) before reading `currentUrl()`/`snapshot()`.
  - Classifies via `classifyAuthLanding`, prints `{status:'ok', auth, site, profile, checkedAt, loginUrl?}`.
  - **Exit code 0 in all three auth outcomes** (including `needs-login`) — the verb itself ran fine; `needs-login` is a normal, useful answer, not a failure. Only a thrown error (browser/profile/navigation failure) is exit 2. This choice is written into the cli-spec summary itself ("Exit 0 in all three cases — needs-login is a normal, useful answer, not a failure") so it's discoverable via `--help`, not just in this report.
  - `finally { await adapter.close().catch(() => {}) }` — the opened session is ALWAYS reaped, success or thrown error.

## cli-spec.ts

Added a `profile-status` entry under `DEV_COMMANDS` teaching: where `homeUrl` comes from (the site's map, or `--url` override), that `matchState` against the map's fingerprints is the oracle, that exactly one polite headless load happens and the session is reaped after, and the exit-0-on-needs-login choice.

## Tests

1. **`tests/router/auth-status.test.ts`** (new, 6 cases, pure — no browser/adapter):
   - `valid` via a real matching fingerprint on the right host.
   - `needs-login` via foreign-host landing.
   - `needs-login` via `classifyReadiness === 'interstitial'`.
   - `needs-login` via a declared password textbox.
   - `unknown` — right host, empty map, no signal.
   - `unknown` — right host, map exists, but no state matches (stale/ambiguous map).
2. **`tests/cli/parse-mapping.test.ts`** — 3 new cases: `--profile`/`--site`, `--url` override, and missing-flags-default-to-empty-string.
3. **`tests/cli-spec.test.ts`** — added `profile-status` to the pinned verb-name list, and a new help-content pin asserting the summary teaches `homeUrl`, `matchState`, `reaped`, and `Exit 0`, plus flag shape.

No live-browser test harness was extended for the verb itself: `browse.ts` already has a `BrowseAdapter` fake-adapter pattern (`tests/router/browse.test.ts`) for its own exported functions, but the verb's session/profile-resolution plumbing (`resolveProfile`/`prepProfile`/`PlaywrightAdapter` construction) lives inline in `cli.ts`'s handler, mirroring exactly how `verify`/`navigate` do it today — none of those existing verbs have a CLI-level fake-adapter test either (they're proven live, not unit-tested at the handler level). I followed that existing precedent rather than inventing new test infrastructure. **Engine tests + parse tests are what I did**; the verb's live behavior was instead verified by actually running it (see below), consistent with "engine tests + parse tests suffice" being an acceptable option per the task prompt.

## Live verification (not just unit tests)

Ran the actual built verb against the real local map (this worktree's `webnav.db` has a genuine `www.saucedemo.com` map, 7 states):

```
$ npx tsx src/cli.ts dev profile-status --profile ponytail-verify-test --site www.saucedemo.com
{
  "status": "ok",
  "auth": "needs-login",
  "site": "www.saucedemo.com",
  "profile": "ponytail-verify-test",
  "checkedAt": "2026-07-11T06:19:55.404Z",
  "loginUrl": "https://www.saucedemo.com/"
}
```

A fresh profile correctly reports `needs-login` (saucedemo's landing IS its login form, with a real Password textbox — this exercised the actual password-field-detection branch against real playwright-cli snapshot output, not a synthetic fixture).

Confirmed the session was reaped: `dev sessions list` showed `{"name":"pchk-4d39","live":false}` immediately after (the `finally`-block close worked; only harmless on-disk bookkeeping remained, same as every other verb). Reaped it and removed the throwaway profile dir afterward.

## Verification commands run

- `npx tsc --noEmit` → clean.
- `npm test` → 683 passed, 7 skipped (live/e2e, gated), 0 failed. (One guideline test — `tests/guidelines.test.ts` "no site-specific names in src/" — initially failed because my first cli-spec example used `progneo.analytics.mn`; fixed by switching the example to `www.saucedemo.com`, the project's only shipped default seed.)
- Live run of the built verb against the real saucedemo map, as above.

## Files touched

- `src/router/auth-status.ts` (new) — the classification engine.
- `src/cli.ts` — `ParsedArgs` variant, parse branch, handler.
- `src/cli-spec.ts` — `profile-status` entry.
- `tests/router/auth-status.test.ts` (new).
- `tests/cli/parse-mapping.test.ts` — 3 new cases.
- `tests/cli-spec.test.ts` — pinned name list + new help-content assertion.

## Concerns / notes for later tasks

- **Item 2 (wall-retry-in-fresh-session)** should import `classifyAuthLanding` from `src/router/auth-status.ts` rather than reimplementing wall-detection — that's the whole point of pulling it into its own module.
- `hostOf`/foreign-host check uses exact string equality between `new URL(landedUrl).host` and `site`. If a site's map is keyed by a bare host without a port and a redirect lands on `host:port`, this would false-positive as foreign-host. Not observed in the live check (saucedemo has no port), and no existing node id in this codebase carries a port, so I didn't special-case it — flagging as a real but currently-inert edge case.
- The verb always opens **headless** (no `--headed`/`--headless` flag exposed) — deliberate, since this is an automated pre-flight check, not the one interactive case (login) that gets a visible window. If a future need arises for a human to visually watch this check, that'd need an explicit flag addition.
