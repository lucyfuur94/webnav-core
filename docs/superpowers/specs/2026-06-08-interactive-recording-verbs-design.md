# Interactive Recording Verbs — Design

**Date:** 2026-06-08 · **Status:** approved (brainstorm complete) · **Increment:** interactive-recording-verbs (CLI surface for affordance recording) + saucedemo live acceptance

## Problem

webnav has the affordance-recording **engine** (`runActionRecorded`: perform an action → capture before/after → diff + `navigated` → append an ActionEffect) and the session verbs (`record-start`/`record-stop`/`graph-analyse`/`graph-edit`). But there is **no CLI verb that lets an agent *act* on a live page** — the `use` toolbox is `read`/`eval`/`network`/`go-back`/`reload` (one-shot reads). So an agent cannot drive a site through webnav and record what it does. The engine is built but the agent has no hands.

**Goal:** expose four interactive `use` verbs so an agent can drive a live site (navigate/look/click/type) across CLI calls and record action-effects — then prove it end-to-end by having a Haiku subagent map saucedemo fully, build its graph, and use that graph.

## Decisions (settled in brainstorm)

- **Q1 = A:** each interactive verb captures before/after **itself** against the persistent `-s=<session>` browser (verified to survive across CLI processes). The agent supplies only the `ref` (from a prior `use snapshot`); it never passes snapshots around.
- **Q2 = A:** explicit `--session <id>` on each verb. **One id serves as both** the playwright browser (`-s=<id>`) and the record-buffer session. Recording happens when that session is active (after `record-start`); no `--session` = just act, don't record. `snapshot` never records (it's the agent's "look").

## Invariants

- **Zero-LLM / agent drives (#5a).** webnav never autonomously clicks or decides what to explore. The agent picks each ref/action; webnav performs it and records the observed effect. The "explore every affordance" loop is the agent's, not webnav's.
- **Record reality, filter nothing.** Each action-effect stores full before/after snapshots (via the existing engine). Unchanged.
- **Never evade (#hard-line).** A bot-wall/interstitial after an action is captured in the after-snapshot and surfaced; never bypassed.
- **No structure imposed.** These verbs only record; `graph-analyse` stays structure-neutral; the agent decides structure via `graph-edit`. Unchanged.

## Architecture

Four new `use` consumer verbs, thin wiring over existing pieces (`PlaywrightAdapter`, `runActionRecorded`, `RecordStore`). No new engine.

```
webnav use navigate <url> --session S   → -s=S goto url; if S active, append a landing observation (action:null, navigated:true). No close.
webnav use snapshot --session S         → -s=S accessibility snapshot → stdout (the agent's "look"). Never records.
webnav use click <ref> --session S      → snapshot(before) → click ref → snapshot(after) → runActionRecorded appends an action-effect (if S active).
webnav use type <ref> <text> --session S→ snapshot(before) → fill ref text → snapshot(after) → runActionRecorded appends an action-effect (if S active).
```

- **One id = browser + record session.** `--session S` names `-s=S` (live browser) AND the `S` record buffer.
- **Browser persists across calls** (the `-s=` session survives process exit — verified for the walk increment), so each verb reattaches `new PlaywrightAdapter(S)` and continues on the same live page. No verb closes the browser; `record-stop` (and process/OS teardown) ends it.
- **Recording is conditional** on `recordStore.isActive(S)`.

## Components

**`src/cli.ts` — parse + dispatch (4 verbs, `use` group):**
- Parse: `{cmd:'navigate', url, session}`, `{cmd:'snapshot', session}`, `{cmd:'click', ref, session}`, `{cmd:'type', ref, text, session}`. `--session` via `flagValue`; `navigate`'s url and `click`/`type`'s ref are positionals; `type`'s text is the positional after ref.
- Dispatch: each builds `new PlaywrightAdapter(session)` + `new RecordStore('webnav.db')`:
  - **navigate**: `adapter.goto(url)`; snapshot after; if active, `appendActionEffect` with `action:null`, `fromUrl`=prior (or the url), `toUrl`=current, `navigated:true`, `diff` vs an empty before (added = whole page). Print `{status:'done', url, recorded}`.
  - **snapshot**: print `adapter.snapshot()` (raw YAML). No record. (Under `--json`, wrap as `{snapshot: "..."}`.)
  - **click**: `fromSnapshot = adapter.snapshot()`, `fromUrl = adapter.currentUrl()`, then `runActionRecorded({session, recordStore, fromUrl, fromSnapshot, action:{role:'', name:null, ref}, adapter})`. Print `{status, navigated, recorded}`.
  - **type**: same as click but the action carries `text` so the engine `fill`s instead of `click`s.
- Never close the adapter. Exit codes per convention (2 on failure, 0 ok).

**`src/router/browse.ts` — generalize `runActionRecorded` to support type:**
Add an optional `text?: string` to the action (extend `ActionRef` usage or add a field on `RunActionArgs`). The "perform the action" step becomes: `if (text != null) await adapter.fill!(ref, text); else await adapter.act!(ref);`. Everything else (before/after capture, diff, navigated, append) is identical. Adapter needs `fill` on the `BrowseAdapter` interface (the real `PlaywrightAdapter.fill` exists; add it to the optional interface).

**`src/playwright/adapter.ts`** — already has `goto`, `click`, `fill`, `snapshot`, `currentUrl`, `act`. No new methods.

**`src/cli-spec.ts`** — four `CONSUMER_COMMANDS` entries (group `'navigate'`), per-verb help teaching data-flow (`ref` is "from `use snapshot`"; `session` is "from `dev record-start`"). Update the registry-count test.

## Data flow (the saucedemo acceptance run — Haiku subagent)

```
dev record-start --session sd1
use navigate https://www.saucedemo.com --session sd1
use snapshot --session sd1                         → sees Username/Password/Login
use type <user-ref> standard_user --session sd1
use type <pass-ref> secret_sauce --session sd1
use click <login-ref> --session sd1                → records navigated:true → inventory
use snapshot --session sd1                         → sees products, Add-to-cart×6, sort, cart link
use click <add-to-cart-ref> --session sd1          → records navigated:false + Remove diff (in-page)
use click <cart-link-ref> --session sd1            → records navigated:true → cart
…continue through checkout-step-one, step-two…
dev record-stop --session sd1
dev graph-analyse --session sd1                    → raw observations grouped by www.saucedemo.com
   → agent decides structure → dev graph-edit --node www.saucedemo.com --graph <…>
dev graph-show --node www.saucedemo.com            → confirm the built graph
   → USE it: walk over it / view it
```

## Error handling

- **action verb on a session with no live page** (no prior `navigate`): adapter throws → `{status:'failed', reason:'no live page for session <id> — run `use navigate` first'}`, exit 2.
- **click/type with a stale/wrong ref**: playwright-cli errors → `{status:'failed', reason}`, exit 2; if recording, the failed attempt is recorded honestly (after = unchanged page), never silently swallowed.
- **action verb without `--session`**: acts on an ad-hoc browser, `recorded:false`. Not an error.
- **action before `record-start`**: acts, `recorded:false`. Not an error.
- **bot-wall after an action**: captured in the after-snapshot, surfaced; never evaded.

## Testing strategy

- **CLI parse (unit):** the four verbs + `--session`/positionals; routed under `use`; registry-count updated.
- **Dispatch with a fake adapter (unit):** `click`/`type` capture before/after and append exactly one action-effect when the session is active; `snapshot` records nothing; `navigate` appends a landing observation. (Inject a fake `BrowseAdapter`.)
- **`runActionRecorded` type-support (unit):** a `type` action fills text then records (diff correct); a `click` action still clicks then records. Back-compat: existing `runActionRecorded`/click test stays green.
- **Gated live e2e (`WEBNAV_LIVE=1`):** drive a short real saucedemo slice through the actual CLI verbs (navigate → snapshot → type creds → click login → snapshot → click add-to-cart); assert login = `navigated:true`, add-to-cart = `navigated:false` + a "Remove" in the diff. Proves the CLI surface, not just the engine.
- **Acceptance demo (not committed CI):** a Haiku subagent drives the full saucedemo map via these verbs; the resulting graph is verified by hand. One-time real-life proof.

## Out of scope (this increment)

- Other playwright verbs (`hover`/`select`/`press-key`/`scroll`) — add later only if the saucedemo run needs them (navigate/snapshot/click/type should suffice).
- Autonomous affordance-exploration inside webnav (the agent drives — #5a).
- Returning raw before/after snapshots through `graph-analyse` (a noted prior follow-up; separate increment).
- Auto-`record-stop` on inactivity / session GC (manual `record-stop` for now).

## Files

- **Modify:** `src/cli.ts` (4 verbs parse+dispatch), `src/cli-spec.ts` (4 entries + registry test), `src/router/browse.ts` (`runActionRecorded` type support + `fill` on the adapter interface).
- **Create tests:** `tests/cli/parse-interactive.test.ts`, dispatch test (fake adapter), extend `tests/router/browse-action.test.ts` for type, gated `tests/e2e/interactive-cli.live.test.ts`.
- **Modify:** `docs/STATUS.md`.
- No changes to: the affordance engine internals, analyse, the walk, the viewer.
