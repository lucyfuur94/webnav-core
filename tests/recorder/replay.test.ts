import { describe, it, expect } from 'vitest';
import { ReplayController, runReplay } from '../../src/recorder/replay.js';
import type { StoredActionEffect } from '../../src/mapstore/record.js';

const LOGIN = ['RootWebArea "Login" [ref=e1]', '  textbox "Username" [ref=e2]',
  '  textbox "Password" [ref=e3]', '  button "Login" [ref=e4]'].join('\n');
const INV = ['RootWebArea "Products" [ref=e1]', '  button "Finish" [ref=e2]'].join('\n');
const fx = (over: Partial<StoredActionEffect>): StoredActionEffect => ({
  seq: 0, capturedAt: 0, fromUrl: 'https://s.test/', fromSnapshot: LOGIN, action: null,
  toUrl: 'https://s.test/', toSnapshot: LOGIN, navigated: false, diff: { added: [], removed: [] }, ...over } as any);

function fakeAdapter(pages: Record<string, string>) {
  let url = '';
  return {
    open: async (u: string) => { url = u; }, goto: async (u: string) => { url = u; },
    click: async () => { if (url.endsWith('/')) url = 'https://s.test/inventory.html'; },
    fill: async () => {}, snapshot: async () => pages[url] ?? LOGIN,
    currentUrl: async () => url, screenshot: async () => null, close: async () => '',
    calls: [] as string[],
  };
}
const PAGES = { 'https://s.test/': LOGIN, 'https://s.test/inventory.html': INV };

it('replays input (stored cred) + navigated click to ok', async () => {
  const effects = [
    fx({ seq: 1, action: { role: 'textbox', name: 'Username', ref: null, elementFp: { role: 'textbox', name: 'Username', near: null } } }),
    fx({ seq: 2, action: { role: 'button', name: 'Login', ref: null, elementFp: { role: 'button', name: 'Login', near: null } },
        toUrl: 'https://s.test/inventory.html', navigated: true }),
  ];
  const ctl = new ReplayController('r1', effects.map((e) => ({ seq: e.seq, label: e.action!.name! })));
  const st = await runReplay(effects, ctl, { adapter: fakeAdapter(PAGES) as any,
    creds: { get: () => ({ username: 'u' }), set: () => {} }, site: 's.test', shotsDir: null, paceMs: 0, sleep: async () => {} });
  expect(st.steps.map((s) => s.status)).toEqual(['ok', 'ok']);
  expect(st.done).toBe(true);
});

it('missing cred pauses waiting:value; supply(save) writes to the store', async () => {
  const saved: any[] = [];
  const effects = [fx({ seq: 1, action: { role: 'textbox', name: 'Password', ref: null,
    elementFp: { role: 'textbox', name: 'Password', near: null } } })];
  const ctl = new ReplayController('r2', [{ seq: 1, label: 'Password' }]);
  const p = runReplay(effects, ctl, { adapter: fakeAdapter(PAGES) as any,
    creds: { get: () => ({}), set: (_s, kv) => saved.push(kv) }, site: 's.test', shotsDir: null, paceMs: 0, sleep: async () => {} });
  await new Promise((r) => setTimeout(r, 10));
  expect(ctl.state.waiting).toBe('value');
  ctl.supply('secret', true);
  const st = await p;
  expect(st.steps[0].status).toBe('ok');
  expect(saved).toEqual([{ password: 'secret' }]);
  expect(JSON.stringify(st)).not.toContain('secret');    // value never in state
});

it('commit-labeled step pauses waiting:confirm; fire:false skips it', async () => {
  const effects = [fx({ seq: 1, fromUrl: 'https://s.test/inventory.html', fromSnapshot: INV,
    action: { role: 'button', name: 'Finish', ref: null, elementFp: { role: 'button', name: 'Finish', near: null } },
    toUrl: 'https://s.test/done.html', navigated: true })];
  const ctl = new ReplayController('r3', [{ seq: 1, label: 'Finish' }]);
  const p = runReplay(effects, ctl, { adapter: fakeAdapter({ 'https://s.test/inventory.html': INV }) as any,
    creds: { get: () => ({}), set: () => {} }, site: 's.test', shotsDir: null, paceMs: 0, sleep: async () => {} });
  await new Promise((r) => setTimeout(r, 10));
  expect(ctl.state.waiting).toBe('confirm');
  ctl.confirm(false);
  const st = await p;
  expect(st.steps[0].status).toBe('skipped');   // never fired (#2)
});

it('unresolvable element fails + drops to step mode; abort finishes', async () => {
  const effects = [fx({ seq: 1, action: { role: 'button', name: 'Ghost', ref: null,
    elementFp: { role: 'button', name: 'Ghost', near: null } } }),
    fx({ seq: 2, action: null, toUrl: 'https://s.test/inventory.html', navigated: true })];
  const ctl = new ReplayController('r4', [{ seq: 1, label: 'Ghost' }, { seq: 2, label: 'nav' }]);
  const p = runReplay(effects, ctl, { adapter: fakeAdapter(PAGES) as any,
    creds: { get: () => ({}), set: () => {} }, site: 's.test', shotsDir: null, paceMs: 0, sleep: async () => {} });
  await new Promise((r) => setTimeout(r, 10));
  expect(ctl.state.steps[0].status).toBe('fail');
  expect(ctl.state.mode).toBe('step');
  ctl.control('abort');
  const st = await p;
  expect(st.done).toBe(true);
  expect(st.steps[1].status).toBe('skipped');
});
