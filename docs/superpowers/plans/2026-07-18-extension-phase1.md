# Extension Phase 1 Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Spec:
> `docs/superpowers/specs/2026-07-18-extension-phase1-design.md`. Fix the camera first —
> Increment A (server-side AX adapter, fully verifiable) before Increment B (extension, user-gated).

## Global Constraints

- Zero LLM in webnav; the adapter is pure deterministic transform. Map stores structure, never
  values (`tests/guidelines.test.ts` green). Never a wrong-resolve.
- Reuse the spike's proven `adaptAXTree` and the existing `serveIngest`/`ingest` seam + the
  `webnav-extension/` skeleton — do not rebuild what exists.
- 2-space, single quotes; TDD; full `npm test` green per task; commit per task (author dikshant.y).
- The `AXNode` type + `adaptAXTree` behavior must match what the spike captured (CDP
  `Accessibility.getFullAXTree` node shape: `{nodeId, role:{value}, name:{value}, properties[],
  childIds[], parentId, ignored}`).

---

### Task 1: Promote + harden the AX adapter (roles)
**Files:** create `src/playwright/ax-adapter.ts` (from `tests/tmp/spike/adapter.mts`, exported),
`tests/playwright/ax-adapter.test.ts`, `tests/fixtures/ax/*.json` (committed raw-AX fixtures).
**Interfaces:** `export interface AXNode {...}`; `export function adaptAXTree(nodes: AXNode[]): SnapNode[]`.
**Steps:**
- [ ] Copy the spike adapter into `src/playwright/ax-adapter.ts`; import `SnapNode` from `./snapshot.js`.
- [ ] Commit 3-4 saved raw-AX fixtures into `tests/fixtures/ax/` (icons.ax.json, table.ax.json,
      form.ax.json, plus a rich-controls one — see Task 2) from the spike's `out/*.b.ax.json`.
- [ ] TDD: `ax-adapter.test.ts` asserts, per fixture, the adapted SnapNode[]: DROP set removes
      RootWebArea/StaticText/InlineTextBox/none/presentation/LineBreak; `image`→`img`; names/urls
      preserved; refs assigned to every kept node; depth monotonic with nesting.
- [ ] `npm test` green. Commit `feat(playwright): promote CDP a11y-tree adapter into src (from spike)`.

### Task 2: Rich-controls role hardening (closes spike condition #2)
**Files:** `src/playwright/ax-adapter.ts` (ROLE_MAP), `tests/fixtures/ax/rich.ax.json`,
`tests/playwright/ax-adapter.test.ts`.
**Steps:**
- [ ] Build a rich-controls fixture page (native `<select>`, ≥2 checkboxes, a radio group, a
      `role=switch`, an ARIA combobox, a `role=menu` with menuitems). CONTROLLER captures its raw
      AX (via the spike's CDP path) + its playwright snapshot, saves the AX as `tests/fixtures/ax/rich.ax.json`.
      (This capture step is the controller's — subagents do not open browsers.)
- [ ] TDD: assert each interactive control in `rich` adapts to the ARIA role playwright emits
      (discover the actual CDP tokens from the fixture — e.g. checkBox→checkbox — do not assume),
      and that a fingerprint from the adapted tree `resolveByFingerprint`s uniquely against the
      playwright snapshot (import `recoverFingerprint`/`resolveByFingerprint`), zero wrong-resolve.
- [ ] Extend ROLE_MAP with the discovered tokens. `npm test` green.
- [ ] Commit `feat(ax-adapter): map select/checkbox/combobox/radio/switch/menu roles (spike cond #2)`.

### Task 3: Server-side raw-AX ingest path
**Files:** `src/recorder/ingest.ts` (`ingestAX` + `/ingest-ax` route; refactor `reconstructEffect`
to accept `SnapNode[]` so AX steps skip the YAML round-trip), `tests/recorder/ingest.test.ts`,
`src/cli.ts` (wire the new route into `serveIngest` — already invoked by `webnav ingest`).
**Interfaces:** `export interface RawAXStep { fromUrl; fromAX: AXNode[]; toUrl; toAX: AXNode[]; clickedBackendNodeId?: number }`;
`export function ingestAX(body: {sessionId; steps: RawAXStep[]}, store): number`.
**Steps:**
- [ ] TDD: `ingestAX` with fixture AX steps → store has ActionEffects whose from/to SnapNodes match
      `adaptAXTree` output and whose fingerprints/diffs reconstruct (reuse the tested recover/diff).
- [ ] `serveIngest` gains `POST /ingest-ax`; existing `/ingest` untouched (or retire if unused — grep first).
- [ ] `npm test` green. Commit `feat(ingest): raw-AX ingest path for the native-AX extension sensor`.

### Task 4: Controller headless verification (Increment A done)
- [ ] Rich-controls + a shadow-DOM fixture: CDP-capture both, run cross-resolve — confirm the
      newly-mapped roles hit 100% both directions, zero wrong-resolve; note shadow-DOM behavior honestly.
- [ ] Full `npm test` + `tsc` green. Update the spike-findings doc: condition #2 (role map) retired
      with evidence; shadow-DOM finding recorded.

### Task 5 (Increment B): extension sensor swap — BUILD only, user-gated verify
**Files:** `webnav-extension/manifest.json` (+`debugger`), `webnav-extension/background.ts`
(debugger attach + getFullAXTree + POST /ingest-ax), `webnav-extension/popup.ts`/`.html` (a
"Capture this page" action), replace the DOM-walk in `content.ts`.
**Steps:**
- [ ] Add `debugger` permission; background attaches `chrome.debugger`, sends
      `Accessibility.getFullAXTree`, POSTs `{fromAX,toAX}` to `/ingest-ax`.
- [ ] `tsc` clean in `webnav-extension/` (its own tsconfig). Build artifacts.
- [ ] Write a `webnav-extension/README.md` load-and-test section: load unpacked → rich-controls +
      shadow-DOM page → Capture → `webnav dev graph-analyse <session> --draft` shows the controls.
- [ ] Commit `feat(extension): native-AX capture via chrome.debugger (replaces DOM-walk sensor)`.
- [ ] HAND OFF to the user for the load-unpacked end-to-end test — do NOT claim end-to-end done.
