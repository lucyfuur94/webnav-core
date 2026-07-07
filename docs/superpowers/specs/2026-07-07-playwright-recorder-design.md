# Human-driven recording via playwright-cli (design)

**Date:** 2026-07-07 · **Status:** approved, pre-implementation · **Supersedes** the Chrome-extension
capture in `2026-07-07-human-session-recorder-design.md` (kept as a documented dead-end; its
`dev ingest` receiver + ActionEffect pipeline remain valid and reusable).

## Why the pivot (evidence, not argument)

The extension reconstructed the a11y tree from the raw DOM in JS. On a React SPA (saucedemo) that
approximation collapsed: roles `generic`, names = whole-subtree textContent blobs → **0 edges**.
The true in-browser a11y API (`chrome.automation`) is dev-channel-only — not shippable. Meanwhile a
live proof through playwright-cli's REAL a11y snapshot (`use navigate/type/type/click` recorded via
`runActionRecorded`) produced clean `textbox "Username"` / `button "Login"` effects and a correct
draft: `home → inventory-html` navigate edge **with auto-detected login linkage**
(`needs:[inp_username,inp_password]`, `acceptsInput:credentials`). Same site, same flow: extension
0 edges, playwright-cli correct map. The capture source must be playwright's snapshot — the SAME
data `walk`/fingerprints resolve against. Correct by construction; no twin serializer.

**Accepted cost:** the human records in webnav's headed playwright-cli window, not their everyday
Chrome (no saved logins/extensions). Fine for the Day-1 QA use case. The silent-tracking /
crowd-map futures need a real-browser story and are a SEPARATE later problem.

## What this builds

`webnav dev record-live --session S --url <start> [--interval ms]` — opens the headed browser at
`<start>`, and the human **free-clicks naturally**. webnav captures each action as an
`ActionEffect` (playwright-fidelity snapshots) into the existing `RecordStore`; then the unchanged
`graph-analyse --draft` → `graph-edit` → `walk` pipeline. Stop via `dev record-stop` / Ctrl-C
(browser reaped by existing guardrails).

## Architecture — listener tags & reports; playwright snapshots; existing store persists

### 1. Injected capture listener (in-page, ~30 lines, idempotent)
Injected via the adapter's `evalJs`; **re-injected on each navigation** (the poll loop checks
`window.__webnav_installed` every tick and re-installs — new documents lose page JS).
On the human's `click` (capture phase) and `change` on form fields, push a **descriptor event** to
a **`sessionStorage` queue** (`__webnav_evq`):

```
{ seq, ts, kind: 'click'|'input', url: location.href,
  tagName, role?: el.getAttribute('role'), ariaLabel, leafText,   // leaf text only — no subtree blobs
  href?, placeholder?, nameAttr?, inputType? }
```

The listener also stamps the clicked element (`el.dataset.webnavHit = seq`) — invisible to a11y
snapshots, but readable by the ref-scoped eval probe below when same-page disambiguation is needed.

Two hard rules learned from the extension failure:
- **NO in-page serialization** of the page/tree — the descriptor identifies ONE element, cheaply.
- **NO `.value` reads ever** (secret-field rule). `kind:'input'` records THAT a field changed and
  which field — never its content. `walk` auto-fills values from the local cred store.

**Why sessionStorage, not a window variable:** the navigating click is the most important event,
and a window-scoped queue dies with the document (the extension's fatal bug, re-learned). The
sessionStorage queue survives same-origin navigation; webnav drains it from the NEW document.
Known limit (`ponytail:`): a click immediately before a **cross-origin** jump can lose its queued
event (drain interval bounds the loss to <1 tick); mapping is per-site, so acceptable.

### 2. Drain + rolling-snapshot loop (`src/recorder/live-record.ts`, new)
Every `--interval` (default ~500ms):
1. **ensure injected** (`window.__webnav_installed` else re-eval installer);
2. **drain** the queue atomically (`eval`: read + clear `__webnav_evq`);
3. take a **rolling real-a11y snapshot** + current URL (ring buffer of recent `{url, snapshot,
   ts}` ticks) — the readiness classifier gates it so we don't archive loading shells;
4. **assemble effects** per drained event (pure function, unit-testable):
   - `fromSnapshot` = most recent buffered snapshot whose URL matches the event's click-time URL;
   - **resolve descriptor → ref** on that snapshot: candidates by role+name (role from the
     descriptor's explicit `role` else tagName→role for the ONE element; name = ariaLabel ||
     leafText); `href` is a strong disambiguator for links; if the document is still the same
     (non-navigating click) and candidates remain ambiguous, probe candidates via ref-scoped
     `eval(el => el.dataset.webnavHit, ref)` against the tag the listener set on the element;
     still ambiguous → **drop honestly** (draft's verify-before-emit philosophy — never a wrong
     fingerprint);
   - `action.elementFp` = `recoverFingerprint(fromNodes, ref)` — real-tree `near` disambiguation;
   - `toSnapshot` = first settled snapshot after the event; `navigated = didNavigate(event.url,
     toUrl)` (host+path, the agent path's semantic);
   - append via `RecordStore.appendActionEffect` (same rows as agent-recorded sessions).

Safety nets that make drops non-fatal: link navigations ALSO get their edges from the existing
cross-link mesh (declared hrefs), and interior-synthesis emits declared inputs/buttons — a missed
click degrades ordering, not the map.

`ponytail:` burst clicks inside one tick share a `fromSnapshot` (diff may be stale); accept for
v1 — the draft keys on landing pages + actions. Click-deferral (intercept→snapshot→release) is
the documented upgrade if a real site proves the pre-click frame matters.

### 3. The verb (`dev record-live`)
Registers in cli-spec (self-describing help); opens headed via existing `BrowserOpts`; starts the
loop; stdout = one JSON status line (`{status:"recording", session, url}`), progress lines to
stderr; runs until `record-stop`/Ctrl-C (long-running, like `dashboard`/`mcp`/`ingest`). Session
start/stop rides the existing `record-start`/`record-stop` store calls.

## Not building (scope)
- No click-deferral/intercept; no in-page tree serialization; no CDP side-channel.
- No credential-inject yet — **next increment**, on this loop: when a drained event lands on a
  page whose draft-shape shows login fields, offer stored creds (or offer to save). This design
  already records the input affordances that power that (proven: `acceptsInput:credentials`).
- No silent/always-on mode (needs the real-browser story).
- Extension stays shelved; `dev ingest` remains (harmless, reusable for any future remote capture).

## Testing
1. **Unit (pure):** event+snapshot-buffer → ActionEffect assembly: descriptor resolution
   (role+name unique; href disambiguation; ambiguous → dropped), fromSnapshot URL-matching,
   navigated recompute, input events (no values). Canned snapshots from tests/fixtures.
2. **Unit:** installer idempotence (string-level: double-inject guards; queue append shape).
3. **Live acceptance (human):** `record-live` on saucedemo — free-click login→add-to-cart→cart;
   `graph-analyse --draft` shows the login navigate edge + `needs` linkage (the bar the 5-min
   proof set); then `walk` the drafted map.
