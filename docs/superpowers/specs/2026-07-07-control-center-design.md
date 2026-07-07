# Recording control center (dashboard) + replay-verify (design)

**Date:** 2026-07-07 · **Status:** approved, pre-implementation

## What this is

The `dev dashboard` grows a **Recordings** tab that turns recording from a CLI ritual into a
control center: open a site window *without* recording, hit **Record** when ready, **Stop** when
done, see every recording in a list, and click **Replay** to watch webnav re-execute the exact
steps — confirming the recording does what the human did (and therefore that it will survive as a
walkable map). Approach settled after evaluating alternatives:

- **Extend `dev dashboard`** (chosen): the localhost operator UI already exists (Sites +
  Credentials tabs); recordings belong beside the creds replay needs. No new app/server/store.
- **iframe-embedded browsing: REJECTED** — most real sites refuse framing (`X-Frame-Options`/
  `frame-ancestors`); a cross-origin iframe is invisible to the host page (less access than the
  dead extension); and capture fidelity rides on playwright's a11y snapshot of a real driven page,
  which an iframe is not attached to.
- **Recording in the user's everyday Chrome: REJECTED** — that is the extension dead-end, already
  buried with evidence (DOM-walk → 0 edges; `chrome.automation` dev-channel-only). The itch behind
  it ("my logins") is served by playwright **persistent profiles** instead.

**Two windows, integrated:** the dashboard tab is the remote control; the site lives in its own
real Chrome window. Integration that makes it feel like one product: **Record auto-opens the site
window** (the user never launches anything), the in-page **overlay carries a Stop button + step
counter** (no tab-switching during recording), an optional **"keep me logged in" toggle**
(persistent profile), and replay is confirmable **entirely inside the dashboard** via per-step
screenshots.

## Decisions (from brainstorming Q&A)

1. **Replay pacing: both** — auto-plays ~1.5s/step; **Pause** switches to **Next**-stepping from
   that point; Resume returns to auto.
2. **Typed fields during replay: stored creds auto-fill, else pause & ask.** Recordings never
   contain typed values (secret rule). Field name → cred key by normalized-name match
   (`Username`→`username`). No cred → replay pauses; the dashboard asks for the value (used once,
   never stored, with an *offer* to save to the cred store). This is the credential-inject feature
   landing in its natural home.
3. **Commit steps NEVER auto-replay (#2).** A step whose label/affordance matches `COMMIT_WORDS`
   (or is draft-flagged `needsClassification`) pauses for an explicit "fire it?" confirm — replaying
   a recorded order-placement must not silently place another order.
4. **One driven browser at a time** (recording OR replay) — honors the no-multiple-headed-windows
   rule and keeps the mental model simple.

## Architecture — four units

### 1. `RecordStore` additions (`src/mapstore/record.ts`)
- `listSessions(): { sessionId: string; active: boolean; startedAt: number; stoppedAt: number |
  null; steps: number; site: string | null }[]` — from `record_sessions` joined with an effect
  count and the first effect's `fromUrl` host. Read-only; no schema change.

### 2. Armed recording (decoupled start) — `src/recorder/live-record.ts`
Today the loop exits when the record session is inactive. Add an **armed mode**: the loop runs
while the browser lives; capture is gated by `store.isActive(sessionId)` (which `appendActionEffect`
already enforces — the gate exists, only the loop's exit condition changes). Record/Stop from the
dashboard = `store.start(session)` / `store.stop(session)` — the loop and window stay up.
- Overlay reflects the mode: **grey border + "armed" pill** when open-but-not-recording, **red +
  REC** while recording, and gains a **⏺/⏹ button** (the one pointer-events-enabled element in the
  overlay) that requests the toggle via the sessionStorage event channel; the poll loop applies it
  (`store.start`/`store.stop` — the page can't write the DB). Recording can be driven from either
  the dashboard or the window itself.
- `dev record-live` CLI keeps today's behavior (starts recording immediately) via the same code
  path; the dashboard uses armed mode. One loop, two entry modes.

### 3. Replay engine (`src/recorder/replay.ts`) — the new piece
`replaySession(sessionId, deps)` in-process (the dashboard server is a Node process; no child CLI):
1. Open a headed browser at the recording's first `fromUrl`.
2. Per recorded effect (in `seq` order). An effect with `action: null`: non-navigated → skip
   (pure observation); **navigated → `goto(recorded toUrl)`** (a tier-1-style jump, marked
   `status:'jumped'`) so the replay still reaches the page even though the element that caused it
   wasn't resolvable at record time. Effects with an action:
   - **input step:** resolve the field's `elementFp` (`resolveByFingerprint`) → value from the
     cred store by normalized field name, else **pause: needs-value** → `fill`.
   - **click/navigate step:** if commit-flagged → **pause: needs-confirm** (decision #3); else
     resolve `elementFp` → `act(ref)`.
   - **verify:** landing vs the recording — `didNavigate(currentUrl, recorded.toUrl)` must be
     false for navigated steps (host+path match); non-navigated steps just require resolution.
   - **screenshot** after each step (playwright-cli `screenshot`; verify the exact verb at plan
     time) → `~/.webnav/replays/<session>/step-<seq>.png`.
   - Emit a step result `{ seq, label, status: 'ok' | 'fail' | 'skipped', shot }`.
3. A step that fails to resolve or lands elsewhere → `status: 'fail'` and the replay **pauses**
   (auto mode) — the human sees exactly where reality diverged. Continue/abort from the dashboard.
4. Control channel (in-process state polled by the loop): `pause | next | resume | abort`, plus
   `supplyValue(value, save?)` answering a needs-value pause and `confirm()` answering
   needs-confirm.
- **Not** the walk: replay re-executes a linear recording for verification; walk routes a curated
  map to a goal. Shared machinery (`resolveByFingerprint`, adapter) — different intent. Heal-on-fail
  (human fixes it live, map learns) is the NEXT increment (take-control loop); this design leaves
  the fail-pause as its hook.

### 4. Dashboard (`src/dashboard/`) — Recordings tab
- **List:** sessions with date, site, step count, active badge; Delete (`clearSession`); "Analyse →
  draft" (runs `draftFromEffects`, shows the JSON like the Sites tab shows maps).
- **Detail:** readable step list ("① typed Username · ② clicked Login → /inventory.html …") from
  the stored effects; during replay each row updates live (✓ green / ✗ red / ⏸) with its thumbnail
  (filmstrip = in-dashboard confirmation).
- **Controls:** New recording (URL + session name + "keep me logged in" toggle) → opens the armed
  window; Record/Stop; Replay with Pause/Next/Resume/Abort; the needs-value and needs-confirm
  prompts.
- **Server endpoints** (all localhost-only, same server): `GET /api/recordings`,
  `GET /api/recordings/:id/steps`, `POST /api/recordings/open {url, session, persistent}`,
  `POST /api/recordings/:id/record|stop`, `POST /api/recordings/:id/replay`,
  `GET /api/replay/status` (poll — no SSE, the dashboard is vanilla JS),
  `POST /api/replay/control {action, value?, save?}`, `GET /replays/<session>/<shot>.png`.
  Writes remain: creds (existing) + record start/stop + replay control. Screenshot files are the
  only new on-disk artifact (localhost-served, per-session folder, deleted with the recording).

## Out of scope (named, not built)
- Heal-on-fail / take-control-and-hand-back during walks or replays (next increment; the
  fail-pause is its hook).
- Embedded live-view of the driven browser (screencast + click-forwarding) — big fragile
  subsystem for cosmetic gain; rejected for v1.
- Multiple concurrent driven browsers; replay of `action:null`-only sessions; video recording.
- Any change to `walk`/map semantics — replay is a verification tool over raw recordings.

## Testing
1. **Unit:** `listSessions` shape; armed-mode gating (loop keeps running, capture toggles with
   start/stop); replay step executor against a fake adapter (ok / fail-pauses / needs-value with
   cred hit + miss / needs-confirm on commit-flagged step / skipped action-null); cred name
   normalization.
2. **Server:** endpoint round-trips against an in-memory store (the dashboard server is already
   unit-tested this way).
3. **Live acceptance (human, the real gate):** from the dashboard — open saucedemo armed → Record
   → do login→cart → Stop → recording appears in the list → Replay: creds auto-fill, steps go
   green with thumbnails, the run completes; a recording containing Finish pauses at needs-confirm
   and does NOT fire without the click.
