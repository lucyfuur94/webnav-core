# Browser guardrails — session ceiling + per-host politeness (design)

**Date:** 2026-06-13 · **Status:** spec for review (not yet built) · **Trigger:** a session
run drove ~100 concurrent Chrome sessions and temporarily got the OrangeHRM demo to stop
hydrating its SPA (a transient bot-throttle). webnav has NO concurrency cap, NO open-session
ceiling, and NO per-host rate limit today — nothing prevents this.

## Problem (measured this session)

- Firing batches of live walks + an 11-agent parallel exploration spawned **118 Chrome
  processes / 22 daemons** at peak. Each `walk`/`use navigate`/`read`/`search` opens a fresh
  daemonized browser; nothing bounds the total.
- That burst tripped OrangeHRM's bot-mitigation: it began serving the page **shell** (HTTP
  200, correct title) but withholding the SPA body (189-char snapshot, no form) — to both
  headless AND headed. A self-inflicted soft-block.
- Cleanup also revealed `dev sessions reap --all` issues a GRACEFUL `playwright-cli close`
  that **wedged daemons ignore** — only `kill <pid>` cleared 7 stuck `browse-*` sessions.

Three gaps: (1) no ceiling on live sessions, (2) no politeness between requests to one host,
(3) reap can't force-close a stuck daemon. Principle alignment: webnav must **detect a wall
and back off, never evade** (#sanctioned-doors) — a politeness throttle is the *prevention*
side of that; it is NOT evasion (it slows us down, it doesn't disguise us).

## Design

### 1. Live-session ceiling (prevents the browser explosion)

A hard cap on concurrently-live playwright-cli sessions. Before opening a NEW session, count
live daemons (reuse `sessions.ts` inventory); if `>= MAX_LIVE_SESSIONS`, FIRST auto-reap
orphans (dead-browser sessions — free, safe), then re-check; if still at the cap, REFUSE with
a clear error rather than pile on:
```
{ status: "error", reason: "session ceiling reached (N live); reap with `webnav dev sessions reap` or close some", hint: "..." }  exit 2
```
- `MAX_LIVE_SESSIONS` default **8** (a human/agent rarely needs more truly-concurrent
  browsers; a workflow fanning out 11 explorers is exactly the case we want to bound).
  Override via env `WEBNAV_MAX_SESSIONS`.
- Applies at the session-CREATING verbs only: `walk` (fresh `w-*`), `use navigate` (when the
  session is new), `read`/`search`/`recall`-style one-shots, `record`. Reattaching an
  existing session (`walk-resume`, `use snapshot/click` on a live session) does NOT count as
  creating one — it's reuse.
- IMPORTANT: a single-shot verb that opens+closes within one process barely occupies a slot;
  the cap mainly bites runaway PARALLEL creation. Count is checked at open; the slot frees on
  close. (A workflow that wants 11 explorers must now serialize past 8, or raise the env —
  the right friction.)

### 2. Per-host politeness throttle (prevents hammering one site into a wall)

A minimum interval between PAGE-OPENS to the same host, enforced in the adapter's `open`
(and `goto`) path. Default **MIN_HOST_INTERVAL_MS = 1000** (≤1 open/sec/host), override via
`WEBNAV_HOST_INTERVAL_MS`. Implementation: a tiny persisted last-open-time per host (a small
JSON in `~/.webnav/`, or in-process for same-run); on open, if `now - last[host] < interval`,
`await sleep(interval - delta)` then proceed. This is *politeness*, not evasion — it makes
webnav a well-behaved client, the opposite of a botnet burst. Bot-walls are still DETECTED
and escalated (existing `classifyReadiness`); the throttle just reduces how often we provoke
one. Cross-process persistence matters because each CLI call is a separate process (a burst
of 100 `webnav` invocations is the exact failure mode).

### 3. Reap force-close fallback (cleanup that actually cleans up)

`reapSessions` currently runs `playwright-cli close` and trusts it. Add: after the graceful
close, if a daemon for that session is STILL alive (check pgrep), `process.kill(pid)` it (and
its orphaned chrome by user-data-dir match). So `dev sessions reap` is guaranteed to clear
even wedged daemons — the manual `kill` I had to run becomes built-in.

## Bot-wall detection on a non-hydrating SPA (the OrangeHRM symptom)

The shell-without-body case (200 + title, but the SPA never mounts → tiny snapshot, expected
fingerprint never appears) currently surfaces only as a walk "cannot resolve / readiness
timeout" — indistinguishable from a slow render. Add a heuristic in the readiness path: if
after the full retry budget the snapshot is BOTH tiny (< ~400 chars / very few nodes) AND
stable (unchanged across retries) AND the URL loaded, classify it as a likely
**soft-block/non-hydration**, and the walk's escalation/`read` result says so explicitly
(`status: blocked, reason: "page loaded but did not hydrate — likely rate-limited or
bot-throttled; back off and retry later"`) instead of a generic resolve failure. Honest
reporting, never evasion. (This is the detect-half of detect-and-escalate.)

## REVISION (2026-06-13, post adversarial review — needs-rework → these corrections)

The review reframed the design. Key corrections folded in:

- **The CEILING, not the throttle, is what prevents the incident.** It was a *count*
  explosion (118 chrome / 22 daemons), not a *rate* problem. Ship the ceiling FIRST.
- **The ACTUAL leak (root cause):** `walk` never closes its browser on a `needs-*` pause
  (cli.ts walk dispatch; contrast walk-resume which DOES close on terminal status). An
  abandoned paused walk leaves a LIVE daemon — which "auto-reap orphans" can NEVER collect
  (orphans = dead-browser only). A few abandoned walks wedge the ceiling shut → self-lockout.
  **FIX: on a `needs-*` pause, walk closes its browser too — the agent re-opens via
  walk-resume's reattach? NO (resume needs the live browser). Instead: the ceiling pre-check
  also TTL-sweeps live-but-stale walk-session browsers (reuse `ttlSweepOpts`/`maybeTtlSweep`
  + the `walk_sessions` table's created_at), so an abandoned pause is reclaimed after the TTL
  rather than living forever.** This is the structural fix that lets the ceiling hold.
- **`MAX_LIVE_SESSIONS` default → 16, not 8** — 8 would hard-refuse the sanctioned 11-agent
  fan-out mid-run. The defect was 11 that never freed, not 11 concurrent. 16 clears the known
  fan-out with headroom; the leak fix bounds the rest by real in-flight work.
- **Ceiling scope: daemonized verbs only** (`walk`, `use navigate`, `record-start`). Pure
  open-close one-shots (`read`/`search`/`eval`/`network`) barely occupy a slot and are already
  self-limiting serially — do NOT refuse them.
- **Ceiling is a best-effort SOFT cap** — no cross-process lock, so concurrent openers can
  overshoot by the number racing; acceptable, stated. `canOpen(liveCount, max) = liveCount < max`
  over the post-orphan-reap count; pure inequality, no judgment (#5a-clean).
- **Reap force-close needs PID plumbing FIRST (was unimplementable):** `sessions.ts` has no PID
  anywhere — `listDaemonPs` runs `ps -eo command`. Re-plumb to `ps -eo pid,command`, add
  `pid?: number` to `SessionInfo`, thread through inventory; then `closeSession` falls back to
  `process.kill(pid)` when graceful close leaves the daemon alive, and kills the chrome **process
  group** (best-effort) — not the unbacked "user-data-dir match".
- **Throttle: sqlite-backed, scope-corrected.** Persist last-open per host in `better-sqlite3`
  (file-locked UPSERT via `src/paths.ts` infra), NOT a lockfree JSON (which races under the
  exact 100-process burst). Gate it on `open`/`goto` (new-client / explicit jumps), and EXEMPT
  intra-session clicks of an already-open walk (a held session isn't a new client). `delayFor`
  try/catches host parse; hostless/glob/`about:blank` → 0 delay.
- **Non-hydration verdict keys on FINGERPRINT ABSENCE, not size.** saucedemo's login legitimately
  fingerprints tiny+stable; a size threshold would mislabel it blocked. Gate "blocked" on: retry
  budget expired AND `matchState` returned `none` across all candidates AND snapshot stable. Fold
  the stability signal into `classifyReadiness` (prior-snapshot arg); for `read`/`search` reuse the
  existing `blocked` return; for the walk, set the escalation question honestly ("page loaded but
  did not hydrate — likely rate-limited; back off and retry") — no new RecallResponse variant.

## Config summary (all env, sane defaults)
- `WEBNAV_MAX_SESSIONS` (default 16) — live-session ceiling (daemonized verbs only).
- `WEBNAV_HOST_INTERVAL_MS` (default 1000) — min ms between open/goto to one host.
- (existing) `WEBNAV_SESSION_TTL_HOURS` — background + ceiling-precheck reap sweep.

## Testing
- ceiling: pure `canOpen(liveCount, max)`; opening past the cap errors (mocked inventory);
  orphan + stale-walk auto-reap frees a slot; one-shot verbs are NOT gated.
- throttle: pure `delayFor(host, now, last, interval)` (same host within interval → +delay;
  other host / past interval / hostless → 0); sqlite persistence read/write over a temp db.
- reap force-close: PID plumbed through inventory; a fake wedged daemon (graceful close no-ops)
  gets `process.kill`'d (mock kill).
- non-hydration: `matchState` none + stable snapshot after budget → blocked (fingerprint-gated,
  NOT size); a legit tiny page (saucedemo login fixture) that DOES match → not blocked.

## Phasing (REORDERED per review)
1. **Live-session ceiling + the walk-pause leak fix** (canOpen + ceiling pre-check that reaps
   orphans AND TTL-stale walk sessions; gate daemonized verbs only; default 16). THE prevention.
2. **Reap force-close** — after PID re-plumb in sessions.ts (`ps -eo pid,command` + `pid` on
   SessionInfo); kill the daemon + its chrome process group when graceful close fails.
3. **Per-host politeness throttle** — sqlite-backed last-open, gated on open/goto, exempt
   intra-session, hostless→0.
4. **Non-hydration soft-block classification** — fingerprint-absence-gated, folded into
   classifyReadiness; honest escalation message.

## Out of scope
- Proxies, fingerprint-spoofing, CAPTCHA-solving — webnav's permanent hard line (no evasion).
- Distributed/global rate limiting across machines (hosted-service concern).
