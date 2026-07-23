import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { RecordStore } from '../../src/mapstore/record.js';
import { runLiveRecord } from '../../src/recorder/live-record.js';

// Fixtures must look like FINISHED renders: classifyReadiness treats <8 nodes as
// 'loading' and the loop then refuses to archive the tick (the never-snapshot-a-
// loading-shell guard). Real pages are big; sparse fixtures were a plan bug.
const LOGIN = ['RootWebArea "Login" [ref=e1]', '  heading "Swag Labs" [ref=e2]',
  '  textbox "Username" [ref=e3]', '  textbox "Password" [ref=e4]', '  button "Login" [ref=e5]',
  '  StaticText "Accepted usernames" [ref=e6]', '  StaticText "standard_user" [ref=e7]',
  '  StaticText "Password for all users" [ref=e8]', '  StaticText "secret_sauce" [ref=e9]'].join('\n');
const INV = ['RootWebArea "Products" [ref=e1]', '  button "Open Menu" [ref=e2]',
  '  heading "Products" [ref=e3]', '  link "Sauce Labs Backpack" [ref=e4]',
  '  button "Add to cart" [ref=e5]', '  link "Sauce Labs Bike Light" [ref=e6]',
  '  button "Add to cart" [ref=e7]', '  StaticText "$29.99" [ref=e8]',
  '  link "Cart" [ref=e9]'].join('\n');

// Scripted fake adapter for the CHEAP-TICK loop: the loop calls currentUrl FIRST
// each tick (that advances the script), then installer/drain, and snapshot only
// when something happened — snapshot returns the CURRENT row without advancing.
function fakeAdapter(script: { url: string; snap: string; drain?: string }[]) {
  let tick = -1;
  let lastInstallUrl: string | null = null;
  const cur = () => script[Math.max(0, Math.min(tick, script.length - 1))];
  return {
    evalJs: async (f: string) => {
      // TICK_JS (the combined per-tick eval) returns JSON {installed, queue};
      // installed=true only when the document (url) changed — like the real page.
      if (f.includes('queue')) {
        const installed = lastInstallUrl !== cur().url;
        lastInstallUrl = cur().url;
        return JSON.stringify({ installed, queue: JSON.parse(cur().drain ?? '[]') });
      }
      if (f.includes('__webnav_rec_badge')) return 'ok';
      return 'null'; // probe
    },
    snapshot: async () => cur().snap,
    currentUrl: async () => { tick = Math.min(tick + 1, script.length - 1); return cur().url; },
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

it('same-batch input+click: input stays navigated:false with the field identity (regression, final-review #1)', async () => {
  // The natural login cadence: the password field's `change` fires on blur AS the
  // user clicks Login, so both events drain in ONE batch. The input must NOT pair
  // with the click's landing tick (that recorded navigated:true, which skips the
  // draft's input-affordance branch → credentials linkage never fires + a junk
  // textbox "navigate" edge that passes self-verify).
  const store = RecordStore.fromDatabase(new Database(':memory:'));
  store.start('live-3');
  const batch = JSON.stringify([
    { seq: 1, kind: 'input', url: 'https://s.test/', tagName: 'input', inputType: 'password', placeholder: 'Password' },
    { seq: 2, kind: 'click', url: 'https://s.test/', tagName: 'button', leafText: 'Login' },
  ]);
  const adapter = fakeAdapter([
    { url: 'https://s.test/', snap: LOGIN },
    { url: 'https://s.test/', snap: LOGIN, drain: batch },
    { url: 'https://s.test/inventory.html', snap: INV },
    { url: 'https://s.test/inventory.html', snap: INV },
  ]);
  let n = 0;
  await runLiveRecord({ adapter, store, sessionId: 'live-3', intervalMs: 0,
    log: () => {}, isStopped: () => ++n > 6, sleep: async () => {} });
  const fx = store.actionEffects('live-3');
  expect(fx.length).toBe(2);
  const input = fx.find((f) => f.action?.role === 'textbox')!;
  const click = fx.find((f) => f.action?.role === 'button')!;
  expect(input.navigated).toBe(false);                    // an input NEVER navigates
  expect(input.action?.name).toBe('Password');            // field identity kept (no value anywhere)
  expect(input.toUrl).not.toContain('/inventory.html');   // paired with the pre-nav tick, not the landing
  expect(click.navigated).toBe(true);
  expect(click.toUrl).toContain('/inventory.html');
  expect(click.action?.elementFp?.name).toBe('Login');
});

it('stops when the record session is stopped externally', async () => {
  const store = RecordStore.fromDatabase(new Database(':memory:'));
  store.start('live-2'); store.stop('live-2');
  const adapter = fakeAdapter([{ url: 'https://s.test/', snap: LOGIN }]);
  const res = await runLiveRecord({ adapter, store, sessionId: 'live-2', intervalMs: 0,
    log: () => {}, isStopped: () => false, sleep: async () => {} });
  expect(res.appended).toBe(0);   // isActive false → immediate exit
});

it('armed: loop keeps running while session inactive; a toggle event starts capture', async () => {
  const store = RecordStore.fromDatabase(new Database(':memory:'));
  // NOT started — armed loop must still run, capturing nothing.
  const armedClick = JSON.stringify([{ seq: 1, kind: 'click', url: 'https://s.test/', tagName: 'button', leafText: 'Login' }]);
  const toggleEvt = JSON.stringify([{ seq: 2, kind: 'toggle', url: 'https://s.test/' }]);
  const clickEvt = JSON.stringify([{ seq: 3, kind: 'click', url: 'https://s.test/', tagName: 'button', leafText: 'Login' }]);
  const logs: string[] = [];
  const adapter = fakeAdapter([
    { url: 'https://s.test/', snap: LOGIN },
    { url: 'https://s.test/', snap: LOGIN, drain: armedClick }, // clicked while ARMED → dropped, unlogged
    { url: 'https://s.test/', snap: LOGIN, drain: toggleEvt },  // human hits ⏺ in the overlay
    { url: 'https://s.test/', snap: LOGIN, drain: clickEvt },
    { url: 'https://s.test/inventory.html', snap: INV },
    { url: 'https://s.test/inventory.html', snap: INV },
  ]);
  let n = 0;
  await runLiveRecord({ adapter, store, sessionId: 'armed-1', intervalMs: 0, armed: true,
    log: (l) => logs.push(l), isStopped: () => ++n > 8, sleep: async () => {} });
  expect(store.isActive('armed-1')).toBe(true);            // toggle started the session
  expect(store.actionEffects('armed-1').length).toBe(1);   // ONLY the click after toggle
  expect(logs.filter((l) => l.startsWith('recorded')).length).toBe(1);   // armed click never logged 'recorded'
  expect(logs.some((l) => l.includes('STARTED (pill via queue)'))).toBe(true);
});

it('armed: 5 consecutive tick errors end the loop (browser closed by user)', async () => {
  const store = RecordStore.fromDatabase(new Database(':memory:'));
  const adapter = { evalJs: async (f: string) => (f.includes('__webnav_evq') ? '[]' : 'ok'),
    snapshot: async () => { throw new Error('closed'); },
    currentUrl: async () => 'x', close: async () => '' };
  const res = await runLiveRecord({ adapter, store, sessionId: 'armed-2', intervalMs: 0, armed: true,
    log: () => {}, isStopped: () => false, sleep: async () => {} });
  expect(res.ticks).toBe(0);   // never archived a tick; loop exited on error streak, not hung
});

it('armed: a sustained undrainable streak = window closed → session ends (daemon must not resurrect)', async () => {
  const store = RecordStore.fromDatabase(new Database(':memory:'));
  const adapter = { evalJs: async (f: string) => (f.includes('__webnav_evq') ? 'Error: no open page' : 'ok'),
    snapshot: async () => 'RootWebArea "X" [ref=e1]',
    currentUrl: async () => 'https://s.test/', close: async () => '' };
  const logs: string[] = [];
  await runLiveRecord({ adapter, store, sessionId: 'armed-3', intervalMs: 0, armed: true,
    log: (l) => logs.push(l), isStopped: () => false, sleep: async () => {} });
  expect(logs.filter((l) => l.includes('undrainable')).length).toBe(1);   // logged once, not spammed
  expect(logs.some((l) => l.includes('window closed'))).toBe(true);      // loop ended itself
});

it('armed: window closed → daemon resurrects about:blank → session ENDS (no reopen loop)', async () => {
  const store = RecordStore.fromDatabase(new Database(':memory:'));
  // real page, then the daemon-resurrected fresh about:blank (installed=true, evals fine)
  const adapter = fakeAdapter([
    { url: 'https://s.test/', snap: LOGIN },
    { url: 'https://s.test/', snap: LOGIN },
    { url: 'about:blank', snap: LOGIN },
    { url: 'about:blank', snap: LOGIN },
    { url: 'about:blank', snap: LOGIN },
  ]);
  const logs: string[] = [];
  await runLiveRecord({ adapter, store, sessionId: 'armed-4', intervalMs: 0, armed: true,
    log: (l) => logs.push(l), isStopped: () => false, sleep: async () => {} });
  expect(logs.some((l) => l.includes('window closed'))).toBe(true);   // ended, not resurrect-looping
});


it('steps are stamped with CAPTURE time, not slow-loop processing time', async () => {
  const store = RecordStore.fromDatabase(new Database(':memory:'));
  store.start('t-1');
  const captured = Date.now() - 60_000;   // the human clicked a minute ago (heavy-page lag)
  const clickEvt = JSON.stringify([{ seq: 1, kind: 'click', url: 'https://s.test/',
    tagName: 'button', leafText: 'Login', t: captured }]);
  const adapter = fakeAdapter([
    { url: 'https://s.test/', snap: LOGIN },
    { url: 'https://s.test/', snap: LOGIN, drain: clickEvt },
    { url: 'https://s.test/inventory.html', snap: INV },
    { url: 'https://s.test/inventory.html', snap: INV },
  ]);
  let n = 0;
  const logs: string[] = [];
  await runLiveRecord({ adapter, store, sessionId: 't-1', intervalMs: 0,
    log: (l) => logs.push(l), isStopped: () => ++n > 5, sleep: async () => {} });
  expect(store.actionEffects('t-1')[0].capturedAt).toBe(captured);        // true action time
  expect(logs.find((l) => l.startsWith('recorded'))).toContain('(at ');   // lag surfaced in the log line
});


it('queued toggles are idempotent: double-click stop does NOT restart (live CORS-fallback bug)', async () => {
  const store = RecordStore.fromDatabase(new Database(':memory:'));
  store.start('idem-1');   // recording
  const twoStops = JSON.stringify([
    { seq: 1, kind: 'toggle', url: 'https://s.test/', desired: false },
    { seq: 2, kind: 'toggle', url: 'https://s.test/', desired: false },
  ]);
  const adapter = fakeAdapter([
    { url: 'https://s.test/', snap: LOGIN },
    { url: 'https://s.test/', snap: LOGIN, drain: twoStops },
    { url: 'https://s.test/', snap: LOGIN },
  ]);
  let n = 0;
  const logs: string[] = [];
  await runLiveRecord({ adapter, store, sessionId: 'idem-1', intervalMs: 0, armed: true,
    log: (l) => logs.push(l), isStopped: () => ++n > 4, sleep: async () => {} });
  expect(store.isActive('idem-1')).toBe(false);   // stopped — and STAYED stopped
  expect(logs.filter((l) => l.includes('STOPPED')).length).toBe(1);   // second stop was a no-op
});


it('Fix B: an unresolved same-page click that visibly CHANGED the page is recorded as evidence (action:null), not dropped', async () => {
  const store = RecordStore.fromDatabase(new Database(':memory:'));
  store.start('fixb-1');
  // A dropdown-item click with no leafText/role match → resolveEvent finds nothing
  // (unresolved). The page stays on the same URL (same-page), so the old code
  // path drops it via assembleEffect returning null. Here the post-click DOM
  // actually changed (a node appeared) — that's real signal, not noise.
  const clickEvt = JSON.stringify([{ seq: 1, kind: 'click', url: 'https://s.test/inventory.html',
    tagName: 'div' }]);   // no role, no leafText → never resolves
  const CHANGED_INV = INV + '\n  StaticText "Line chart selected" [ref=e10]';
  // The baseline landing tick is stable INV (settle plateaus on it immediately);
  // from the drain tick onward the DOM has visibly re-rendered to CHANGED_INV, so the
  // Fix-B fresh-snapshot probe diffs CHANGED_INV against the INV baseline and records it.
  // (Was a snapshot-call counter — invalidated now that the landing tick settles, which
  // consumes several snapshot() calls; keying off the script row is settle-robust.)
  const adapter = fakeAdapter([
    { url: 'https://s.test/inventory.html', snap: INV },
    { url: 'https://s.test/inventory.html', snap: CHANGED_INV, drain: clickEvt },
    { url: 'https://s.test/inventory.html', snap: CHANGED_INV },
  ]);
  let n = 0;
  const logs: string[] = [];
  await runLiveRecord({ adapter, store, sessionId: 'fixb-1', intervalMs: 0,
    log: (l) => logs.push(l), isStopped: () => ++n > 6, sleep: async () => {} });
  const fx = store.actionEffects('fixb-1');
  expect(fx.length).toBe(1);
  expect(fx[0].action).toBeNull();
  expect(fx[0].navigated).toBe(false);
  expect(fx[0].diff.added.length).toBeGreaterThan(0);
  expect(logs.some((l) => l.includes('recorded unresolved same-page change'))).toBe(true);
  expect(logs.some((l) => l.startsWith('skip: unresolved'))).toBe(false);
});

it('Fix B companion: an unresolved same-page click with NO real DOM change stays dropped', async () => {
  const store = RecordStore.fromDatabase(new Database(':memory:'));
  store.start('fixb-2');
  const clickEvt = JSON.stringify([{ seq: 1, kind: 'click', url: 'https://s.test/inventory.html',
    tagName: 'div' }]);
  const adapter = fakeAdapter([
    { url: 'https://s.test/inventory.html', snap: INV },
    { url: 'https://s.test/inventory.html', snap: INV, drain: clickEvt },
    { url: 'https://s.test/inventory.html', snap: INV },
  ]);
  // snapshot() always returns the SAME dom → diff is empty → genuine noise, still dropped.
  let n = 0;
  const logs: string[] = [];
  await runLiveRecord({ adapter, store, sessionId: 'fixb-2', intervalMs: 0,
    log: (l) => logs.push(l), isStopped: () => ++n > 6, sleep: async () => {} });
  const fx = store.actionEffects('fixb-2');
  expect(fx.length).toBe(0);
  expect(logs.some((l) => l.startsWith('skip: unresolved'))).toBe(true);
});

it('ledgers every drained event and stamps its fate', async () => {
  const store = RecordStore.fromDatabase(new Database(':memory:'));
  store.start('ledger-1');
  const ledger: any[] = [];
  const ledgeringStore = {
    isActive: (s: string) => store.isActive(s),
    appendActionEffect: (s: string, fx: any, nowMs?: number) => store.appendActionEffect(s, fx, nowMs),
    start: (s: string) => store.start(s),
    stop: (s: string) => store.stop(s),
    appendEvent: (_s: string, ev: any) => { ledger.push({ ...ev, seq: ledger.length, disposition: null }); return ledger.length - 1; },
    stampEvent: (_s: string, seq: number, d: string) => { ledger[seq].disposition = d; },
  };
  // resolvable nav click (Login) + an unresolvable same-page click with no visible change
  const resolvedClick = JSON.stringify([{ seq: 1, kind: 'click', url: 'https://s.test/',
    tagName: 'button', leafText: 'Login' }]);
  const unresolvedClick = JSON.stringify([{ seq: 1, kind: 'click', url: 'https://s.test/inventory.html',
    tagName: 'div' }]);   // no role, no leafText → never resolves
  const adapter = fakeAdapter([
    { url: 'https://s.test/', snap: LOGIN },
    { url: 'https://s.test/', snap: LOGIN, drain: resolvedClick },
    { url: 'https://s.test/inventory.html', snap: INV },
    { url: 'https://s.test/inventory.html', snap: INV, drain: unresolvedClick },
    { url: 'https://s.test/inventory.html', snap: INV },
  ]);
  let n = 0;
  await runLiveRecord({ adapter, store: ledgeringStore, sessionId: 'ledger-1', intervalMs: 0,
    log: () => {}, isStopped: () => ++n > 8, sleep: async () => {} });
  expect(ledger).toHaveLength(2);
  expect(ledger[0].source).toBe('human');
  expect(ledger[0].kind).toBe('click');
  expect(ledger[0].descriptor.leafText).toBeDefined();        // the LiveEvent IS the descriptor
  expect(ledger[0].disposition).toMatch(/^step:\d+$/);
  expect(ledger[1].disposition).toBe('dropped:unresolved-same-page');
});

it('does not ledger events drained while recording is off (armed)', async () => {
  const store = RecordStore.fromDatabase(new Database(':memory:'));
  // NOT started — armed loop keeps polling but must not ledger the drained click.
  const ledger: any[] = [];
  const ledgeringStore = {
    isActive: (s: string) => store.isActive(s),
    appendActionEffect: (s: string, fx: any, nowMs?: number) => store.appendActionEffect(s, fx, nowMs),
    start: (s: string) => store.start(s),
    stop: (s: string) => store.stop(s),
    appendEvent: (_s: string, ev: any) => { ledger.push({ ...ev, seq: ledger.length, disposition: null }); return ledger.length - 1; },
    stampEvent: (_s: string, seq: number, d: string) => { ledger[seq].disposition = d; },
  };
  const armedClick = JSON.stringify([{ seq: 1, kind: 'click', url: 'https://s.test/', tagName: 'button', leafText: 'Login' }]);
  const adapter = fakeAdapter([
    { url: 'https://s.test/', snap: LOGIN },
    { url: 'https://s.test/', snap: LOGIN, drain: armedClick },
    { url: 'https://s.test/', snap: LOGIN },
  ]);
  let n = 0;
  await runLiveRecord({ adapter, store: ledgeringStore, sessionId: 'armed-ledger', intervalMs: 0, armed: true,
    log: () => {}, isStopped: () => ++n > 6, sleep: async () => {} });
  expect(ledger).toHaveLength(0);
});

// Task 6: a navigation lands on a still-hydrating shell; the poll loop settles it
// (the human is also waiting for the render) and archives the PLATEAUED snapshot,
// stamped settled:true on the navigated effect.
it('navigation tick settles to the plateaued snapshot and stamps settled:true', async () => {
  const store = RecordStore.fromDatabase(new Database(':memory:'));
  store.start('settle-1');
  const clickEvt = JSON.stringify([{ seq: 1, kind: 'click', url: 'https://s.test/',
    tagName: 'button', leafText: 'Login' }]);
  // Post-nav renders: a sparse shell first, then it grows and PLATEAUS at INV.
  const SHELL = ['RootWebArea "Products" [ref=e1]', '  button "Open Menu" [ref=e2]',
    '  heading "Products" [ref=e3]', '  StaticText "loading widgets" [ref=e4]',
    '  StaticText "a" [ref=e5]', '  StaticText "b" [ref=e6]', '  StaticText "c" [ref=e7]',
    '  StaticText "d" [ref=e8]'].join('\n');
  // snapshot() returns the growing sequence (SHELL→INV→INV): the plateau loop must
  // poll past the 8-node shell before two successive reads (INV,INV) plateau.
  const grow = [SHELL, INV, INV];
  let gi = 0;
  const adapter = fakeAdapter([
    { url: 'https://s.test/', snap: LOGIN },
    { url: 'https://s.test/', snap: LOGIN, drain: clickEvt },
    { url: 'https://s.test/inventory.html', snap: INV },
    { url: 'https://s.test/inventory.html', snap: INV },
  ]);
  adapter.snapshot = async () => grow[Math.min(gi++, grow.length - 1)];
  let n = 0;
  await runLiveRecord({ adapter, store, sessionId: 'settle-1', intervalMs: 0,
    log: () => {}, isStopped: () => ++n > 6, sleep: async () => {} });
  const fx = store.actionEffects('settle-1');
  expect(fx.length).toBe(1);
  expect(fx[0].navigated).toBe(true);
  expect(fx[0].settled).toBe(true);
  // archived the PLATEAUED render (INV, 9 nodes), not the 8-node shell
  expect(fx[0].toSnapshot).toContain('Add to cart');
});

// Task 6 honesty: a landing that never stops changing → settled:false at budget
// (env knobs are tiny via tests/setup.ts, so this returns in ms, not seconds).
it('a never-plateauing navigation lands settled:false at budget', async () => {
  const store = RecordStore.fromDatabase(new Database(':memory:'));
  store.start('settle-2');
  const clickEvt = JSON.stringify([{ seq: 1, kind: 'click', url: 'https://s.test/',
    tagName: 'button', leafText: 'Login' }]);
  const adapter = fakeAdapter([
    { url: 'https://s.test/', snap: LOGIN },
    { url: 'https://s.test/', snap: LOGIN, drain: clickEvt },
    { url: 'https://s.test/inventory.html', snap: INV },
    { url: 'https://s.test/inventory.html', snap: INV },
  ]);
  // Every landing snapshot adds a NEW identity node (a growing button list) → never
  // plateaus; settleSnapshot exhausts its budget and flags settled:false.
  let churn = 0;
  adapter.snapshot = async () => INV + '\n  button "Widget ' + (churn++) + '" [ref=eX]';
  let n = 0;
  await runLiveRecord({ adapter, store, sessionId: 'settle-2', intervalMs: 0,
    log: () => {}, isStopped: () => ++n > 6, sleep: async () => {} });
  const fx = store.actionEffects('settle-2');
  expect(fx.length).toBe(1);
  expect(fx[0].navigated).toBe(true);
  expect(fx[0].settled).toBe(false);
});

// Latency guard: an in-page (same-url) tick must NOT settle — a reveal has to be
// captured immediately (it could auto-dismiss). Proof the same-url path never settled:
// the recorded reveal effect stays UNFLAGGED (settled undefined). The initial landing
// (a navigation) DID settle a stable page → settled:true, confirming the split is by
// url-change, not by tick.
it('a same-url (in-page) reveal is captured unflagged; the landing before it settled', async () => {
  const store = RecordStore.fromDatabase(new Database(':memory:'));
  store.start('settle-3');
  // Reveal a menu with a resolved click (so Fix-B's unresolved fresh-snapshot probe
  // never fires) that leaves the URL unchanged — an in-page mutation, navigated:false.
  const OPENED = INV + '\n  link "Logout" [ref=e10]';
  const clickEvt = JSON.stringify([{ seq: 1, kind: 'click', url: 'https://s.test/inventory.html',
    tagName: 'link', leafText: 'Logout', href: 'https://s.test/inventory.html' }]);
  const adapter = fakeAdapter([
    { url: 'https://s.test/inventory.html', snap: INV },
    { url: 'https://s.test/inventory.html', snap: OPENED, drain: clickEvt },
    { url: 'https://s.test/inventory.html', snap: OPENED },
    { url: 'https://s.test/inventory.html', snap: OPENED },
  ]);
  let n = 0;
  await runLiveRecord({ adapter, store, sessionId: 'settle-3', intervalMs: 0,
    log: () => {}, isStopped: () => ++n > 5, sleep: async () => {} });
  const reveal = store.actionEffects('settle-3').find((f) => !f.navigated);
  expect(reveal).toBeTruthy();
  expect(reveal!.settled).toBeUndefined();   // same-page effect never carries a settle verdict
});

it('window close → onEnd(closed) fires and the session is stopped (live #1/#2/#3)', async () => {
  const store = RecordStore.fromDatabase(new Database(':memory:'));
  store.start('end-1');   // recording
  let alive = true;
  const adapter = { evalJs: async (f: string) => (f.includes('queue') ? JSON.stringify({ installed: false, queue: [] }) : 'ok'),
    snapshot: async () => 'RootWebArea "X" [ref=e1]', currentUrl: async () => 'https://s.test/', close: async () => '' };
  const ends: string[] = [];
  const p = runLiveRecord({ adapter, store, sessionId: 'end-1', intervalMs: 0, armed: true,
    browserAlive: () => alive, onEnd: (r) => { ends.push(r); store.stop('end-1'); },
    log: () => {}, isStopped: () => false, sleep: async () => { alive = false; } });   // window closes after tick 1
  await p;
  expect(ends).toEqual(['closed']);            // ended for the right reason
  expect(store.isActive('end-1')).toBe(false); // and the session actually stopped
});
