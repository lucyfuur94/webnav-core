# Human-session recorder → local webnav map (design)

**Date:** 2026-07-07 · **Status:** approved, pre-implementation

## The objective shift (why this exists)

Map-*building* is webnav's real bottleneck. Every current path — webnav's own agent-driven
`use` loop, and every competitor (Stagehand, browser-use, workflow-use) — builds a route from
**one LLM agent driving once**, so the map only knows what that single run happened to click:
limited, brittle, expensive. This spec replaces the weak building half with a **Chrome extension
that turns real human browsing into webnav `ActionEffect`s**, feeding the existing (already-built,
already-tested) reuse half: `graph-analyse`/`draft`/`walk`.

**Why this is the pivot, not another record-replay tool:** Stagehand/browser-use are SDKs/libraries
you *call from code* — they have no surface where a *human's actual browsing* becomes the map.
Recording real usage is a **data source**, not a feature they can copy in a sprint. (Competitive
finding, 2026-07-07: the record-once / deterministic-replay / self-heal mechanic is now shipped by
Stagehand at 23k★ and workflow-use at 4k★ — webnav does NOT win on the mechanic. The uncontested
ground is *where the map comes from*.)

**One recorder, two modes (same code, a toggle):**
- **Mode M (manual) — ships Day 1 for QA teams.** Toolbar toggle: record → walk the flow → stop.
  Sessions land in local `webnav.db`. Usable standalone from day one.
- **Mode S (silent) — same capture, later.** Always-on for enrolled staff on a first-party
  internal app; passive usage feeds usage-weighted maps. Refined in the background; NOT in this
  spec's build scope (see Scope).

## Non-negotiable: nothing existing changes

This is **purely additive**. Verified against the code (2026-07-07):
- The agent record path (`dev record-start` → `use click/type` = `runActionRecorded` →
  `dev record-stop`) writes via `recordStore.append` at `src/router/browse.ts:102`.
- The new extension path writes via the **same** `RecordStore.append` through a new `dev ingest`
  verb.
- Downstream, `graph-analyse` reads `RecordStore.actionEffects(session)` (`src/cli.ts:359,378`) —
  it does not care how the effects got there.

Two producers, one sink. The build edits **no existing file's behavior**; it adds new files plus one
additive CLI verb. If the extension ever emitted malformed effects, it would break only its own
sessions — the agent path never runs the new code.

## Architecture — three independently-testable units

### 1. `webnav-recorder/` — Chrome extension (MV3), isolated package
Like `web/` was: NOT a root dependency; its own package.json.
- **content script** — listens for user click / input / navigation on the page. On each interaction:
  1. read the accessibility tree,
  2. serialize it to a **playwright-parity snapshot string** (see unit 2),
  3. compute the clicked element's fingerprint `{role, name, near}` (reuse the existing
     `deriveNear` semantics — a durable content anchor, never positional) + a **synthetic
     `ref=eN`** (sequential within the snapshot; satisfies the format and links
     `ActionEffect.action` to its node),
  4. build one `ActionEffect` (leaving `diff` empty — filled server-side; see Data flow).
- **background/service worker** — buffers `ActionEffect[]` per session; POSTs on Stop (Mode M) or
  on a flush interval (Mode S).
- **popup** — record/stop toggle, session name, ingest URL (default `http://127.0.0.1:<port>`).

### 2. `src/recorder/snapshot-dom.ts` — the a11y-tree serializer (new, in-repo, pure)
The one genuinely new algorithm and the **riskiest piece**. Input: a DOM/a11y representation;
output: a string that `parseSnapshot` (`src/playwright/snapshot.ts`) reads byte-compatibly.

The format contract, from `parseSnapshot` (small + fully specified):
- one node per line: `<role> "<name>" [ref=eN]`, indentation = depth (leading-space count),
- a `/url:` line immediately after a node declares that node's link destination,
- a line survives parsing only if it has a quoted name OR a bracketed attribute — so
  **icon-only (nameless) nodes must carry at least `[ref=eN]`** to not be dropped as prose,
- roles may be lowercase (`link`, `searchbox`) or capitalized (`StaticText`, `RootWebArea`).

The in-repo `snapshot-dom.ts` is the **spec + test oracle**; the content script runs a browser-side
twin of the same logic. Kept in-repo so the parity test (unit 2 in Testing) runs in vitest.

### 3. `webnav dev ingest` — new CLI verb + localhost HTTP receiver
- Starts a tiny localhost HTTP server on a port.
- Accepts `POST {sessionId, effects: ActionEffect[]}`.
- For each effect: if `diff` is empty, compute it server-side —
  `diffSnapshots(parseSnapshot(fromSnapshot), parseSnapshot(toSnapshot))` (note: `diffSnapshots`
  takes `SnapNode[]`, so parse both strings first) — then `RecordStore.append(sessionId, effect)`.
  Reuses tested code; keeps the extension dumb.
- Additive: a new case in `cli.ts` / `cli-spec.ts`; alters no other verb.

**Boundary that matters:** the extension's ONLY contract with webnav is `ActionEffect[]` (defined in
`src/mapstore/record.ts`) over HTTP. Everything downstream is unchanged.

## Data flow (one recorded flow)

```
QA runs:  webnav dev ingest                         # starts localhost receiver on a port
QA in Chrome:  Record → logs in, navigates, clicks around → Stop
   each interaction → content script builds an ActionEffect:
     { fromUrl, fromSnapshot(a11y→parity text),
       action{ synthetic ref, fingerprint{role,name,near} },
       toUrl, toSnapshot, navigated, diff:empty }
   on Stop → background POSTs {sessionId, effects[]} → receiver
   receiver → (fill diff via diffSnapshots) → RecordStore.append(...) → webnav.db
QA runs:  webnav dev graph-analyse <sessionId> --draft    # existing, unchanged
          webnav dev graph-edit ...                        # existing, unchanged
          webnav walk --start ... --goal ...               # existing, unchanged
```

`diff` is computed **server-side in the ingest verb**, not in the extension — reuses the exact
existing `diffSnapshots` and keeps the browser code minimal.
`ponytail:` empty-diff-in-extension, filled server-side; move to browser only if the receiver
becomes a bottleneck (it won't for hand-recorded sessions).

## Privacy & the secret-field rule (trust boundary — even for Day-1 Mode M)

- **Never record typed secret values.** Password fields and `autocomplete=cc-*`/PII inputs: record
  the field's *fingerprint* (so walk knows "type the password here") but **never the characters**.
  Mirrors webnav's existing "credentials never in the map" rule.
- Snapshots are accessibility **text** (roles/names/structure), never screenshots.
- Mode M is explicit per-session. Mode S (later) is install-time enroll, **first-party internal
  apps only** — recording arbitrary third-party open-web browsing is out of scope and off the table
  for this design (the privacy story only holds for a company's own app + its own consented staff).

## Testing (the runnable checks that matter)

1. **Serializer parity test (critical):** feed known a11y structures to `snapshot-dom.ts`; assert
   `parseSnapshot(output)` yields the expected `SnapNode[]` — covering `/url:` lines, icon-only
   (nameless + `[ref]`) nodes, and depth/`near` anchoring. If this passes, a human-recorded session
   is indistinguishable to the pipeline from an agent-recorded one — which is what guarantees the
   agent path is unaffected.
2. **Ingest round-trip test:** POST a fixture `ActionEffect[]` to the receiver → assert rows land in
   `RecordStore` → assert `draftFromEffects` produces a walkable draft.
3. **Extension smoke (manual):** record saucedemo login→checkout in Chrome, `dev ingest`,
   `graph-analyse --draft`, `graph-edit`, then `walk` it.

## Scope — deliberately NOT in this build (named, not built)

- No hosted backend (Day-1 is local `webnav.db` only).
- No Mode-S enrollment system (the always-on flag reuses the same capture; the enrollment/consent
  infra is later).
- No usage-weighting yet — folding many sessions into one frequency-weighted map is the Option-1
  background refinement (post-Day-1; connects to the parked hosted usage-weights work in CLAUDE.md).
- Chrome MV3 only (no Firefox/Safari).
- No screenshots.

## What we already have vs. must build

- **Have (unchanged):** `RecordStore` (sink), `ActionEffect` type, `diffSnapshots`,
  `draftFromEffects`/`analyse.ts`, `graph-edit`, `import-map`, `walk`, `parseSnapshot`,
  `ElementFingerprint`/`deriveNear`/`resolveByFingerprint`.
- **Build:** `webnav-recorder/` extension, `src/recorder/snapshot-dom.ts` (+ parity test),
  `webnav dev ingest` verb + receiver (+ round-trip test).
