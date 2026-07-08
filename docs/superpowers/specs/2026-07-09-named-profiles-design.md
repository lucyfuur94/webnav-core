# Named profiles — shared logged-in browser state

**Date:** 2026-07-09
**Status:** approved, ready to build

## Problem

Recording sessions on auth-walled products (Cloudflare + Google 2FA) requires a
login. Today a persistent profile is keyed by **session id** (`~/.webnav/profiles/<session>`),
so every new session gets a fresh empty profile → the human must log in again.
"Log in once, ever" is the goal; the session-keyed model breaks it.

## Model

A **profile** is a named, logged-in browser state at `~/.webnav/profiles/<name>/`
— a first-class resource, NOT tied to a session. Log into Google in profile
`default` once → every session/walk/replay that runs under `default` is logged
in until the cookies expire.

- Sessions **reference** a profile by name (new `profile` column on `record_sessions`).
- The profile named **`default`** is used automatically everywhere unless
  overridden — no picker in the common flow.

## Behaviour

**New session (Sessions tab).** No profile dropdown in the primary flow. A new
session uses `default` automatically. A quiet "profile: default · change" link
opens a small chooser (existing profiles + "New profile…" + "No profile
(throwaway)") for the rare override. Zero extra clicks in the common case.

**Reopen / re-login.** Reopen uses the session's stored profile (default if
none). Force-navigate to the session's `start_url` past the restored tab
(already built).

**Profiles tab (standalone, lists profiles not sessions).** Columns: name ·
#sessions using it · size · last used · open-state. Actions:
- **New profile** — name it, open a headed window to log in (before any recording).
- **Open to log in** — refresh an expired login by hand; lands on the site of
  the most-recent session using it, else blank.
- **Rename** — move the dir, update sessions' `profile` references.
- **Delete** — remove the dir (logs out).

**Walk.** `walk --profile <name>` already resolves a bare name to
`~/.webnav/profiles/<name>` (built, `resolveProfile`, unit-tested). Now it
reuses a SHARED login — the point of the change. Omitting `--profile` falls back
to `default` if that profile dir exists.

## Migration

No data-migration code. Existing `~/.webnav/profiles/<session-id>` dirs already
are profiles (named by old session ids) — they appear in the tab. The human
renames the Google one to `default` (one click), or logs in once more in the new
`default` and deletes the stragglers.

## Data / storage

- `record_sessions.profile TEXT` — the profile name a session runs under
  (nullable; null ⇒ `default`). Additive migration (same pattern as `start_url`).
- Profiles are directories under `~/.webnav/profiles/<name>/`. The name is the
  identity; no separate registry file. A profile "exists" iff its dir exists.
- Name sanitization: `[^\w.-]` → `_` (same rule `profileDir`/`resolveProfile`
  already use), so the on-disk dir is always a safe basename.

## Components touched

- `src/mapstore/record.ts` — `profile` column + `setProfile`/`profileOf`.
- `src/cli.ts` (dashboard deps) — `profiles()` lists by profile-name (not session);
  `profileNew(name)`, `profileOpen(name)`, `profileRename(from,to)`,
  `profileDelete(name)`; `open()` records the chosen profile on the session and
  launches under that dir; `list()` carries the session's profile name.
- `src/dashboard/server.ts` — profile routes keyed by name; new/rename endpoints.
- `src/dashboard/shell.ts` — Sessions "profile: X · change" link + chooser;
  Profiles tab reworked to standalone profiles with new/rename.

## Security / safety

- A profile is live session cookies on disk — local-only, never committed or
  synced (same trust model as any Chrome profile; `~/.webnav` is the user's).
- Logged-in walks make the settled **"never auto-fire commit points"** rule
  load-bearing — a replay inside a logged-in product can reach real buttons.
  Rule is already enforced (COMMIT_WORDS gate); named here because this is where
  it matters.

## Testing

- record.ts: `profile` column migration + `setProfile`/`profileOf` round-trip.
- cli/server: profiles listed by name; new/rename/delete; a session's chosen
  profile persists and drives the launch dir.
- shell: the "change" chooser exists; Profiles tab has New/Rename/Open/Delete.
- Live sanity (manual): log into `default` once, start a second session, confirm
  it opens already logged in.

## Out of scope

- Concurrent sessions under one profile (a profile dir can't be opened by two
  Chrome processes; only one driven window exists at a time anyway).
- Per-profile login-validity probing (opening browsers to check — slow, fights
  the no-extra-headed-windows rule).
- Any change to the Credentials tab (orthogonal: form values, not cookies).
