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

## Config summary (all env, sane defaults, off = current behavior only for throttle=0)
- `WEBNAV_MAX_SESSIONS` (default 8) — live-session ceiling.
- `WEBNAV_HOST_INTERVAL_MS` (default 1000) — min ms between opens to one host.
- (existing) `WEBNAV_SESSION_TTL_HOURS` — background reap sweep.

## Testing
- sessions ceiling: pure `canOpen(liveCount, max)` predicate unit-tested; opening past the cap
  errors (mocked inventory); orphan auto-reap frees a slot.
- host throttle: pure `delayFor(host, now, last, interval)` returns the sleep ms; unit-tested
  (same host within interval → positive delay; different host / past interval → 0). Persistence
  read/write tested over a temp file.
- reap force-close: a fake "wedged" daemon (graceful close no-ops) gets killed (mock the kill).
- non-hydration classify: a tiny+stable snapshot after the budget → blocked status (fixture).

## Phasing
1. host-politeness throttle in the adapter open/goto path (+ pure delay fn + persistence) —
   the single highest-value prevention (it's what would have stopped the OrangeHRM block).
2. live-session ceiling at the creating verbs (+ canOpen predicate + auto-reap-orphans-first).
3. reap force-close fallback.
4. non-hydration soft-block classification in the readiness path.

## Out of scope
- Proxies, fingerprint-spoofing, CAPTCHA-solving — webnav's permanent hard line (no evasion).
- Distributed/global rate limiting across machines (hosted-service concern).
