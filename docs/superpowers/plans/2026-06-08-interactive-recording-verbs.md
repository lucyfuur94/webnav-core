# Interactive Recording Verbs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose four `use` CLI verbs — `navigate`, `snapshot`, `click`, `type` — so an agent can drive a live page across CLI calls and record action-effects through the existing engine, enabling a Haiku subagent to map saucedemo end-to-end.

**Architecture:** Thin CLI wiring over existing pieces. Generalize `runActionRecorded` to support typing (fill) as well as clicking. Each verb reattaches the persistent `-s=<session>` playwright browser (survives across processes), captures before/after itself, and records an action-effect when the `<session>` record buffer is active. One `--session` id serves as both browser and record session.

**Tech Stack:** TypeScript (strict), Node 18+ (run via Node 24 — `cd node_modules/better-sqlite3 && npx node-gyp rebuild` on ABI errors), `better-sqlite3`, vitest, `playwright-cli` for the gated e2e. Reuses `PlaywrightAdapter`, `runActionRecorded`, `RecordStore`, `parseSnapshot`/`findByRoleAndName`.

**Spec:** `docs/superpowers/specs/2026-06-08-interactive-recording-verbs-design.md`

---

## Existing shapes this builds on (verified)

- `runActionRecorded(args: RunActionArgs)` in `src/router/browse.ts`. `RunActionArgs = { sessionId, recordStore, fromUrl, fromSnapshot, action: ActionRef, adapter? }`. The perform line is `if (args.action.ref) await adapter.act!(args.action.ref);` then snapshot-after → diff → append-if-active. Returns `{ status, recorded, navigated }`.
- `ActionRef = { role: string; name: string|null; ref: string|null }` (in `src/mapstore/record.ts`).
- `BrowseAdapter` (in `browse.ts`) has optional `snapshot?`, `act?`, `currentUrl?`, `close`. (`fill` is NOT yet on it — added in Task 1.)
- `PlaywrightAdapter` (`src/playwright/adapter.ts`): `goto(url)`, `click(ref)`, `fill(ref,text)`, `snapshot()`, `currentUrl()`, `act(ref)`, `open(url)`, `close()`, `callCount`.
- `RecordStore`: `start/stop/isActive/appendActionEffect/actionEffects`.
- `src/cli.ts`: the `use` dispatcher re-parses `[sub, ...rest]`; `flagValue(rest, '--x')` helper; `ParsedArgs` union; `main()` dynamic-import dispatch blocks; `KNOWN_VERBS` from `COMMANDS`.
- `src/cli-spec.ts`: `CONSUMER_COMMANDS` shape `{name, group?, summary, args, flags, example}`; `tests/cli-spec.test.ts` has a registry-count assertion (exact sorted name array).

---

## File structure

- **Modify** `src/router/browse.ts` — generalize `runActionRecorded` to perform `fill` when the action carries text; add `fill?` to `BrowseAdapter`.
- **Modify** `src/cli.ts` — parse + dispatch `navigate`/`snapshot`/`click`/`type`.
- **Modify** `src/cli-spec.ts` — four `CONSUMER_COMMANDS` entries; update registry-count test.
- **Create tests:** `tests/router/browse-type.test.ts`, `tests/cli/parse-interactive.test.ts`, gated `tests/e2e/interactive-cli.live.test.ts`.
- **Modify** `docs/STATUS.md`.

---

## Task 1: Generalize `runActionRecorded` to support typing — TDD

**Files:**
- Modify: `src/router/browse.ts`
- Test: extend `tests/router/browse-action.test.ts` (or new `tests/router/browse-type.test.ts`)

Add an optional `text` so the engine `fill`s when text is present, else `click`s. Add `fill?` to `BrowseAdapter`. Back-compat: click path unchanged; existing `browse-action.test.ts` stays green.

- [ ] **Step 1: Read `runActionRecorded` + `RunActionArgs` + `BrowseAdapter` in `src/router/browse.ts`**

Confirm the perform line is `if (args.action.ref) await adapter.act!(args.action.ref);` and that `RunActionArgs` has `action: ActionRef`.

- [ ] **Step 2: Write the failing test**

Create `tests/router/browse-type.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { RecordStore } from '../../src/mapstore/record.js';
import { runActionRecorded } from '../../src/router/browse.js';

const BEFORE = '- textbox "Username" [ref=e1]';
const AFTER = '- textbox "Username" [ref=e1]\n- generic "standard_user" [ref=e2]';

// Fake adapter records whether fill or act was called.
function fake(after: string, toUrl: string) {
  const calls: string[] = [];
  return {
    adapter: {
      open: async () => '',
      snapshot: async () => after,
      close: async () => '',
      act: async () => { calls.push('act'); },
      fill: async (_ref: string, text: string) => { calls.push('fill:' + text); },
      currentUrl: async () => toUrl,
    },
    calls,
  };
}

describe('runActionRecorded — type (fill)', () => {
  it('fills text (not click) when the action carries text, and records the effect', async () => {
    const rec = RecordStore.fromDatabase(new Database(':memory:'));
    rec.start('s');
    const f = fake(AFTER, 'https://x.com/login');
    const r = await runActionRecorded({
      sessionId: 's', recordStore: rec,
      fromUrl: 'https://x.com/login', fromSnapshot: BEFORE,
      action: { role: 'textbox', name: 'Username', ref: 'e1' },
      text: 'standard_user',
      adapter: f.adapter as any,
    });
    expect(r.recorded).toBe(true);
    expect(f.calls).toEqual(['fill:standard_user']);     // filled, did NOT click
    expect(rec.actionEffects('s')[0].navigated).toBe(false);
  });

  it('clicks (not fill) when no text is given', async () => {
    const rec = RecordStore.fromDatabase(new Database(':memory:'));
    rec.start('s');
    const f = fake('- button "Login" [ref=e1]', 'https://x.com/login');
    await runActionRecorded({
      sessionId: 's', recordStore: rec,
      fromUrl: 'https://x.com/login', fromSnapshot: '- button "Login" [ref=e1]',
      action: { role: 'button', name: 'Login', ref: 'e1' },
      adapter: f.adapter as any,
    });
    expect(f.calls).toEqual(['act']);                    // clicked, did NOT fill
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/router/browse-type.test.ts`
Expected: FAIL — `text` not on `RunActionArgs` (TS error) and/or it always calls `act`.

- [ ] **Step 4: Implement**

In `src/router/browse.ts`:

(a) Add `fill?` to `BrowseAdapter`:
```typescript
  fill?(ref: string, text: string): Promise<void>;
```

(b) Add `text?` to `RunActionArgs`:
```typescript
export interface RunActionArgs {
  sessionId: string;
  recordStore: RecordStore;
  fromUrl: string;
  fromSnapshot: string;
  action: ActionRef;
  text?: string;              // when present, the action TYPES (fill) instead of clicks
  adapter?: BrowseAdapter;
}
```

(c) Change the perform line from:
```typescript
    if (args.action.ref) await adapter.act!(args.action.ref);
```
to:
```typescript
    if (args.action.ref) {
      if (args.text != null) await adapter.fill!(args.action.ref, args.text);
      else await adapter.act!(args.action.ref);
    }
```

- [ ] **Step 5: Run both tests (new + existing) to verify pass + no regression**

Run: `npx vitest run tests/router/browse-type.test.ts tests/router/browse-action.test.ts`
Expected: PASS (new type tests + the existing click tests).

- [ ] **Step 6: Commit**

```bash
git add src/router/browse.ts tests/router/browse-type.test.ts
git commit -m "feat(router): runActionRecorded supports type (fill) in addition to click"
```

---

## Task 2: Parse the four interactive verbs — TDD

**Files:**
- Modify: `src/cli.ts`
- Test: `tests/cli/parse-interactive.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cli/parse-interactive.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../src/cli.js';

describe('parseArgs — interactive verbs', () => {
  it('parses navigate', () => {
    expect(parseArgs(['navigate', 'https://x.com', '--session', 's1']))
      .toEqual({ cmd: 'navigate', url: 'https://x.com', session: 's1' });
  });
  it('parses snapshot', () => {
    expect(parseArgs(['snapshot', '--session', 's1'])).toEqual({ cmd: 'snapshot', session: 's1' });
  });
  it('parses click', () => {
    expect(parseArgs(['click', 'e42', '--session', 's1']))
      .toEqual({ cmd: 'click', ref: 'e42', session: 's1' });
  });
  it('parses type with ref + text', () => {
    expect(parseArgs(['type', 'e1', 'standard_user', '--session', 's1']))
      .toEqual({ cmd: 'type', ref: 'e1', text: 'standard_user', session: 's1' });
  });
  it('routes under the use dispatcher', () => {
    expect(parseArgs(['use', 'click', 'e42', '--session', 's1']))
      .toEqual(parseArgs(['click', 'e42', '--session', 's1']));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/parse-interactive.test.ts`
Expected: FAIL — unknown command.

- [ ] **Step 3: Implement parsing**

In `src/cli.ts`, add to the `ParsedArgs` union:
```typescript
  | { cmd: 'navigate'; url: string; session: string }
  | { cmd: 'snapshot'; session: string }
  | { cmd: 'click'; ref: string; session: string }
  | { cmd: 'type'; ref: string; text: string; session: string }
```

In `parseArgs`, before the final `throw`:
```typescript
  if (cmd === 'navigate') {
    const pos = rest.filter((a) => !a.startsWith('--'));
    return { cmd, url: pos[0] ?? '', session: flagValue(rest, '--session') ?? '' };
  }
  if (cmd === 'snapshot') return { cmd, session: flagValue(rest, '--session') ?? '' };
  if (cmd === 'click') {
    const pos = rest.filter((a) => !a.startsWith('--'));
    return { cmd, ref: pos[0] ?? '', session: flagValue(rest, '--session') ?? '' };
  }
  if (cmd === 'type') {
    // positionals: ref, then text (text may contain spaces only if quoted by the shell;
    // first positional = ref, second = text).
    const pos = rest.filter((a) => !a.startsWith('--') && a !== flagValue(rest, '--session'));
    return { cmd, ref: pos[0] ?? '', text: pos[1] ?? '', session: flagValue(rest, '--session') ?? '' };
  }
```

NOTE on `type` positionals: the `--session` VALUE is a non-`--` token, so naive `rest.filter(a=>!a.startsWith('--'))` would wrongly include it. The filter above excludes the session value. Simpler-and-robust alternative the implementer may use instead: walk `rest` skipping `--session` + its value, collect the remaining positionals as `[ref, text]`. Use whichever is cleaner; the test pins the expected output.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli/parse-interactive.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts tests/cli/parse-interactive.test.ts
git commit -m "feat(cli): parse interactive verbs (navigate/snapshot/click/type)"
```

---

## Task 3: Dispatch the four verbs in `main()` — manual verification

**Files:**
- Modify: `src/cli.ts`

No new unit test (dispatch wiring; covered by parse tests + the gated e2e). Verify by build + a manual live slice.

- [ ] **Step 1: Add dispatch blocks in `main()`**

In `src/cli.ts` `main()`, before the `recall` block, add:

```typescript
  if (args.cmd === 'navigate') {
    const { PlaywrightAdapter } = await import('./playwright/adapter.js');
    const { RecordStore } = await import('./mapstore/record.js');
    const adapter = new PlaywrightAdapter(args.session);
    try {
      await adapter.goto(args.url);
      const toSnapshot = await adapter.snapshot();
      const toUrl = await adapter.currentUrl();
      const rec = new RecordStore('webnav.db');
      let recorded = false;
      if (rec.isActive(args.session)) {
        const { diffSnapshots } = await import('./explorer/diff.js');
        const { parseSnapshot } = await import('./playwright/snapshot.js');
        rec.appendActionEffect(args.session, {
          fromUrl: args.url, fromSnapshot: '', action: null,
          toUrl, toSnapshot, navigated: true,
          diff: diffSnapshots([], parseSnapshot(toSnapshot)),
        });
        recorded = true;
      }
      console.log(JSON.stringify({ status: 'done', url: toUrl, recorded }, null, 2));
    } catch (e) {
      console.log(JSON.stringify({ status: 'failed', reason: String(e) }, null, 2));
      process.exitCode = 2;
    }
    return;
  }
  if (args.cmd === 'snapshot') {
    const { PlaywrightAdapter } = await import('./playwright/adapter.js');
    const adapter = new PlaywrightAdapter(args.session);
    try {
      console.log(await adapter.snapshot());
    } catch (e) {
      console.log(JSON.stringify({ status: 'failed', reason: 'no live page for session ' + args.session + ' — run `use navigate` first' }, null, 2));
      process.exitCode = 2;
    }
    return;
  }
  if (args.cmd === 'click' || args.cmd === 'type') {
    const { PlaywrightAdapter } = await import('./playwright/adapter.js');
    const { RecordStore } = await import('./mapstore/record.js');
    const { runActionRecorded } = await import('./router/browse.js');
    const adapter = new PlaywrightAdapter(args.session);
    try {
      const fromSnapshot = await adapter.snapshot();
      const fromUrl = await adapter.currentUrl();
      const r = await runActionRecorded({
        sessionId: args.session, recordStore: new RecordStore('webnav.db'),
        fromUrl, fromSnapshot,
        action: { role: '', name: null, ref: args.ref },
        text: args.cmd === 'type' ? args.text : undefined,
        adapter: adapter as any,
      });
      console.log(JSON.stringify(r, null, 2));
      if (r.status === 'failed') process.exitCode = 2;
    } catch (e) {
      console.log(JSON.stringify({ status: 'failed', reason: String(e) }, null, 2));
      process.exitCode = 2;
    }
    return;
  }
```

(Note: none of these call `adapter.close()` — the `-s=<session>` browser must persist for the next verb. `snapshot`'s catch handles "no live page yet".)

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: tsc OK (web build runs too — fine).

- [ ] **Step 3: Manual live slice (saucedemo login → inventory)**

Run from the worktree root (shares `webnav.db`):

```bash
node dist/cli.js dev record-start --session liveT
node dist/cli.js use navigate https://www.saucedemo.com --session liveT
node dist/cli.js use snapshot --session liveT | grep -iE "textbox|button" | head
# read the refs from the snapshot above, then (substitute the real refs):
# node dist/cli.js use type <user-ref> standard_user --session liveT
# node dist/cli.js use type <pass-ref> secret_sauce --session liveT
# node dist/cli.js use click <login-ref> --session liveT
node dist/cli.js dev record-stop --session liveT
node dist/cli.js dev graph-analyse --session liveT
```

Expected: `navigate` prints `{status:done, recorded:true}`; `snapshot` prints the login page YAML (Username/Password/Login visible); after the type/click steps, `graph-analyse` shows a `www.saucedemo.com` site with observations including the login navigation. Clean up the test session rows after (or use a temp DB). If a verb errors, fix the dispatch before proceeding.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): dispatch interactive verbs (navigate/snapshot/click/type) over the recording engine"
```

---

## Task 4: cli-spec entries + per-verb help — TDD

**Files:**
- Modify: `src/cli-spec.ts`
- Test: `tests/cli-spec.test.ts` (registry-count), `tests/cli/help-categories.test.ts` (if it asserts verb presence)

- [ ] **Step 1: Add four `CONSUMER_COMMANDS` entries**

In `src/cli-spec.ts`, append to `CONSUMER_COMMANDS` (group `'navigate'`):

```typescript
  {
    name: 'navigate', group: 'navigate',
    summary: 'Open a URL in a session browser; records a landing observation if the session is recording.',
    args: [{ name: 'url', required: true, description: 'URL to open.' }],
    flags: [{ name: '--session', takesValue: true, description: 'Session id (browser + record buffer; from `dev record-start`).' }],
    example: 'webnav use navigate https://www.saucedemo.com --session sd1',
  },
  {
    name: 'snapshot', group: 'navigate',
    summary: 'Return the current page\'s accessibility snapshot (read refs to act on). Never records.',
    args: [],
    flags: [{ name: '--session', takesValue: true, description: 'Session id whose live browser to snapshot.' }],
    example: 'webnav use snapshot --session sd1',
  },
  {
    name: 'click', group: 'navigate',
    summary: 'Click an element by ref (from `use snapshot`); records the before/after action-effect if recording.',
    args: [{ name: 'ref', required: true, description: 'Element ref from a prior `use snapshot`.' }],
    flags: [{ name: '--session', takesValue: true, description: 'Session id (browser + record buffer).' }],
    example: 'webnav use click e42 --session sd1',
  },
  {
    name: 'type', group: 'navigate',
    summary: 'Type text into a field by ref (from `use snapshot`); records the action-effect if recording.',
    args: [
      { name: 'ref', required: true, description: 'Field ref from a prior `use snapshot`.' },
      { name: 'text', required: true, description: 'Text to type into the field.' },
    ],
    flags: [{ name: '--session', takesValue: true, description: 'Session id (browser + record buffer).' }],
    example: 'webnav use type e1 standard_user --session sd1',
  },
```

- [ ] **Step 2: Update the registry-count test**

In `tests/cli-spec.test.ts`, add `'click'`, `'navigate'`, `'snapshot'`, `'type'` to the expected sorted name array (re-sort alphabetically). Run `npx vitest run tests/cli-spec.test.ts` first to see the current exact array, then insert the four names in order.

- [ ] **Step 3: Run the cli tests**

Run: `npx vitest run tests/cli tests/cli-spec.test.ts`
Expected: PASS (registry-count updated; help renders the new verbs since it's registry-driven).

- [ ] **Step 4: Commit**

```bash
git add src/cli-spec.ts tests/cli-spec.test.ts
git commit -m "feat(cli): cli-spec entries + help for interactive verbs"
```

---

## Task 5: Gated live e2e — interactive CLI on real saucedemo

**Files:**
- Create: `tests/e2e/interactive-cli.live.test.ts`

Drive a short real saucedemo slice through the CLI verbs; assert login = navigated:true, add-to-cart = navigated:false + Remove diff. Gated by `WEBNAV_LIVE=1`. Uses a temp DB so it doesn't pollute the repo `webnav.db`.

- [ ] **Step 1: Write the gated test**

Create `tests/e2e/interactive-cli.live.test.ts`:

```typescript
import { describe, it, expect, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const exec = promisify(execFile);
const live = process.env.WEBNAV_LIVE === '1';

const DB = mkdtempSync(join(tmpdir(), 'webnav-itest-'));
async function cli(args: string[]) {
  const { stdout } = await exec('npx', ['tsx', 'src/cli.ts', ...args],
    { maxBuffer: 10 * 1024 * 1024, env: { ...process.env, WEBNAV_DB: join(DB, 'webnav.db') } });
  return stdout;
}
function json(s: string) { return JSON.parse(s); }
function refOf(snapshot: string, re: RegExp): string | null {
  for (const line of snapshot.split('\n')) if (re.test(line)) { const m = line.match(/\[ref=(e\d+)\]/); if (m) return m[1]; }
  return null;
}
afterAll(() => rmSync(DB, { recursive: true, force: true }));

describe.skipIf(!live)('live: interactive CLI on saucedemo', () => {
  it('drives login + add-to-cart and records the effects', async () => {
    await cli(['dev', 'record-start', '--session', 'it1']);
    json(await cli(['navigate', 'https://www.saucedemo.com', '--session', 'it1']));
    const login = await cli(['snapshot', '--session', 'it1']);
    const userRef = refOf(login, /textbox "Username"/)!;
    const passRef = refOf(login, /textbox "Password"/)!;
    const loginRef = refOf(login, /button "Login"/)!;
    expect(userRef && passRef && loginRef).toBeTruthy();
    await cli(['type', userRef, 'standard_user', '--session', 'it1']);
    await cli(['type', passRef, 'secret_sauce', '--session', 'it1']);
    const r = json(await cli(['click', loginRef, '--session', 'it1']));
    expect(r.navigated).toBe(true);                              // login navigates to inventory
    const inv = await cli(['snapshot', '--session', 'it1']);
    const addRef = refOf(inv, /button "Add to cart"/)!;
    expect(addRef).toBeTruthy();
    const add = json(await cli(['click', addRef, '--session', 'it1']));
    expect(add.navigated).toBe(false);                           // add-to-cart is in-page
    await cli(['dev', 'record-stop', '--session', 'it1']);
    const analysis = json(await cli(['dev', 'graph-analyse', '--session', 'it1']));
    expect(analysis.sites.some((s: any) => s.node === 'www.saucedemo.com')).toBe(true);
  }, 180_000);
});
```

NOTE: this requires the CLI to honor a `WEBNAV_DB` env var for the DB path. Today the interactive verbs hardcode `'webnav.db'`. In Task 3, change `new RecordStore('webnav.db')` and `new PlaywrightAdapter(args.session)` DB usage to read `process.env.WEBNAV_DB ?? 'webnav.db'` (the adapter doesn't use the DB; only RecordStore does — so make RecordStore use the env var in these blocks). If you prefer not to thread the env var, instead have the test run from a temp cwd and not set WEBNAV_DB — but the env-var approach is cleaner. Implement the `WEBNAV_DB` read in the interactive dispatch blocks (and `record-start`/`record-stop`/`graph-analyse` already may use it — check `dev.ts` uses `WEBNAV_DB`; mirror that).

- [ ] **Step 2: Confirm skipped, then run live**

Run: `npx vitest run tests/e2e/interactive-cli.live.test.ts` — Expected: skipped.
Run: `WEBNAV_LIVE=1 npx vitest run tests/e2e/interactive-cli.live.test.ts` — Expected: PASS. The KEY assertions: login `navigated:true`, add-to-cart `navigated:false`, saucedemo in the analysis. Do not weaken them; fix the dispatch/env wiring if they fail.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/interactive-cli.live.test.ts src/cli.ts
git commit -m "test(e2e): gated live interactive CLI (saucedemo login + add-to-cart recorded)"
```

---

## Task 6: STATUS.md + full suite green

**Files:**
- Modify: `docs/STATUS.md`

- [ ] **Step 1: Add the feature note + verb-table rows**

In `docs/STATUS.md`, add `use navigate/snapshot/click/type` to the verb table and a section:

```markdown
### Interactive recording verbs (DONE, 2026-06-08)

Four `use` verbs let an agent drive a live page across CLI calls and record
action-effects: `navigate <url>` (open + landing observation), `snapshot` (read
the page + refs; never records), `click <ref>` / `type <ref> <text>` (perform +
record before/after via `runActionRecorded`). One `--session` id = the persistent
`-s=` browser + the record buffer; recording is conditional on an active session.
`runActionRecorded` now supports type (fill) as well as click. This completes the
agent's hands: record-start → navigate/snapshot/click/type → record-stop →
graph-analyse → graph-edit. Verified live on saucedemo (login navigates;
add-to-cart is in-page). Spec/plan:
`docs/superpowers/specs/2026-06-08-interactive-recording-verbs-design.md`,
`docs/superpowers/plans/2026-06-08-interactive-recording-verbs.md`.
```

Bump the test-count line.

- [ ] **Step 2: Build + full suite**

Run: `npm run build` — Expected: OK.
Run: `npx vitest run` — Expected: all pass, gated e2e skipped. (ABI error → rebuild better-sqlite3.)

- [ ] **Step 3: Commit**

```bash
git add docs/STATUS.md
git commit -m "docs: interactive recording verbs done"
```

---

## Self-review notes (for the implementer)

- **No close between verbs.** The interactive dispatch blocks must NOT call `adapter.close()` — the `-s=<session>` browser persists for the next CLI call. Closing it breaks the whole multi-call flow.
- **`type` positional parsing** is the one fiddly bit: the `--session` value is a non-`--` token, so don't naively treat all non-flag tokens as `[ref, text]`. The plan's filter excludes the session value; verify with the parse test.
- **`runActionRecorded` back-compat:** `text` is optional; absent → clicks (existing behavior). Existing `browse-action.test.ts` must stay green.
- **`WEBNAV_DB` env var:** the gated e2e isolates its DB via `WEBNAV_DB`. Make the interactive dispatch blocks read `process.env.WEBNAV_DB ?? 'webnav.db'` for `RecordStore` (mirror `src/dev.ts`, which already uses `WEBNAV_DB`). This also avoids polluting the repo `webnav.db` during the manual check.
- **The saucedemo full-map run** (the user's real goal) is the acceptance demo AFTER this lands — a Haiku subagent drives the whole site via these verbs; the controller verifies the graph by hand. Not a committed test.
- **Native module:** ABI mass-fail → `cd node_modules/better-sqlite3 && npx node-gyp rebuild && cd ../..`.
```
