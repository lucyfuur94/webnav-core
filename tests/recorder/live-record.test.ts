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
