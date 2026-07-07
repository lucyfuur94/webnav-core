# Playwright-CLI Human Recorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `webnav dev record-live --session S --url U` — a human free-clicks in webnav's headed playwright-cli window; webnav captures each action as an `ActionEffect` (real-a11y snapshots) into the existing `RecordStore`, feeding the unchanged `graph-analyse --draft` → `walk` pipeline.

**Architecture:** An injected in-page listener only **tags + reports** a one-element descriptor per click/change into a `sessionStorage` queue (survives same-origin navigation). A webnav poll loop drains the queue via `eval`, takes a **rolling real-a11y snapshot** each tick, resolves each descriptor against the real tree (role+name, href disambiguation, ref-probe fallback), and appends `ActionEffect`s via existing tested code. Spec: `docs/superpowers/specs/2026-07-07-playwright-recorder-design.md`.

**Tech Stack:** TypeScript strict, ESM/NodeNext (`.js` import suffixes), vitest, existing `PlaywrightAdapter`/`RecordStore`.

## Global Constraints

- **Zero LLM** in webnav (#5a). The recorder captures mechanically; all judgment stays with the caller.
- **NO in-page serialization** of the page/tree — the descriptor identifies ONE element. The extension died on this; do not reintroduce it.
- **NO `.value` reads ever** in injected JS (secret-field rule). `kind:'input'` records THAT a field changed and which field — never content.
- **All snapshots come from playwright** (`adapter.snapshot()`), never from in-page JS.
- **Uniform JSON stdout**: the verb prints ONE JSON object to stdout (the final summary); progress/diagnostics to stderr. Exit codes 0/2/3.
- **Ambiguity → drop honestly** (never a guessed fingerprint). Navigated effects with unresolved elements still emit with `action:null` (draft's link-scan fallback handles link-navs; the cross-link mesh is the safety net).
- Reuse: `parseSnapshot`, `recoverFingerprint`, `didNavigate`, `classifyReadiness`, `parseEvalResult`, `RecordStore.appendActionEffect` — do not duplicate any of them.
- Commit after every task (`npx tsc --noEmit` + relevant vitest first). Git author is `dikshant.y`.

---

## File Structure

- **Create** `src/recorder/live.ts` — pure: event types, injected-JS constants, descriptor→node resolution, tick pairing, effect assembly.
- **Create** `tests/recorder/live.test.ts` — unit tests for all of the above.
- **Create** `src/recorder/live-record.ts` — the I/O poll loop (`runLiveRecord`), deps injected for testing.
- **Create** `tests/recorder/live-record.test.ts` — fake-adapter loop tests.
- **Modify** `src/playwright/adapter.ts` — `evalJs` gains an optional `ref` param (playwright-cli supports `eval <func> [ref]`).
- **Modify** `src/cli-spec.ts`, `src/cli.ts`, `tests/cli-spec.test.ts` — the `record-live` verb.
- **Modify** `docs/STATUS.md`, `README.md` — docs (Task 5).

---

## Task 1: Pure descriptor module — injected JS + descriptor resolution

**Files:**
- Create: `src/recorder/live.ts`
- Test: `tests/recorder/live.test.ts`

**Interfaces:**
- Consumes: `SnapNode`, `parseSnapshot` from `src/playwright/snapshot.js`; `didNavigate` from `src/explorer/diff.js`.
- Produces (later tasks rely on these exact names):
  - `interface LiveEvent { seq: number; kind: 'click' | 'input'; url: string; tagName: string; role?: string | null; ariaLabel?: string | null; leafText?: string | null; href?: string | null; placeholder?: string | null; nameAttr?: string | null; inputType?: string | null }`
  - `const INSTALLER_JS: string` — idempotent installer (returns `'already'` or `'installed'`).
  - `const DRAIN_JS: string` — atomically reads + clears the queue, returns its JSON string.
  - `function descriptorRole(ev: LiveEvent): string | null`
  - `function descriptorName(ev: LiveEvent): string | null`
  - `type Resolution = { ref: string } | { candidates: string[] } | null`
  - `function resolveEvent(ev: LiveEvent, nodes: SnapNode[]): Resolution`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/recorder/live.test.ts
import { describe, it, expect } from 'vitest';
import { parseSnapshot } from '../../src/playwright/snapshot.js';
import {
  INSTALLER_JS, DRAIN_JS, descriptorRole, descriptorName, resolveEvent, type LiveEvent,
} from '../../src/recorder/live.js';

const ev = (over: Partial<LiveEvent>): LiveEvent => ({
  seq: 1, kind: 'click', url: 'https://s.test/', tagName: 'button',
  role: null, ariaLabel: null, leafText: null, href: null, placeholder: null,
  nameAttr: null, inputType: null, ...over,
});

const SNAP = [
  'RootWebArea "Shop" [ref=e1]',
  '  button "Login" [ref=e2]',
  '  link "About" [ref=e3]',
  '    /url: https://s.test/about',
  '  link "About" [ref=e4]',
  '    /url: https://other.test/about',
  '  button "Add to cart" [ref=e5]',
  '  button "Add to cart" [ref=e6]',
  '  textbox "Username" [ref=e7]',
].join('\n');

describe('injected JS constants', () => {
  it('installer is idempotent and never reads .value', () => {
    expect(INSTALLER_JS).toContain('__webnav_installed');   // double-inject guard
    expect(INSTALLER_JS).not.toMatch(/\.value\b/);           // secret-field rule
    expect(INSTALLER_JS).toContain('sessionStorage');        // nav-surviving queue
  });
  it('drain reads and clears the queue', () => {
    expect(DRAIN_JS).toContain('__webnav_evq');
    expect(DRAIN_JS).toContain('removeItem');
  });
});

describe('descriptor derivation', () => {
  it('maps tags to roles; explicit role wins', () => {
    expect(descriptorRole(ev({ tagName: 'a' }))).toBe('link');
    expect(descriptorRole(ev({ tagName: 'div', role: 'button' }))).toBe('button');
    expect(descriptorRole(ev({ tagName: 'input', inputType: 'submit' }))).toBe('button');
    expect(descriptorRole(ev({ tagName: 'input', inputType: 'text' }))).toBe('textbox');
    expect(descriptorRole(ev({ tagName: 'div' }))).toBeNull();  // non-interactive, no role → null
  });
  it('name precedence: ariaLabel > leafText > placeholder > nameAttr', () => {
    expect(descriptorName(ev({ ariaLabel: 'X', leafText: 'Y' }))).toBe('X');
    expect(descriptorName(ev({ leafText: 'Y', placeholder: 'Z' }))).toBe('Y');
    expect(descriptorName(ev({ placeholder: 'Z' }))).toBe('Z');
    expect(descriptorName(ev({})))?.toBeNull?.();
  });
});

describe('resolveEvent', () => {
  const nodes = parseSnapshot(SNAP);
  it('unique role+name → ref', () => {
    expect(resolveEvent(ev({ tagName: 'button', leafText: 'Login' }), nodes)).toEqual({ ref: 'e2' });
  });
  it('href disambiguates identical links', () => {
    expect(resolveEvent(ev({ tagName: 'a', leafText: 'About', href: 'https://other.test/about' }), nodes))
      .toEqual({ ref: 'e4' });
  });
  it('ambiguous with no href → candidates for the probe', () => {
    expect(resolveEvent(ev({ tagName: 'button', leafText: 'Add to cart' }), nodes))
      .toEqual({ candidates: ['e5', 'e6'] });
  });
  it('no role or no name or no match → null', () => {
    expect(resolveEvent(ev({ tagName: 'div', leafText: 'Login' }), nodes)).toBeNull();
    expect(resolveEvent(ev({ tagName: 'button' }), nodes)).toBeNull();
    expect(resolveEvent(ev({ tagName: 'button', leafText: 'Nope' }), nodes)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/recorder/live.test.ts`
Expected: FAIL — cannot find module `live.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/recorder/live.ts
// Pure core of the human-driven live recorder (spec:
// docs/superpowers/specs/2026-07-07-playwright-recorder-design.md).
// The injected listener only TAGS + REPORTS one-element descriptors; ALL
// snapshotting is playwright's. No in-page tree serialization, no .value reads.

import type { SnapNode } from '../playwright/snapshot.js';
import { didNavigate } from '../explorer/diff.js';

export interface LiveEvent {
  seq: number; kind: 'click' | 'input'; url: string; tagName: string;
  role?: string | null; ariaLabel?: string | null; leafText?: string | null;
  href?: string | null; placeholder?: string | null; nameAttr?: string | null;
  inputType?: string | null;
}

// Injected once per document (idempotent — a navigation loses page JS, the loop
// re-evals this every tick). Events queue in sessionStorage: a window-scoped
// queue dies with the document, losing the navigating click — the most important
// event (the Chrome-extension bug, not re-learned twice). Secret-field rule: no
// .value access anywhere below; leafText is capped and taken from interactive
// elements / childless nodes only (containers concatenate their whole subtree —
// the extension's name-blob failure).
export const INSTALLER_JS = `() => {
  if (window.__webnav_installed) return 'already';
  window.__webnav_installed = true;
  const push = (e) => {
    const q = JSON.parse(sessionStorage.getItem('__webnav_evq') || '[]');
    const seq = (Number(sessionStorage.getItem('__webnav_seq')) || 0) + 1;
    sessionStorage.setItem('__webnav_seq', String(seq));
    q.push(Object.assign({ seq, url: location.href }, e));
    sessionStorage.setItem('__webnav_evq', JSON.stringify(q));
    return seq;
  };
  const INTERACTIVE = ['a','button','select','textarea','summary','label'];
  document.addEventListener('click', (ev) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    const el = t.closest('a,button,[role],input,select,textarea,summary,label') || t;
    const tag = el.tagName.toLowerCase();
    const takeText = INTERACTIVE.indexOf(tag) >= 0 || el.getAttribute('role') || el.children.length === 0;
    const seq = push({
      kind: 'click', tagName: tag,
      role: el.getAttribute('role'), ariaLabel: el.getAttribute('aria-label'),
      leafText: takeText ? ((el.textContent || '').trim().slice(0, 80) || null) : null,
      href: el instanceof HTMLAnchorElement ? el.href : null,
      placeholder: el.getAttribute('placeholder'), nameAttr: el.getAttribute('name'),
      inputType: el instanceof HTMLInputElement ? el.type : null,
    });
    if (el instanceof HTMLElement) el.dataset.webnavHit = String(seq);
  }, true);
  document.addEventListener('change', (ev) => {
    const el = ev.target;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return;
    push({ kind: 'input', tagName: el.tagName.toLowerCase(), role: el.getAttribute('role'),
      ariaLabel: el.getAttribute('aria-label'), leafText: null, href: null,
      placeholder: el.getAttribute('placeholder'), nameAttr: el.getAttribute('name'),
      inputType: el instanceof HTMLInputElement ? el.type : null });
  }, true);
  return 'installed';
}`;

// Atomic read+clear: draining and processing are one step, so no event is seen twice.
export const DRAIN_JS = `() => {
  const q = sessionStorage.getItem('__webnav_evq') || '[]';
  sessionStorage.removeItem('__webnav_evq');
  return q;
}`;

const TAG_ROLE: Record<string, string> = {
  a: 'link', button: 'button', select: 'combobox', textarea: 'textbox', summary: 'button',
};
export function descriptorRole(ev: LiveEvent): string | null {
  if (ev.role) return ev.role;
  if (ev.tagName === 'input') {
    if (ev.inputType === 'submit' || ev.inputType === 'button') return 'button';
    if (ev.inputType === 'checkbox') return 'checkbox';
    if (ev.inputType === 'radio') return 'radio';
    return 'textbox';
  }
  return TAG_ROLE[ev.tagName] ?? null;
}
export function descriptorName(ev: LiveEvent): string | null {
  return ev.ariaLabel || ev.leafText || ev.placeholder || ev.nameAttr || null;
}

export type Resolution = { ref: string } | { candidates: string[] } | null;

/** Resolve a descriptor against a REAL playwright snapshot. Strict: no role/name
 *  → null; unique role+name → ref; multiple + href → match the link target
 *  (host+path); still multiple → candidates (the loop may probe them); else null. */
export function resolveEvent(ev: LiveEvent, nodes: SnapNode[]): Resolution {
  const role = descriptorRole(ev), name = descriptorName(ev);
  if (!role || !name) return null;
  const cands = nodes.filter((n) => n.ref && n.role === role && n.name === name);
  if (cands.length === 0) return null;
  if (cands.length === 1) return { ref: cands[0].ref! };
  if (ev.href) {
    const byHref = cands.filter((n) => n.url && !didNavigate(n.url, ev.href!));
    if (byHref.length === 1) return { ref: byHref[0].ref! };
  }
  return { candidates: cands.map((n) => n.ref!) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/recorder/live.test.ts`
Expected: PASS. Also `npx tsc --noEmit` exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/recorder/live.ts tests/recorder/live.test.ts
git commit -m "feat(recorder): live-record pure core — injected JS + descriptor resolution"
```

---

## Task 2: Pure tick pairing + effect assembly

**Files:**
- Modify: `src/recorder/live.ts` (append)
- Test: `tests/recorder/live.test.ts` (append)

**Interfaces:**
- Consumes: Task 1 exports; `parseSnapshot` ; `recoverFingerprint` from `src/playwright/fingerprint.js`; `diffSnapshots`, `didNavigate` from `src/explorer/diff.js`; `ActionEffect`, `ActionRef` from `src/mapstore/record.js`.
- Produces:
  - `interface Tick { url: string; snapshot: string }`
  - `function fromTickFor(ev: LiveEvent, ticks: Tick[], uptoIdx: number): number` — index of the latest tick `≤ uptoIdx` whose URL is same-page as `ev.url` (`!didNavigate`), or `-1`.
  - `function chooseToTick(drainIdx: number, ticks: Tick[], hasLaterClick: boolean): number` — `-1` = not decidable yet (need tick `drainIdx+1`); else the index of the event's landing tick. Rule: with `t0 = ticks[drainIdx]`, `t1 = ticks[drainIdx+1]`: no `t1` → `-1`; `didNavigate(t0.url, t1.url) && !hasLaterClick` → `drainIdx+1` (late-landing navigation belongs to this event); else `drainIdx`.
  - `function assembleEffect(ev: LiveEvent, ref: string | null, from: Tick, to: Tick): ActionEffect | null` — null only for an unresolved same-page **click** (noise); navigated clicks emit with `action:null` (draft link-scan fallback); inputs always emit.

- [ ] **Step 1: Write the failing test (append to tests/recorder/live.test.ts)**

```typescript
import { fromTickFor, chooseToTick, assembleEffect, type Tick } from '../../src/recorder/live.js';

const LOGIN_SNAP = ['RootWebArea "Login" [ref=e1]', '  textbox "Username" [ref=e2]',
  '  button "Login" [ref=e3]'].join('\n');
const INV_SNAP = ['RootWebArea "Products" [ref=e1]', '  button "Open Menu" [ref=e2]'].join('\n');
const tLogin: Tick = { url: 'https://s.test/', snapshot: LOGIN_SNAP };
const tInv: Tick = { url: 'https://s.test/inventory.html', snapshot: INV_SNAP };

describe('tick pairing', () => {
  it('fromTickFor picks the latest same-page tick', () => {
    expect(fromTickFor(ev({ url: 'https://s.test/?q=1' }), [tLogin, tInv], 1)).toBe(0); // query ≠ nav
    expect(fromTickFor(ev({ url: 'https://nowhere.test/' }), [tLogin, tInv], 1)).toBe(-1);
  });
  it('chooseToTick waits for the lookahead tick, then attributes a late landing', () => {
    expect(chooseToTick(0, [tLogin], false)).toBe(-1);              // no lookahead yet
    expect(chooseToTick(0, [tLogin, tInv], false)).toBe(1);         // nav landed at next tick → it's ours
    expect(chooseToTick(0, [tLogin, tInv], true)).toBe(0);          // a later click owns the landing
    expect(chooseToTick(0, [tLogin, tLogin], false)).toBe(0);       // stable → same tick
  });
});

describe('assembleEffect', () => {
  it('navigated click with resolved ref → full action + recovered fp + navigated true', () => {
    const e = ev({ tagName: 'button', leafText: 'Login' });
    const fx = assembleEffect(e, 'e3', tLogin, tInv)!;
    expect(fx.navigated).toBe(true);
    expect(fx.action?.ref).toBe('e3');
    expect(fx.action?.elementFp?.role).toBe('button');
    expect(fx.action?.elementFp?.name).toBe('Login');
    expect(fx.diff).toBeTruthy();
  });
  it('navigated click UNRESOLVED → emits with action:null (draft link-scan fallback)', () => {
    const fx = assembleEffect(ev({ tagName: 'div' }), null, tLogin, tInv)!;
    expect(fx.action).toBeNull();
    expect(fx.navigated).toBe(true);
  });
  it('same-page click unresolved → null (dropped noise)', () => {
    expect(assembleEffect(ev({ tagName: 'div' }), null, tLogin, tLogin)).toBeNull();
  });
  it('input event always emits, with the FIELD identity and never a value', () => {
    const e = ev({ kind: 'input', tagName: 'input', inputType: 'text', placeholder: 'Username' });
    const fx = assembleEffect(e, null, tLogin, tLogin)!;
    expect(fx.action?.role).toBe('textbox');
    expect(fx.action?.name).toBe('Username');
    expect(JSON.stringify(fx)).not.toContain('secret');
  });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run tests/recorder/live.test.ts` — new cases FAIL (missing exports).

- [ ] **Step 3: Implement (append to src/recorder/live.ts)**

```typescript
import { parseSnapshot } from '../playwright/snapshot.js';
import { recoverFingerprint } from '../playwright/fingerprint.js';
import { diffSnapshots } from '../explorer/diff.js';
import type { ActionEffect, ActionRef } from '../mapstore/record.js';

export interface Tick { url: string; snapshot: string }

/** Latest tick ≤ uptoIdx on the same page as the event (query/hash ignored). */
export function fromTickFor(ev: LiveEvent, ticks: Tick[], uptoIdx: number): number {
  for (let i = Math.min(uptoIdx, ticks.length - 1); i >= 0; i--) {
    if (!didNavigate(ticks[i].url, ev.url)) return i;
  }
  return -1;
}

/** Which tick is the event's landing? -1 = wait (need the lookahead tick).
 *  A navigation often lands AFTER the drain tick; the one-tick lookahead
 *  attributes it — unless a later click was drained, which then owns it.
 *  ponytail: bursts inside one interval can misattribute; interval default
 *  500ms makes that rare for deliberate QA clicking. */
export function chooseToTick(drainIdx: number, ticks: Tick[], hasLaterClick: boolean): number {
  const t0 = ticks[drainIdx], t1 = ticks[drainIdx + 1];
  if (!t0) return -1;
  if (!t1) return -1;
  if (didNavigate(t0.url, t1.url) && !hasLaterClick) return drainIdx + 1;
  return drainIdx;
}

/** Build the ActionEffect. Unresolved same-page CLICKS are dropped (noise);
 *  unresolved NAVIGATED clicks still emit with action:null (the draft's
 *  link-scan + cross-link mesh recover link edges); inputs always emit —
 *  the field identity powers the draft's login/credentials linkage. */
export function assembleEffect(ev: LiveEvent, ref: string | null, from: Tick, to: Tick): ActionEffect | null {
  const navigated = didNavigate(ev.url, to.url);
  const role = descriptorRole(ev), name = descriptorName(ev);
  let action: ActionRef | null = null;
  if (ref) {
    const fromNodes = parseSnapshot(from.snapshot);
    action = { role: role ?? '', name, ref, elementFp: recoverFingerprint(fromNodes, ref) };
  } else if (ev.kind === 'input' && role && name) {
    action = { role, name, ref: null, elementFp: { role, name, near: null } };
  } else if (!navigated) {
    return null;   // unresolved same-page click → honest drop
  }
  return {
    fromUrl: ev.url, fromSnapshot: from.snapshot,
    action,
    toUrl: to.url, toSnapshot: to.snapshot,
    navigated,
    diff: diffSnapshots(parseSnapshot(from.snapshot), parseSnapshot(to.snapshot)),
  };
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/recorder/live.test.ts && npx tsc --noEmit` — all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/recorder/live.ts tests/recorder/live.test.ts
git commit -m "feat(recorder): tick pairing + ActionEffect assembly (one-tick lookahead)"
```

---

## Task 3: The poll loop + `evalJs` ref param

**Files:**
- Modify: `src/playwright/adapter.ts:65` (evalJs signature)
- Create: `src/recorder/live-record.ts`
- Test: `tests/recorder/live-record.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–2; `parseEvalResult` from `src/router/browse.js`; `classifyReadiness` from `src/router/readiness.js`; `RecordStore` (`isActive`, `appendActionEffect`).
- Produces:
  - `PlaywrightAdapter.evalJs(func: string, ref?: string)` — backward compatible.
  - `interface LiveRecordDeps { adapter: { evalJs(f: string, ref?: string): Promise<string>; snapshot(): Promise<string>; currentUrl(): Promise<string>; close(): Promise<unknown> }; store: { isActive(s: string): boolean; appendActionEffect(s: string, fx: ActionEffect): void }; sessionId: string; intervalMs: number; log: (line: string) => void; isStopped: () => boolean; sleep?: (ms: number) => Promise<void> }`
  - `async function runLiveRecord(deps: LiveRecordDeps): Promise<{ appended: number; ticks: number }>`

**Loop, one tick (implement exactly):**
1. `evalJs(INSTALLER_JS)` (idempotent — re-injects after any navigation).
2. `raw = parseEvalResult(await evalJs(DRAIN_JS))`; `events = JSON.parse(raw || '[]')`; append each to `pending` with `drainIdx = ticks.length` (the tick about to be taken).
3. `snap = await adapter.snapshot()`; `url = await adapter.currentUrl()`; if `classifyReadiness(snap) !== 'loading'` push `{url, snapshot}` to `ticks` (else re-push the previous tick so indices still advance — a loading shell must never become a fromSnapshot).
4. For each pending event, `to = chooseToTick(ev.drainIdx, ticks, pending.some(later click with drainIdx > ev.drainIdx))`; if `-1` keep pending (max 3 extra ticks, then force `to = drainIdx`); else:
   - `fromIdx = fromTickFor(ev, ticks, ev.drainIdx - 1)`; if `-1` fall back to `ev.drainIdx` if same-page, else drop with a stderr log.
   - `res = resolveEvent(ev, parseSnapshot(ticks[fromIdx].snapshot))`.
   - If `res` has `candidates` AND the current page is still same-page as `ev.url`: probe each candidate `c`: `parseEvalResult(await evalJs('(el) => el.dataset.webnavHit || null', c)) === String(ev.seq)` → that ref; no hit → `null`.
   - `fx = assembleEffect(ev, ref, ticks[fromIdx], ticks[to])`; if non-null → `store.appendActionEffect(sessionId, fx)`, `appended++`, `log(...)`.
5. Exit when `isStopped()` or `!store.isActive(sessionId)`; on exit `adapter.close().catch(()=>{})`, return `{appended, ticks: ticks.length}`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/recorder/live-record.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { RecordStore } from '../../src/mapstore/record.js';
import { runLiveRecord } from '../../src/recorder/live-record.js';

const LOGIN = ['RootWebArea "Login" [ref=e1]', '  textbox "Username" [ref=e2]', '  button "Login" [ref=e3]'].join('\n');
const INV = ['RootWebArea "Products" [ref=e1]', '  button "Open Menu" [ref=e2]'].join('\n');

// Scripted fake adapter: tick-indexed pages + one queued click event.
function fakeAdapter(script: { url: string; snap: string; drain?: string }[]) {
  let tick = -1;
  return {
    evalJs: async (f: string) => {
      if (f.includes('__webnav_installed')) return 'installed';
      if (f.includes('__webnav_evq')) return script[Math.min(tick + 1, script.length - 1)].drain ?? '[]';
      return 'null'; // probe
    },
    snapshot: async () => { tick = Math.min(tick + 1, script.length - 1); return script[tick].snap; },
    currentUrl: async () => script[Math.min(tick, script.length - 1)].url,
    close: async () => '',
  };
}

it('records a human login click as a navigated ActionEffect', async () => {
  const store = RecordStore.fromDatabase(new Database(':memory:'));
  store.start('live-1');
  const clickEvt = JSON.stringify([{ seq: 1, kind: 'click', url: 'https://s.test/',
    tagName: 'button', leafText: 'Login' }]);
  // tick0: login page; tick1: login page + the click drains; tick2: landed on inventory
  const adapter = fakeAdapter([
    { url: 'https://s.test/', snap: LOGIN },
    { url: 'https://s.test/', snap: LOGIN, drain: clickEvt },
    { url: 'https://s.test/inventory.html', snap: INV },
    { url: 'https://s.test/inventory.html', snap: INV },
  ]);
  let ticks = 0;
  const res = await runLiveRecord({
    adapter, store, sessionId: 'live-1', intervalMs: 0,
    log: () => {}, isStopped: () => ++ticks > 5, sleep: async () => {},
  });
  expect(res.appended).toBe(1);
  const fx = store.actionEffects('live-1');
  expect(fx.length).toBe(1);
  expect(fx[0].navigated).toBe(true);
  expect(fx[0].action?.elementFp?.name).toBe('Login');
  expect(fx[0].toUrl).toContain('/inventory.html');
});

it('stops when the record session is stopped externally', async () => {
  const store = RecordStore.fromDatabase(new Database(':memory:'));
  store.start('live-2'); store.stop('live-2');
  const adapter = fakeAdapter([{ url: 'https://s.test/', snap: LOGIN }]);
  const res = await runLiveRecord({ adapter, store, sessionId: 'live-2', intervalMs: 0,
    log: () => {}, isStopped: () => false, sleep: async () => {} });
  expect(res.appended).toBe(0);   // isActive false → immediate exit
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/recorder/live-record.test.ts` FAILS (no module).

- [ ] **Step 3: Implement**

First the adapter tweak (`src/playwright/adapter.ts:65`):

```typescript
  evalJs(func: string, ref?: string) { return this.exec('eval', func, ...(ref ? [ref] : [])); }
```

Then `src/recorder/live-record.ts` implementing the loop EXACTLY as specified in the task header (full listing — transcribe, don't improvise):

```typescript
// The live-record poll loop: drain the injected listener's queue, keep a rolling
// buffer of REAL a11y snapshots, pair events to ticks, append ActionEffects.
// Deps injected so tests drive it with a scripted fake adapter.
import {
  INSTALLER_JS, DRAIN_JS, resolveEvent, fromTickFor, chooseToTick, assembleEffect,
  type LiveEvent, type Tick,
} from './live.js';
import { parseSnapshot } from '../playwright/snapshot.js';
import { parseEvalResult } from '../router/browse.js';
import { classifyReadiness } from '../router/readiness.js';
import { didNavigate } from '../explorer/diff.js';
import type { ActionEffect } from '../mapstore/record.js';

export interface LiveRecordDeps {
  adapter: { evalJs(f: string, ref?: string): Promise<string>; snapshot(): Promise<string>;
    currentUrl(): Promise<string>; close(): Promise<unknown> };
  store: { isActive(s: string): boolean; appendActionEffect(s: string, fx: ActionEffect): void };
  sessionId: string; intervalMs: number;
  log: (line: string) => void; isStopped: () => boolean;
  sleep?: (ms: number) => Promise<void>;
}

interface Pending { ev: LiveEvent; drainIdx: number; waits: number }

export async function runLiveRecord(deps: LiveRecordDeps): Promise<{ appended: number; ticks: number }> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const ticks: Tick[] = [];
  const pending: Pending[] = [];
  let appended = 0;
  try {
    while (!deps.isStopped() && deps.store.isActive(deps.sessionId)) {
      await deps.adapter.evalJs(INSTALLER_JS).catch(() => {});          // idempotent re-inject
      const raw = parseEvalResult(await deps.adapter.evalJs(DRAIN_JS).catch(() => '[]'));
      let events: LiveEvent[] = [];
      try { events = JSON.parse(raw || '[]'); } catch { deps.log(`skip: undrainable batch`); }
      for (const ev of events) pending.push({ ev, drainIdx: ticks.length, waits: 0 });

      const snap = await deps.adapter.snapshot();
      const url = await deps.adapter.currentUrl();
      if (classifyReadiness(snap) !== 'loading') ticks.push({ url, snapshot: snap });
      else ticks.push(ticks[ticks.length - 1] ?? { url, snapshot: snap });  // never archive a loading shell

      for (let i = pending.length - 1; i >= 0; i--) {
        const p = pending[i];
        const hasLaterClick = pending.some((q) => q !== p && q.ev.kind === 'click' && q.drainIdx > p.drainIdx);
        let to = chooseToTick(p.drainIdx, ticks, hasLaterClick);
        if (to === -1 && ++p.waits < 3) continue;                        // wait for the lookahead tick
        if (to === -1) to = Math.min(p.drainIdx, ticks.length - 1);      // give up waiting → same tick
        let fromIdx = fromTickFor(p.ev, ticks, p.drainIdx - 1);
        if (fromIdx === -1 && !didNavigate(ticks[Math.min(p.drainIdx, ticks.length - 1)].url, p.ev.url)) {
          fromIdx = Math.min(p.drainIdx, ticks.length - 1);
        }
        pending.splice(i, 1);
        if (fromIdx === -1) { deps.log(`skip: no from-page for seq ${p.ev.seq}`); continue; }

        const res = resolveEvent(p.ev, parseSnapshot(ticks[fromIdx].snapshot));
        let ref: string | null = res && 'ref' in res ? res.ref : null;
        if (res && 'candidates' in res && !didNavigate(url, p.ev.url)) {
          for (const c of res.candidates) {                             // ref-scoped probe (same doc only)
            const hit = parseEvalResult(await deps.adapter.evalJs('(el) => el.dataset.webnavHit || null', c).catch(() => 'null'));
            if (hit === String(p.ev.seq)) { ref = c; break; }
          }
        }
        const fx = assembleEffect(p.ev, ref, ticks[fromIdx], ticks[to]);
        if (fx) { deps.store.appendActionEffect(deps.sessionId, fx); appended++;
          deps.log(`recorded ${fx.navigated ? 'nav' : fx.action?.role ?? 'action'}: ${fx.action?.name ?? fx.toUrl}`); }
        else deps.log(`skip: unresolved same-page click seq ${p.ev.seq}`);
      }
      await sleep(deps.intervalMs);
    }
  } finally {
    await deps.adapter.close().catch(() => {});
  }
  return { appended, ticks: ticks.length };
}
```

- [ ] **Step 4: Run tests + full suite** — `npx vitest run tests/recorder && npx vitest run && npx tsc --noEmit` all green.

- [ ] **Step 5: Commit**

```bash
git add src/playwright/adapter.ts src/recorder/live-record.ts tests/recorder/live-record.test.ts
git commit -m "feat(recorder): live-record poll loop (drain, rolling snapshots, probe, append)"
```

---

## Task 4: The `dev record-live` verb

**Files:**
- Modify: `src/cli-spec.ts` (dev group, near `record-start`), `src/cli.ts` (Args union + parse + dispatch), `tests/cli-spec.test.ts` (verb list — insert `'record-live'` alphabetically between `read` and `record-start`).

**Interfaces:** consumes `runLiveRecord`, `PlaywrightAdapter`, `RecordStore`, `dbPath`.

- [ ] **Step 1: cli-spec entry** (match the neighbors' exact object shape — `summary`/`args`/`flags`/`example`; read the file first):

```typescript
{
  name: 'record-live',
  summary: 'Record a site by BROWSING it yourself: opens a headed browser you click through; every action is captured (real-a11y snapshots) into the record buffer. Stop with `dev record-stop --session S` (or Ctrl-C), then `dev graph-analyse <S> --draft`. Secret rule: typed values are never recorded.',
  args: [],
  flags: [
    { name: '--session', takesValue: true, description: 'Record session id (also the browser session).' },
    { name: '--url', takesValue: true, description: 'Where the recording starts (the site to map).' },
    { name: '--interval', takesValue: true, description: 'Poll interval ms (default 500).' },
  ],
  example: 'webnav dev record-live --session map-1 --url https://www.saucedemo.com',
},
```

- [ ] **Step 2: cli.ts** — Args union member `| { cmd: 'record-live'; session: string; url: string; interval: number }`; parse line near the other record verbs:

```typescript
  if (cmd === 'record-live') return { cmd, session: flagValue(rest, '--session') ?? '', url: flagValue(rest, '--url') ?? '', interval: Number(flagValue(rest, '--interval') ?? 500) };
```

Dispatch (long-running; stderr progress, stdout = ONE final JSON object; model on the existing handlers' import style):

```typescript
  if (args.cmd === 'record-live') {
    if (!args.session || !args.url) { console.error('record-live needs --session and --url'); process.exit(2); }
    const { runLiveRecord } = await import('./recorder/live-record.js');
    const { PlaywrightAdapter } = await import('./playwright/adapter.js');
    const { RecordStore } = await import('./mapstore/record.js');
    const store = new RecordStore(dbPath());
    store.start(args.session);
    const adapter = new PlaywrightAdapter(args.session);      // headed by default
    await adapter.open(args.url);
    let stopped = false;
    process.on('SIGINT', () => { stopped = true; });
    process.stderr.write(`recording — click around in the browser window; stop with Ctrl-C or \`webnav dev record-stop --session ${args.session}\`\n`);
    const res = await runLiveRecord({ adapter, store, sessionId: args.session,
      intervalMs: args.interval, log: (l) => process.stderr.write(l + '\n'), isStopped: () => stopped });
    store.stop(args.session);
    console.log(JSON.stringify({ status: 'stopped', session: args.session, appended: res.appended,
      next: `webnav dev graph-analyse ${args.session} --draft` }, null, 2));
    process.exit(res.appended > 0 ? 0 : 3);
  }
```

- [ ] **Step 3: verb-list test** — add `'record-live'` to `tests/cli-spec.test.ts:7` (alphabetical: after `read`, before `record-start`).

- [ ] **Step 4: Verify** — `npx vitest run && npx tsc --noEmit` green; `./bin/webnav dev record-live --help | head -5` shows the verb (manual smoke; needs no browser).

- [ ] **Step 5: Commit**

```bash
git add src/cli-spec.ts src/cli.ts tests/cli-spec.test.ts
git commit -m "feat(cli): dev record-live — free-click human recording verb"
```

---

## Task 5: Docs + live acceptance

**Files:**
- Modify: `docs/STATUS.md` (recorder pivot entry: extension shelved with evidence, record-live built, acceptance pending), `README.md` (replace the extension bullet in the map-building paths with `dev record-live`; drop/park the extension mention).

- [ ] **Step 1:** STATUS entry — dated 2026-07-07 (later): capture pivot (extension → playwright-cli, evidence: 0-edges vs correct-map+`acceptsInput:credentials`), `record-live` shipped, unit-tested; **live acceptance pending (human)**: `record-live` on saucedemo, free-click login→add-to-cart→cart, `graph-analyse --draft` must show the login navigate edge + `needs` linkage, then `walk` it. Note cred-inject as next increment.
- [ ] **Step 2:** README — the third map-building path becomes: "**Record by browsing it yourself:** `webnav dev record-live --session S --url <site>` — click through in the opened window; stop; `graph-analyse --draft`." Remove the extension path (one line: superseded, see spec).
- [ ] **Step 3:** Commit:

```bash
git add docs/STATUS.md README.md
git commit -m "docs: record-live replaces the extension capture path (STATUS + README)"
```

---

## Self-Review

**Spec coverage:** injected listener (tag+report, sessionStorage, idempotent) → Task 1; drain+rolling-snapshot loop, descriptor resolution, ref-probe, honest drops, `action:null` nav fallback → Tasks 1–3; verb → Task 4; docs + human acceptance → Task 5. Cred-inject explicitly NOT here (next increment). ✓
**Placeholders:** none — every step carries full code. ✓
**Type consistency:** `LiveEvent`/`Tick`/`Resolution` identical across tasks; `evalJs(func, ref?)` matches Task 3's deps signature; `appendActionEffect` (not `append`); `parseEvalResult` is exported from `browse.ts` (verified). ✓
**Known risks for the implementer:** (1) playwright-cli `eval` output shape — `parseEvalResult` handles the `### Result` wrapper; if drain returns a JSON-quoted string, `JSON.parse` after unwrap (the code does `raw || '[]'` then parse — if it throws on double-quoted output, unwrap once more; the unit fake returns bare JSON so the LIVE smoke is where this surfaces). (2) `classifyReadiness` import path `src/router/readiness.js` — verify at implementation. (3) The live acceptance is the real gate — unit green ≠ done.
