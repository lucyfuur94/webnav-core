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
