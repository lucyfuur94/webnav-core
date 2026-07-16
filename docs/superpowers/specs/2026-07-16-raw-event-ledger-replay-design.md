# Raw-event ledger + two-mode replay — design (2026-07-16)

> Brainstormed 2026-07-15/16. Decisions here are user-approved. Capture-engine files
> (`live.ts` / `live-record.ts` / `agent-session.ts` / `record.ts`) are GATED: implementation
> starts only on explicit user OK.

## Problem

1. **Capture losses are invisible.** The human recorder drains raw `LiveEvent`s, assembles
   `ActionEffect` steps, and DISCARDS the raw events; drops (unresolved same-page clicks,
   pairing give-ups) survive only as transient `skip:` log lines. Agent sessions likewise
   persist only the resulting steps, not the command stream. We cannot measure, per session,
   what happened vs what was kept — the fidelity-roadmap item 1c gap
   (`2026-07-13-usage-first-capture-roadmap.md`).
2. **The testing team needs record → auto-play** without knowing webnav or playwright.
   Today replay exists (steps-based, `replay.ts`) but only replays what assembly kept, and
   the dashboard has no place that shows the raw session record.
3. **Replay crashes the dashboard** (hit live 2026-07-15): session name `replay-<id>`
   pushes playwright-cli's unix socket path over macOS's 104-char `sun_path` limit
   (`listen EINVAL`), and the rejected `runReplay` promise is unhandled
   (`void ….finally()` at `cli.ts:1539-1541`) → Node kills the whole dashboard process.

## Decisions already settled

- **Measurement-only ledger**: the ledger stores the DESCRIPTORS we already capture
  (role / label / href / non-secret value) — never CSS selectors. Replay resolves
  descriptors through the existing deterministic machinery (`resolveEvent`,
  fingerprints); no codegen-style selector scripts (brittle, duplicates `replay.ts`).
- **Secrets rule inherited**: the source listener already nulls password / cc-* values,
  so the ledger can never contain them.
- **No change to assembly/pairing logic itself** — the ledger is an append-only sibling.

## 1. Ledger table (`record_events`)

New table in `src/mapstore/schema.sql`, owned by `RecordStore` (`src/mapstore/record.ts`):

```sql
CREATE TABLE IF NOT EXISTS record_events (
  session_id  TEXT NOT NULL,
  seq         INTEGER NOT NULL,   -- ledger order per session (COUNT(*) at append, like steps)
  t           INTEGER,            -- capture-time ms (page clock for human events)
  source      TEXT NOT NULL,      -- 'human' | 'agent'
  kind        TEXT NOT NULL,      -- human: click|input · agent: navigate|click|type|hover
  descriptor  TEXT NOT NULL,      -- JSON: the LiveEvent (human) / {cmd,url,ref,role,name,text} (agent)
  disposition TEXT,               -- NULL=pending → 'step:<stepSeq>' | 'dropped:<reason>'
  PRIMARY KEY (session_id, seq)
);
```

`RecordStore` gains: `appendEvent(session, ev) → seq` (gated on `isActive`, like steps),
`stampEvent(session, seq, disposition)`, `events(session) → StoredLedgerEvent[]`.
`appendActionEffect` returns its step seq (currently `void`) so callers can stamp.
`deleteSession`/`clearSession`/`renameSession` cover the new table.

**Human path** (`live-record.ts`): every drained non-toggle event that enters `pending`
is appended at drain time (before pairing can lose it), and the `Pending` entry carries
its ledger seq. Where the loop currently logs the outcome it also stamps:
- appended effect → `step:<stepSeq>`
- `fromIdx === -1` → `dropped:no-from-page`
- unresolved same-page click, rescue diff empty → `dropped:unresolved-same-page`
- unresolved same-page click, rescue diff non-empty → that effect's `step:<stepSeq>`
Events drained while recording is off are NOT ledgered (recording off = off).

**Agent path** (`agent-session.ts`): each ACTION command (`navigate`/`click`/`type`/`hover`;
not `snapshot`/`eval` — observations, not actions) appends a ledger row before executing and
stamps after: `step:<seq>` when recorded, `dropped:failed:<reason>` when the action failed.
(Commands while recording is off are not ledgered — `appendEvent` is `isActive`-gated,
the same rule as the human path.)

## 2. Coverage diff (fidelity, deterministic)

Pure function in the recorder module: `coverage(events) → { total, captured, dropped:
[{seq, kind, label, reason}] }` — an aggregation over dispositions, zero LLM, zero cost.

Surfaced in `dev review`:
- printed as a deterministic section BEFORE the LLM audit (and included in `review.json`
  as `coverage`),
- the drop list is added to the review prompt as "ASSEMBLY DROPS (already known —
  do not re-report these)": the LLM audit then hunts only SENSOR blindness (what even
  the listener never saw: drag, scroll, hover menus), which is the video's unique value.

## 3. Two-mode replay

Both modes drive the SAME `ReplayController` (pause/next/supply/confirm, screenshots),
so the dashboard replay panel works identically for either.

- **Via steps** (existing `runReplay`, unchanged): plays assembled steps with fingerprint
  resolution, cred lookup, commit gates. Self-healing; survives site redesigns. Default.
- **Via ledger** (new `runLedgerReplay` in `replay.ts`, sharing helpers): plays the raw
  event stream in captured order — including events assembly dropped, so nothing is
  silently omitted; a capture miss shows up as a failed step (the replay doubles as a
  capture-fidelity test). For testers: "exactly what I did, again."

`runLedgerReplay(events, ctl, deps)` semantics:
- open at the first event's URL; for each event, gate (auto-pace / step mode) then:
  - **resolve**: live snapshot → `resolveEvent(descriptor, nodes)`. No unique match →
    fail + pause with note; Next retries once (mirrors steps-replay's human-assisted
    retry). Never a guessed ref (identical-siblings rule).
  - **input events**: fill with the ledger's recorded value; else creds lookup; else
    `waitFor('value')` (secrets were never recorded, so they ask — same as steps mode).
  - **click events**: `COMMIT_WORDS` label → `waitFor('confirm')` before firing (#2).
  - **agent `navigate` events**: direct `goto`.
  - **agent `hover` events**: `adapter.hover(ref)` (ReplayDeps adapter gains `hover` —
    `PlaywrightAdapter` already has it).
- **landing verification** (judgment-free, from recorded URLs): if the NEXT event's url
  differs from this event's url (`didNavigate`), settle after acting and verify the live
  URL matches the next event's url; mismatch → fail + pause ("landed elsewhere").

**Mode picker copy** (plain English, shown in the dashboard):
- Steps: "Replays the cleaned-up route. Finds each element again even if the page
  changed. Best for repeatable automation."
- Ledger: "Replays exactly what was done, event by event, nothing skipped. Best for
  exact reruns and for checking the recording caught everything."

API: `POST /api/recordings/:id/replay` body `{mode?: 'steps'|'ledger'}` (absent = steps);
`rec.replay(id, mode)` in `cli.ts` picks the runner and the events/effects input.

## 4. Dashboard

- **Ledger sub-tab** in the session detail, between Review and Logs
  (`shell.ts:1167` tab row → Steps · Session videos · Review · **Ledger** · Logs):
  summary line ("23 events → 19 steps, 4 dropped") + the event table
  (time, kind, label, disposition — `step 12` cross-references the Steps tab;
  `dropped: unresolved same-page click` highlighted). Server: `GET
  /api/recordings/:id/events` returns ledger rows + coverage.
- **Replay button → mode picker**: two buttons — "Replay" (steps) and "Replay exact"
  (ledger) — each with its one-line copy; both hit the same endpoint with `mode`.

## 5. Crash fixes (both upstream)

- **Socket-path cap** in `PlaywrightAdapter` (the single point every webnav call routes
  through): a session name longer than 32 chars is deterministically capped to
  `<first-24>-<6-char-hash>` before hitting `-s=`. Same input → same wire name, so
  reattach keeps working; short names (all seeds, walks, records today) are UNCHANGED.
  Profiles are unaffected (profile dirs come from the separate `profile` opt via
  `resolveProfile`, never from the session name). Plan step: grep for any `-s=`
  constructed OUTSIDE the adapter and route it through the same cap helper.
- **No unhandled rejection**: `rec.replay` attaches `.catch` — on failure it writes
  `state.error`, marks `done`, frees `busy`; the dashboard shows a failed replay instead
  of dying. (`runReplay`'s own `finally` already closes the adapter.)

## 6. Pointer glide (cosmetic, included)

The pointer dot already ships (`live.ts` INSTALLER_JS) and tracks agent actions.
One value change: lengthen the dot's CSS transition 50ms → ~200ms so playwright's
teleporting mouse reads as a visible glide in session videos.

## Out of scope

- CSS-selector capture / standalone codegen scripts (rejected — measurement-only).
- Any change to assembly/pairing logic, the draft, or the graph pipeline.
- Ledger for `walk` sessions (walks are replays already; ledger is a RECORDING artifact).
- Backfill: sessions recorded before this ship have no ledger; their Ledger tab says so
  honestly ("recorded before ledger existed").

## Testing (unit, no browser — existing fake-adapter patterns)

- `record.ts`: ledger append/stamp/query round-trip; delete/rename cover `record_events`;
  `appendActionEffect` returns seq.
- `live-record.ts` (scripted fake adapter): drained events → ledger rows whose
  dispositions match the appended effects / documented drop reasons; armed-idle events
  not ledgered.
- `agent-session.ts` (scripted stdin): one ledger row per action command with correct
  disposition; snapshot/eval not ledgered.
- `coverage()`: pure diff over dispositions.
- `runLedgerReplay` (fake adapter): happy path; ambiguous → pause + one retry; secret →
  `waitFor('value')`; COMMIT_WORDS → `waitFor('confirm')`; landing mismatch → fail+pause.
- `PlaywrightAdapter`: cap determinism (long names stable, short names untouched, 104-char
  bound respected for realistic $TMPDIR lengths).
- Replay spawn failure (adapter throws on open): `state.error` set, `busy` freed,
  process alive.

## Rollout order (implementation plan will detail)

1. Crash fixes (independent, user-facing pain, small).
2. Ledger writes (record.ts + both capture paths) — GATED on user OK.
3. Coverage diff + `dev review` integration.
4. `runLedgerReplay` + replay mode API.
5. Dashboard Ledger tab + mode picker.
6. Pointer glide one-liner.
