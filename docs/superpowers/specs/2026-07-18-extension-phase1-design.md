# Extension Phase 1 — real native-AX capture (2026-07-18)

> Build increment following the PASSED snapshot-compat spike
> (`2026-07-18-extension-snapshot-spike-findings.md`). Direction:
> `2026-07-18-in-browser-extension-direction.md`. Principle: FIX THE CAMERA FIRST — prove and
> harden the capture sensor before any sidebar / claude -p / replay UI is built on top of it.

## What exists (scouted, reuse — do not rebuild)

- `webnav-extension/` (repo root): an MV3 extension with a SOUND architecture — content script
  captures from/to snapshots + clicked ref → `background.ts` correlates click→settle into
  `RawStep`s → POSTs to the server. KEEP this skeleton. Its SENSOR is a DOM-walk
  (`content.ts` `domToSNode`/`accessibleName`) — the approach that produced 0 edges before; REPLACE it.
- `src/recorder/ingest.ts` `serveIngest(port, store)` (`webnav ingest`): a tested localhost
  receiver. Philosophy — the extension stays DUMB; the server reconstructs fingerprints + diffs
  with tested code. Extend this, don't fork it.
- `tests/tmp/spike/adapter.mts` — the spike-proven `adaptAXTree(axNodes) → SnapNode[]` (CDP
  getFullAXTree → webnav's contract). Promote into `src/`, harden, test.

## Increment A — server-side AX adapter, hardened + tested (fully verifiable headlessly)

The load-bearing, reusable artifact. No extension load needed to verify.

1. **Promote** `adaptAXTree` → `src/playwright/ax-adapter.ts` (exported, typed `AXNode` in).
   Keep DROP set + ROLE_MAP; it consumes the raw CDP `Accessibility.getFullAXTree` node list and
   emits `SnapNode[]` identical in shape to `parseSnapshot`.
2. **Harden the ROLE_MAP on the untested interactive roles** (spike condition #2 — only
   button/link/textbox/tab were exercised). Build a rich-controls fixture (native `<select>`,
   checkboxes, radios, a role=switch, an ARIA combobox, a `role=menu`/menuitem set) and, using the
   spike's CDP-capture path, extend ROLE_MAP until every interactive control cross-resolves against
   its playwright snapshot (`resolveByFingerprint`, both directions, zero wrong-resolve). Record
   the CDP→ARIA token map discovered (e.g. `checkBox`→`checkbox`, `popUpButton`/`comboBoxSelect`→
   `combobox`, `menuListPopup`→`menu` — verify actual tokens empirically, do not assume).
3. **Unit tests** in `tests/playwright/ax-adapter.test.ts`: feed saved raw-AX JSON fixtures (copy a
   few from the spike's `out/*.b.ax.json` into a committed `tests/fixtures/ax/`) → assert the
   adapted `SnapNode[]` has the expected roles/names/urls, the DROP set removes
   RootWebArea/StaticText/InlineTextBox, `image`→`img`, and each hardened interactive role maps.
4. **Server ingest path for raw AX.** Add `ingestAX(body, store)` beside `ingest`: body carries
   per-step `{fromUrl, fromAX, toUrl, toAX, clickedBackendNodeId?}`; the server runs `adaptAXTree`
   on each, then reuses `reconstructEffect`-equivalent logic (fingerprint + diff) to build
   ActionEffects. Serialize `SnapNode[]`→the YAML string `parseSnapshot` expects, OR refactor
   `reconstructEffect` to accept `SnapNode[]` directly (prefer the latter — avoids a lossy
   round-trip). `serveIngest` gains a `POST /ingest-ax` route. Keep the existing `/ingest`
   (DOM-walk path) working for back-compat OR retire it if nothing else uses it (check).
5. Guidelines + full suite green; the map still stores structure never values.

## Increment B — extension sensor swap (build; final verify is user-gated)

Reuse `webnav-extension/`'s correlation skeleton; replace the sensor.

1. `manifest.json`: add the `debugger` permission (getFullAXTree needs CDP; a content script
   cannot call it — same permission Anthropic's extension uses; the yellow banner is accepted,
   Claude's extension shows it too).
2. `background.ts`: on Record, `chrome.debugger.attach({tabId}, "1.3")`; capture points call
   `chrome.debugger.sendCommand({tabId}, "Accessibility.getFullAXTree")` → raw AX; on Stop,
   POST the buffered `{fromAX,toAX,...}` steps to `http://127.0.0.1:<port>/ingest-ax`.
   Click→AX correlation (which node was clicked): defer the full record loop to a later increment;
   Increment B's testable goal is a "Capture this page" action that sends ONE page's getFullAXTree
   and confirms it lands as a valid SnapNode[] in webnav.db matching playwright for that live page
   (kills the spike's two-separate-captures confound — same live page, real debugger plumbing).
3. Delete/replace the DOM-walk `content.ts` sensor (the click listener stays if needed for later
   correlation, but the snapshot now comes from background+debugger, not the DOM walk).
4. **User-gated verification** (hand off, do not claim done): load unpacked → visit a rich-controls
   page + a shadow-DOM page → Capture → confirm the ingested SnapNode matches playwright + the
   untested roles/shadow-DOM adapt. This is the experiment that upgrades the spike to full GO.

## Out of scope (later increments, explicitly not now)

Sidebar chat UI, `claude -p` reasoning loop, the second-run graph replay, tab-group scoping,
full click→settle record loop over AX, shadow-DOM/iframe deep support. Phase 1 is the CAMERA only.

## Verification

Increment A: unit tests + a headless CDP capture of the rich-controls fixture showing 100%
cross-resolve on the newly-mapped roles (I run this). Increment B: code builds (`tsc` in
`webnav-extension/`); end-to-end is the user's load-unpacked test.
