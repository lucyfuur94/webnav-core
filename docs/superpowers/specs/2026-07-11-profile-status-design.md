# Profile auth status + wall handling (design, 2026-07-11)

**Status:** approved by user (items 1+2 of the 2026-07-11 discussion; item 3 widget-templates is a separate future spec).

## Problem

Agents guess whether a saved profile is still authenticated for a site; a stale login surfaces as an SSO wall mid-walk/mid-recording (observed live: Cloudflare Access step-up on the analytics SPA — fresh-session FIRST load reliably passes, rapid repeat loads bounce). The dashboard Profiles tab has UX gaps found in live use: "Open to log in" stays disabled after the login window is closed (no presence refresh), a recording indicator shows on a login window (it is not a recording), the button is enabled even when auth is already valid, and there is no logout.

## Design (all evidence-based, zero-LLM, never-evade)

1. **`dev profile-status --profile P --site H [--url U]`** — ONE polite headless load of the site's entry URL (map `homeUrl` unless `--url`), then classify the settled landing:
   - matches a known map state for H (`matchState` fingerprints) → `valid`
   - foreign-host landing, `classifyReadiness === 'interstitial'`, or a login-shaped page (password field present) → `needs-login` (+ `loginUrl` = landed URL)
   - else → `unknown` (e.g. site has no map yet and page is ambiguous)
   JSON out; session reaped after; per-host throttle respected. "Am I logged in?" = "does the landing match a known logged-in state?" — the map itself is the oracle.
2. **Wall handling in live navigation (walk + use navigate):** when a settled landing classifies as an SSO wall (foreign-host or interstitial), retry ONCE in a FRESH session with the SAME profile (same identity/cookies — equivalent to the user reopening a tab; NOT evasion; matches the observed first-load-passes pattern). If the wall persists → structured escalation `{status:'needs-auth', profile, site, loginUrl}` instead of a generic drift/`needs-navigation`.
3. **Dashboard Profiles tab:**
   - Per-site status chips (✓ Valid / ⚠ Needs login / – Unknown) + last-checked time + "Check now" (POST `/api/profiles/:name/status` → runs the same engine as the verb).
   - "Open to log in" enabled ONLY when needs-login/unknown; re-enabled when the login window closes (presence tracked the same OS-level way recordings do; the tab already listens to `sessions` SSE — emit the close event for profile windows too).
   - Login windows are NOT recordings: no recording pulse/indicator on profile rows.
   - **Log out** button: per-origin cookie/storage clearing if playwright-cli/CDP exposes it cheaply (implementer investigates); otherwise **Reset profile** (recreate the profile dir in place, keeping the name) with a typed confirm, labeled honestly ("logs out ALL sites in this profile — use to log in with a different account").

## Non-goals

No background polling (checks are on-demand/pre-flight only). No evasion of walls ever. No per-site cookie surgery if the driver stack doesn't expose it — the fallback reset is honest and satisfies the actual need (re-login with a different account).
