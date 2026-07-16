import { describe, it, expect } from 'vitest';
import { ReplayController, runReplay, runLedgerReplay } from '../../src/recorder/replay.js';
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
    fill: async () => {}, hover: async () => {}, snapshot: async () => pages[url] ?? LOGIN,
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

it('fail then Next RETRIES the same step (human fixed the live page)', async () => {
  const P1 = 'RootWebArea "A" [ref=e1]';
  const P2 = ['RootWebArea "A" [ref=e1]', '  button "Later" [ref=e2]'].join('\n');
  let snaps = 0;
  const ad = { open: async () => {}, goto: async () => {}, click: async () => {}, fill: async () => {},
    hover: async () => {}, snapshot: async () => (snaps++ === 0 ? P1 : P2), currentUrl: async () => 'https://s.test/',
    screenshot: async () => null, close: async () => '' };
  const effects = [fx({ seq: 1, action: { role: 'button', name: 'Later', ref: null,
    elementFp: { role: 'button', name: 'Later', near: null } } })];
  const ctl = new ReplayController('r5', [{ seq: 1, label: 'Later' }]);
  const p = runReplay(effects, ctl, { adapter: ad as any, creds: { get: () => ({}), set: () => {} },
    site: 's.test', shotsDir: null, paceMs: 0, sleep: async () => {} });
  await new Promise((r) => setTimeout(r, 10));
  expect(ctl.state.steps[0].status).toBe('fail');
  expect(ctl.state.mode).toBe('step');       // paused for the human
  ctl.control('next');                        // human fixed the page → retry THIS step
  const st = await p;
  expect(st.steps[0].status).toBe('ok');      // resolved on the retry
});

it('abort during waiting:value clears the waiting flag (consistent terminal state)', async () => {
  const effects = [fx({ seq: 1, action: { role: 'textbox', name: 'Password', ref: null,
    elementFp: { role: 'textbox', name: 'Password', near: null } } })];
  const ctl = new ReplayController('r6', [{ seq: 1, label: 'Password' }]);
  const p = runReplay(effects, ctl, { adapter: fakeAdapter(PAGES) as any,
    creds: { get: () => ({}), set: () => {} }, site: 's.test', shotsDir: null, paceMs: 0, sleep: async () => {} });
  await new Promise((r) => setTimeout(r, 10));
  expect(ctl.state.waiting).toBe('value');
  ctl.control('abort');
  const st = await p;
  expect(st.waiting).toBe(null);
  expect(st.done).toBe(true);
});


it('recorded value = the flow variable: fills without pausing when no cred overrides', async () => {
  const fills: string[] = [];
  const ad = { open: async () => {}, goto: async () => {}, click: async () => {},
    fill: async (_r: string, v: string) => { fills.push(v); }, hover: async () => {},
    snapshot: async () => LOGIN, currentUrl: async () => 'https://s.test/',
    screenshot: async () => null, close: async () => '' };
  const effects = [fx({ seq: 1, action: { role: 'textbox', name: 'Username', ref: null,
    elementFp: { role: 'textbox', name: 'Username', near: null }, value: 'standard_user' } as any })];
  const ctl = new ReplayController('rv', [{ seq: 1, label: 'Username' }]);
  const st = await runReplay(effects, ctl, { adapter: ad as any,
    creds: { get: () => ({}), set: () => {} }, site: 's.test', shotsDir: null, paceMs: 0, sleep: async () => {} });
  expect(st.steps[0].status).toBe('ok');
  expect(fills).toEqual(['standard_user']);   // recorded variable replayed, no waitFor pause
});

it('resolves with error state when the browser cannot open — never rejects', async () => {
  const ctl = new ReplayController('s', [{ seq: 0, label: 'Login' }]);
  const adapter = {
    open: async () => { throw new Error('listen EINVAL bad.sock'); },
    goto: async () => {}, click: async () => {}, fill: async () => {}, hover: async () => {},
    snapshot: async () => '', currentUrl: async () => '',
    screenshot: async () => null,
    close: async () => { throw new Error('no session'); },   // close ALSO throws (never opened)
  };
  const effects = [{ seq: 0, capturedAt: 1, fromUrl: 'https://x.com/', fromSnapshot: '',
    action: { role: 'button', name: 'Login', ref: 'e1' },
    toUrl: 'https://x.com/a', toSnapshot: '', navigated: true, diff: { added: [], removed: [] } }];
  const st = await runReplay(effects as never, ctl, {
    adapter, creds: { get: () => ({}), set: () => {} }, site: 'x.com', shotsDir: null,
    sleep: async () => {},
  });
  expect(st.done).toBe(true);
  expect(st.running).toBe(false);
  expect(st.error).toContain('EINVAL');
  expect(st.steps[0].status).toBe('skipped');   // never ran — honest terminal state
});

// --- runLedgerReplay: exact rerun of the raw event stream --------------------

const hev = (seq: number, ev: Record<string, unknown>) =>   // human ledger row
  ({ seq, source: 'human' as const, kind: String(ev.kind ?? 'click'), descriptor: ev, disposition: null });
const LDEPS = { creds: { get: () => ({}), set: () => {} }, site: 's.test', shotsDir: null,
  paceMs: 0, sleep: async () => {} };
const PRODUCTS = ['RootWebArea "Home" [ref=e1]', '  link "Products" [ref=e2]'].join('\n');
const ITEMS = ['RootWebArea "List" [ref=e1]', '  link "Item" [ref=e2]'].join('\n');

describe('runLedgerReplay', () => {
  it('replays events in order and verifies landings from the NEXT event url', async () => {
    // event 0: click "Products" on /home (next event is on /list → landing must verify)
    // event 1: click "Item" on /list
    const events = [
      hev(0, { kind: 'click', url: 'https://x.com/home', tagName: 'a', leafText: 'Products', role: null }),
      hev(1, { kind: 'click', url: 'https://x.com/list', tagName: 'a', leafText: 'Item', role: null }),
    ];
    const pages: Record<string, string> = {
      'https://x.com/home': PRODUCTS, 'https://x.com/list': ITEMS, 'https://x.com/item': ITEMS };
    let url = '';
    const ad = {
      open: async (u: string) => { url = u; }, goto: async (u: string) => { url = u; },
      click: async () => { url = url === 'https://x.com/home' ? 'https://x.com/list' : 'https://x.com/item'; },
      fill: async () => {}, hover: async () => {}, snapshot: async () => pages[url] ?? '',
      currentUrl: async () => url, screenshot: async () => null, close: async () => '' };
    const ctl = new ReplayController('s', [{ seq: 0, label: 'Products' }, { seq: 1, label: 'Item' }]);
    const st = await runLedgerReplay(events as never, ctl, { adapter: ad as any, ...LDEPS });
    expect(st.steps.map((s) => s.status)).toEqual(['ok', 'ok']);
    expect(st.error).toBeUndefined();
    expect(st.done).toBe(true);
  });

  it('pauses on an unresolvable descriptor (never guesses), Next retries once then fails', async () => {
    // snapshot never contains the element → status fail, note set, mode flipped to step
    const events = [hev(0, { kind: 'click', url: 'https://x.com/home', tagName: 'a', leafText: 'Ghost', role: null })];
    const ad = {
      open: async () => {}, goto: async () => {}, click: async () => {}, fill: async () => {}, hover: async () => {},
      snapshot: async () => PRODUCTS,   // never holds "Ghost"
      currentUrl: async () => 'https://x.com/home', screenshot: async () => null, close: async () => '' };
    const ctl = new ReplayController('s', [{ seq: 0, label: 'Ghost' }]);
    const p = runLedgerReplay(events as never, ctl, { adapter: ad as any, ...LDEPS });
    await new Promise((r) => setTimeout(r, 10));
    expect(ctl.state.steps[0].status).toBe('fail');   // first miss
    expect(ctl.state.steps[0].note).toContain('Next retries once');
    expect(ctl.state.mode).toBe('step');              // paused for the human
    ctl.control('next');                              // human tried something → retry THIS step
    const st = await p;
    expect(st.steps[0].status).toBe('fail');          // still gone → final fail (no guess)
    expect(st.steps[0].note).toBe('element not found');
    expect(st.done).toBe(true);
  });

  it('landing mismatch → fail + pause ("landed elsewhere")', async () => {
    // currentUrl stays /home after the click while next event is on /list
    const events = [
      hev(0, { kind: 'click', url: 'https://x.com/home', tagName: 'a', leafText: 'Products', role: null }),
      hev(1, { kind: 'click', url: 'https://x.com/list', tagName: 'a', leafText: 'Item', role: null }),
    ];
    const ad = {
      open: async () => {}, goto: async () => {}, click: async () => {}, fill: async () => {}, hover: async () => {},
      snapshot: async () => PRODUCTS, currentUrl: async () => 'https://x.com/home',   // never moves
      screenshot: async () => null, close: async () => '' };
    const ctl = new ReplayController('s', [{ seq: 0, label: 'Products' }, { seq: 1, label: 'Item' }]);
    const p = runLedgerReplay(events as never, ctl, { adapter: ad as any, ...LDEPS });
    await new Promise((r) => setTimeout(r, 10));
    expect(ctl.state.steps[0].status).toBe('fail');
    expect(ctl.state.steps[0].note).toBe('landed elsewhere');
    expect(ctl.state.mode).toBe('step');   // paused for the human at the NEXT step
    ctl.control('abort');
    const st = await p;
    expect(st.done).toBe(true);
    expect(st.steps[1].status).toBe('skipped');   // never ran past the mismatch
  });

  it('input event: recorded value replays; missing value asks via waitFor', async () => {
    const IN = ['RootWebArea "Login" [ref=e1]', '  textbox "user" [ref=e2]'].join('\n');
    const withValue = [hev(0,
      { kind: 'input', url: 'https://x.com/login', tagName: 'input', nameAttr: 'user', value: 'standard_user' })];
    const fills: string[] = [];
    const ad = () => ({
      open: async () => {}, goto: async () => {}, click: async () => {},
      fill: async (_r: string, v: string) => { fills.push(v); }, hover: async () => {},
      snapshot: async () => IN, currentUrl: async () => 'https://x.com/login',
      screenshot: async () => null, close: async () => '' });
    const st1 = await runLedgerReplay(withValue as never,
      new ReplayController('s1', [{ seq: 0, label: 'user' }]), { adapter: ad() as any, ...LDEPS });
    expect(st1.steps[0].status).toBe('ok');
    expect(fills).toEqual(['standard_user']);   // recorded variable replayed, no pause

    // same event without value + empty creds → ctl.waitFor('value') path (supply resumes)
    const noValue = [hev(0, { kind: 'input', url: 'https://x.com/login', tagName: 'input', nameAttr: 'user' })];
    const ctl = new ReplayController('s2', [{ seq: 0, label: 'user' }]);
    const p = runLedgerReplay(noValue as never, ctl, { adapter: ad() as any, ...LDEPS });
    await new Promise((r) => setTimeout(r, 10));
    expect(ctl.state.waiting).toBe('value');
    ctl.supply('typed', false);
    const st2 = await p;
    expect(st2.steps[0].status).toBe('ok');
    expect(fills).toEqual(['standard_user', 'typed']);   // supplied value filled
  });

  it('agent rows: navigate → goto target; hover → adapter.hover; type asks (no text ledgered)', async () => {
    const gotos: string[] = [];
    const hovers: string[] = [];
    const events = [
      { seq: 0, source: 'agent', kind: 'navigate', descriptor: { cmd: 'navigate', url: 'https://x.com/a', fromUrl: '' }, disposition: null },
      { seq: 1, source: 'agent', kind: 'hover', descriptor: { cmd: 'hover', ref: 'e9', role: 'button', name: 'Menu', url: 'https://x.com/a' }, disposition: null },
    ];
    const MENU = ['RootWebArea "A" [ref=e1]', '  button "Menu" [ref=e9]'].join('\n');
    const ad = {
      open: async () => {}, goto: async (u: string) => { gotos.push(u); }, click: async () => {},
      fill: async () => {}, hover: async (r: string) => { hovers.push(r); }, snapshot: async () => MENU,
      currentUrl: async () => 'https://x.com/a', screenshot: async () => null, close: async () => '' };
    const ctl = new ReplayController('s', [{ seq: 0, label: 'navigate' }, { seq: 1, label: 'Menu' }]);
    const st = await runLedgerReplay(events as never, ctl, { adapter: ad as any, ...LDEPS });
    expect(st.steps[0].status).toBe('jumped');
    expect(gotos).toEqual(['https://x.com/a']);
    expect(st.steps[1].status).toBe('ok');
    expect(hovers).toEqual(['e9']);   // resolved by role+name, then hovered

    // an agent `type` row carries no text → it must ASK (creds empty) — never a blank fill
    const typeEv = [{ seq: 0, source: 'agent', kind: 'type',
      descriptor: { cmd: 'type', ref: 'e2', role: 'textbox', name: 'Search', url: 'https://x.com/a' }, disposition: null }];
    const SEARCH = ['RootWebArea "A" [ref=e1]', '  textbox "Search" [ref=e2]'].join('\n');
    const ad2 = {
      open: async () => {}, goto: async () => {}, click: async () => {}, fill: async () => {}, hover: async () => {},
      snapshot: async () => SEARCH, currentUrl: async () => 'https://x.com/a',
      screenshot: async () => null, close: async () => '' };
    const ctl2 = new ReplayController('s2', [{ seq: 0, label: 'Search' }]);
    const p = runLedgerReplay(typeEv as never, ctl2, { adapter: ad2 as any, ...LDEPS });
    await new Promise((r) => setTimeout(r, 10));
    expect(ctl2.state.waiting).toBe('value');   // no ledgered text → asks
    ctl2.supply('query', false);
    const st2 = await p;
    expect(st2.steps[0].status).toBe('ok');
  });

  it('commit-word click waits for confirm; declined → skipped', async () => {
    // event label "Place Order" → ctl.waitFor('confirm'); confirm(false) → status 'skipped'
    const ORDER = ['RootWebArea "Cart" [ref=e1]', '  button "Place Order" [ref=e2]'].join('\n');
    let clicked = false;
    const events = [hev(0, { kind: 'click', url: 'https://x.com/cart', tagName: 'button', leafText: 'Place Order', role: null })];
    const ad = {
      open: async () => {}, goto: async () => {}, click: async () => { clicked = true; }, fill: async () => {},
      hover: async () => {}, snapshot: async () => ORDER, currentUrl: async () => 'https://x.com/cart',
      screenshot: async () => null, close: async () => '' };
    const ctl = new ReplayController('s', [{ seq: 0, label: 'Place Order' }]);
    const p = runLedgerReplay(events as never, ctl, { adapter: ad as any, ...LDEPS });
    await new Promise((r) => setTimeout(r, 10));
    expect(ctl.state.waiting).toBe('confirm');
    ctl.confirm(false);
    const st = await p;
    expect(st.steps[0].status).toBe('skipped');   // never fired (#2)
    expect(clicked).toBe(false);
  });
});
