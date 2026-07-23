import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { makeLiveExtensionBrowser, type AgentChannel } from '../../src/router/live-extension-browser.js';
import { parseSnapshot } from '../../src/playwright/snapshot.js';
import { adaptAXTree, type AXNode } from '../../src/playwright/ax-adapter.js';
import { ingestAX } from '../../src/recorder/ingest.js';
import { RecordStore } from '../../src/mapstore/record.js';

// Canned AX tree (raw CDP shape, mirrors tests/fixtures/ax/*.ax.json but inline —
// small enough not to need a fixture file). Root -> heading, link (w/ url), textbox
// Username, textbox Password, button Login.
const LOGIN_AX: AXNode[] = [
  { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Login' }, childIds: ['2', '3', '4', '5'] },
  { nodeId: '2', role: { value: 'heading' }, name: { value: 'Swag Labs' }, backendDOMNodeId: 100 },
  {
    nodeId: '3', role: { value: 'link' }, name: { value: 'Learn more' }, backendDOMNodeId: 101,
    properties: [{ name: 'url', value: { value: 'https://x.test/learn' } }],
  },
  { nodeId: '4', role: { value: 'textbox' }, name: { value: 'Username' }, backendDOMNodeId: 102 },
  { nodeId: '5', role: { value: 'textbox' }, name: { value: 'Password' }, backendDOMNodeId: 103 },
  { nodeId: '6', role: { value: 'button' }, name: { value: 'Login' }, backendDOMNodeId: 104 },
];
// Login root's childIds above omits node 6 on purpose in some tests below; give the
// full tree its own constant so "Login" button is reachable.
const FULL_LOGIN_AX: AXNode[] = [
  { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Login' }, childIds: ['2', '3', '4', '5', '6'] },
  ...LOGIN_AX.slice(1),
];

// FAKE AgentChannel: records dispatched commands, returns a canned AX tree.
function fakeChannel(ax: AXNode[]) {
  const dispatched: { kind: 'click' | 'type'; nodeId: string; text?: string }[] = [];
  const channel: AgentChannel = {
    getAX: async () => ax,
    dispatch: async (cmd) => { dispatched.push(cmd); },
  };
  return { channel, dispatched };
}

describe('makeLiveExtensionBrowser — snapshot()', () => {
  it('round-trips role/name/url through parseSnapshot (ref is re-keyed to an e-style walk ref, see act() tests)', async () => {
    const { channel } = fakeChannel(FULL_LOGIN_AX);
    const browser = makeLiveExtensionBrowser(channel, {});
    const yaml = await browser.snapshot();
    const nodes = parseSnapshot(yaml);

    const heading = nodes.find((n) => n.role === 'heading');
    expect(heading?.name).toBe('Swag Labs');

    const link = nodes.find((n) => n.role === 'link');
    expect(link?.name).toBe('Learn more');
    expect(link?.url).toBe('https://x.test/learn');
    // parseSnapshot's REF_RE only matches e\d+ refs — our serialized walk-ref must
    // be in that form for the caller's resolveStep/resolveByFingerprint to ever see
    // a non-null .ref (verified against src/playwright/snapshot.ts REF_RE).
    expect(link?.ref).toMatch(/^e\d+$/);

    const user = nodes.find((n) => n.role === 'textbox' && n.name === 'Username');
    expect(user?.ref).toMatch(/^e\d+$/);
  });

  it('callCount increments per channel round-trip (snapshot + act)', async () => {
    const { channel } = fakeChannel(FULL_LOGIN_AX);
    const browser = makeLiveExtensionBrowser(channel, {});
    expect(browser.callCount()).toBe(0);
    await browser.snapshot();
    expect(browser.callCount()).toBe(1);
    const yaml = await browser.snapshot();
    const loginRef = parseSnapshot(yaml).find((n) => n.role === 'button' && n.name === 'Login')!.ref!;
    await browser.act(loginRef, null);
    expect(browser.callCount()).toBe(3);   // 2 snapshots + 1 act dispatch
  });
});

describe('makeLiveExtensionBrowser — act()', () => {
  it('act(ref) on a plain node dispatches {kind:"click", nodeId} using the REFMAP nodeId, not the walk-ref string', async () => {
    const { channel, dispatched } = fakeChannel(FULL_LOGIN_AX);
    const browser = makeLiveExtensionBrowser(channel, {});
    const yaml = await browser.snapshot();
    const loginNode = parseSnapshot(yaml).find((n) => n.role === 'button' && n.name === 'Login')!;
    expect(loginNode.ref).not.toBe('6');   // walk-ref is NOT the raw channel nodeId

    await browser.act(loginNode.ref!, null);

    expect(dispatched).toEqual([{ kind: 'click', nodeId: '6' }]);   // '6' = the AX node's real nodeId
  });

  it('act(ref, "credentials") dispatches type(Username), type(Password), then click(ref)', async () => {
    const { channel, dispatched } = fakeChannel(FULL_LOGIN_AX);
    const browser = makeLiveExtensionBrowser(channel, { username: 'standard_user', password: 'secret_sauce' });
    const yaml = await browser.snapshot();
    const loginRef = parseSnapshot(yaml).find((n) => n.role === 'button' && n.name === 'Login')!.ref!;

    await browser.act(loginRef, 'credentials');

    expect(dispatched).toEqual([
      { kind: 'type', nodeId: '4', text: 'standard_user' },   // Username node
      { kind: 'type', nodeId: '5', text: 'secret_sauce' },    // Password node
      { kind: 'click', nodeId: '6' },                         // Login node, LAST
    ]);
  });

  it('act with a ref absent from the cached map throws a clear error', async () => {
    const { channel } = fakeChannel(FULL_LOGIN_AX);
    const browser = makeLiveExtensionBrowser(channel, {});
    await browser.snapshot();
    await expect(browser.act('e999', null)).rejects.toThrow(/e999/);
  });

  it('act() before any snapshot() throws a clear error (no cached refMap yet)', async () => {
    const { channel } = fakeChannel(FULL_LOGIN_AX);
    const browser = makeLiveExtensionBrowser(channel, {});
    await expect(browser.act('e1', null)).rejects.toThrow();
  });
});

describe('makeLiveExtensionBrowser — typeText()', () => {
  it('typeText(ref, text) dispatches {kind:"type", nodeId, text} using the REFMAP nodeId', async () => {
    const { channel, dispatched } = fakeChannel(FULL_LOGIN_AX);
    const browser = makeLiveExtensionBrowser(channel, {});
    const yaml = await browser.snapshot();
    const userRef = parseSnapshot(yaml).find((n) => n.role === 'textbox' && n.name === 'Username')!.ref!;

    expect(browser.typeText).toBeDefined();
    await browser.typeText!(userRef, 'hello');

    expect(dispatched).toEqual([{ kind: 'type', nodeId: '4', text: 'hello' }]);   // '4' = Username's real nodeId
  });
});

describe('makeLiveExtensionBrowser — goto/currentUrl delegate to the channel when present', () => {
  it('goto() calls channel.goto when supplied', async () => {
    const calls: string[] = [];
    const channel: AgentChannel = {
      getAX: async () => FULL_LOGIN_AX,
      dispatch: async () => {},
      goto: async (url: string) => { calls.push(url); },
    };
    const browser = makeLiveExtensionBrowser(channel, {});
    await browser.goto!('https://x.test/cart');
    expect(calls).toEqual(['https://x.test/cart']);
  });

  it('currentUrl() delegates to channel.currentUrl when supplied', async () => {
    const channel: AgentChannel = {
      getAX: async () => FULL_LOGIN_AX,
      dispatch: async () => {},
      currentUrl: async () => 'https://x.test/here',
    };
    const browser = makeLiveExtensionBrowser(channel, {});
    expect(await browser.currentUrl!()).toBe('https://x.test/here');
  });

  it('goto/currentUrl are undefined when the channel does not supply them', () => {
    const { channel } = fakeChannel(FULL_LOGIN_AX);
    const browser = makeLiveExtensionBrowser(channel, {});
    expect(browser.goto).toBeUndefined();
    expect(browser.currentUrl).toBeUndefined();
  });
});

// A second landing to pair against: the inventory page after a click/goto.
const INVENTORY_AX: AXNode[] = [
  { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Inventory' }, childIds: ['2', '3'] },
  { nodeId: '2', role: { value: 'heading' }, name: { value: 'Products' }, backendDOMNodeId: 200 },
  {
    nodeId: '3', role: { value: 'link' }, name: { value: 'Cart' }, backendDOMNodeId: 201,
    properties: [{ name: 'url', value: { value: 'https://x.test/cart' } }],
  },
];

// A scripted channel: getAX() returns the next canned tree each call; currentUrl()
// returns the matching url; records dispatched commands + goto targets.
function scriptedChannel(pages: { ax: AXNode[]; url: string }[]) {
  const dispatched: { kind: 'click' | 'type'; nodeId: string; text?: string }[] = [];
  const gotos: string[] = [];
  let i = 0;
  let cur = pages[0];
  const channel: AgentChannel = {
    getAX: async () => { cur = pages[Math.min(i, pages.length - 1)]; i++; return cur.ax; },
    currentUrl: async () => cur.url,
    dispatch: async (cmd) => { dispatched.push(cmd); },
    goto: async (url: string) => { gotos.push(url); },
  };
  return { channel, dispatched, gotos };
}

describe('makeLiveExtensionBrowser — recording (RawAXStep for ingestAX)', () => {
  it('snapshot→act(click)→snapshot buffers a step: raw fromAX/toAX, toUrl, and clickedRef = the bN indexing the clicked node in fromAX (NOT the eN walk ref — the pairing trap)', async () => {
    const { channel } = scriptedChannel([
      { ax: FULL_LOGIN_AX, url: 'https://x.test/login' },
      { ax: INVENTORY_AX, url: 'https://x.test/inventory' },
    ]);
    const browser = makeLiveExtensionBrowser(channel, {});

    const yaml = await browser.snapshot();          // fromAX = LOGIN
    const login = parseSnapshot(yaml).find((n) => n.role === 'button' && n.name === 'Login')!;
    expect(login.ref).toMatch(/^e\d+$/);            // agent acts on the eN
    await browser.act(login.ref!, null);
    await browser.snapshot();                       // toAX = INVENTORY

    const steps = browser.getRecordedSteps();
    expect(steps.length).toBe(1);
    const step = steps[0];
    expect(step.fromUrl).toBe('https://x.test/login');
    expect(step.toUrl).toBe('https://x.test/inventory');
    expect(step.fromAX).toBe(FULL_LOGIN_AX);        // RAW CDP tree, not the eN-rekeyed SnapNode[]
    expect(step.toAX).toBe(INVENTORY_AX);

    // THE TRAP: clickedRef must be the bN that indexes the Login button in the ADAPTED
    // fromAX (what ingestAX re-derives), NOT the eN the agent saw. Prove it resolves to
    // the Login button through the SAME path ingestAX uses.
    expect(step.clickedRef).not.toBe(login.ref);    // not the eN
    expect(step.clickedRef).toMatch(/^b\d+$/);
    const adapted = adaptAXTree(step.fromAX);
    const resolved = adapted.find((n) => n.ref === step.clickedRef);
    expect(resolved?.role).toBe('button');
    expect(resolved?.name).toBe('Login');
  });

  it('a goto step records clickedRef=null and pairs the pre-goto page to the post-goto snapshot', async () => {
    const { channel } = scriptedChannel([
      { ax: FULL_LOGIN_AX, url: 'https://x.test/login' },
      { ax: INVENTORY_AX, url: 'https://x.test/inventory' },
    ]);
    const browser = makeLiveExtensionBrowser(channel, {});
    await browser.snapshot();                        // fromAX = LOGIN
    await browser.goto!('https://x.test/inventory');
    await browser.snapshot();                        // toAX = INVENTORY

    const steps = browser.getRecordedSteps();
    expect(steps.length).toBe(1);
    expect(steps[0].clickedRef).toBeNull();
    expect(steps[0].fromUrl).toBe('https://x.test/login');
    expect(steps[0].toUrl).toBe('https://x.test/inventory');
  });

  it('a bare snapshot with no action records no step', async () => {
    const { channel } = scriptedChannel([{ ax: FULL_LOGIN_AX, url: 'https://x.test/login' }]);
    const browser = makeLiveExtensionBrowser(channel, {});
    await browser.snapshot();
    await browser.snapshot();
    expect(browser.getRecordedSteps()).toEqual([]);
  });

  it('typeText records the FIELD node identity but NO typed-text value (secret-safe)', async () => {
    const { channel } = scriptedChannel([
      { ax: FULL_LOGIN_AX, url: 'https://x.test/login' },
      { ax: INVENTORY_AX, url: 'https://x.test/inventory' },
    ]);
    const browser = makeLiveExtensionBrowser(channel, {});
    const yaml = await browser.snapshot();
    const user = parseSnapshot(yaml).find((n) => n.role === 'textbox' && n.name === 'Username')!;
    await browser.typeText!(user.ref!, 'super_secret_password');
    await browser.snapshot();

    const step = browser.getRecordedSteps()[0];
    // The step records the field's identity via clickedRef; the typed value is nowhere.
    const adapted = adaptAXTree(step.fromAX);
    expect(adapted.find((n) => n.ref === step.clickedRef)?.name).toBe('Username');
    expect(JSON.stringify(step)).not.toContain('super_secret_password');
  });

  it('a run flushed through ingestAX produces a RecordStore session (would show on `dev dashboard`) with the clicked node fingerprinted — no typed text stored', async () => {
    const { channel } = scriptedChannel([
      { ax: FULL_LOGIN_AX, url: 'https://x.test/login' },
      { ax: INVENTORY_AX, url: 'https://x.test/inventory' },
    ]);
    const browser = makeLiveExtensionBrowser(channel, { username: 'standard_user', password: 'secret_sauce' });
    const yaml = await browser.snapshot();
    const login = parseSnapshot(yaml).find((n) => n.role === 'button' && n.name === 'Login')!;
    await browser.act(login.ref!, 'credentials');    // fires type Username/Password then click Login
    await browser.snapshot();

    const store = RecordStore.fromDatabase(new Database(':memory:'));
    const appended = ingestAX({ sessionId: 'agent-run-1', steps: browser.getRecordedSteps() }, store);
    expect(appended).toBe(1);

    // a session row exists (with steps>0) → the dashboard sees it
    const session = store.listSessions().find((s) => s.sessionId === 'agent-run-1');
    expect(session).toBeTruthy();
    expect(session!.steps).toBe(1);
    const effects = store.actionEffects('agent-run-1');
    expect(effects.length).toBe(1);
    // the SEMANTIC clicked node was the Login button (not the credential pre-fills)
    expect(effects[0].action?.elementFp?.role).toBe('button');
    expect(effects[0].action?.elementFp?.name).toBe('Login');
    // no credential VALUE leaked into the stored effect (map stores structure, not values)
    const stored = JSON.stringify(effects);
    expect(stored).not.toContain('standard_user');
    expect(stored).not.toContain('secret_sauce');
  });
});

// ── settle-by-quiescence (Task 5): a navigated click's landing must plateau before the
// pending step closes, so a hydrating SPA's step carries the FULL tree, not the shell ──
//
// A shell (2 content nodes) that hydrates into a full page (5). snapshotsPlateaued sees the
// growing identity-token multiset as NOT plateaued until it stops.
const SHELL_AX: AXNode[] = [
  { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Dash' }, childIds: ['2'] },
  { nodeId: '2', role: { value: 'heading' }, name: { value: 'Loading' }, backendDOMNodeId: 300 },
];
const HYDRATED_AX: AXNode[] = [
  { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Dash' }, childIds: ['2', '3', '4', '5'] },
  { nodeId: '2', role: { value: 'heading' }, name: { value: 'Dashboard' }, backendDOMNodeId: 300 },
  { nodeId: '3', role: { value: 'button' }, name: { value: 'Filter' }, backendDOMNodeId: 301 },
  { nodeId: '4', role: { value: 'button' }, name: { value: 'Export' }, backendDOMNodeId: 302 },
  { nodeId: '5', role: { value: 'tab' }, name: { value: 'Overview' }, backendDOMNodeId: 303 },
];

describe('makeLiveExtensionBrowser — settle-by-quiescence on a navigated landing', () => {
  it('growing-then-stable NAVIGATED step closes on the hydrated tree with settled:true', async () => {
    // A pending step whose from-url differs from the landed url. Model it by giving the channel
    // a from-url on the first read and the landed url thereafter.
    let phase = 0;   // 0 = on login (pre-click), 1+ = landed on /dash
    let i = 0; let axCalls = 0;
    const channel: AgentChannel = {
      getAX: async () => { axCalls++; const trees = [SHELL_AX, HYDRATED_AX, HYDRATED_AX]; const t = i === 0 ? SHELL_AX : trees[Math.min(i, trees.length - 1)]; i++; return t; },
      dispatch: async () => { phase = 1; },
      currentUrl: async () => (phase === 0 ? 'https://x.test/login' : 'https://x.test/dash'),
    };
    const browser = makeLiveExtensionBrowser(channel, {});
    const y = await browser.snapshot();          // read login page (shell), phase 0
    const node = parseSnapshot(y).find((n) => n.role === 'heading')!;
    await browser.act(node.ref!, null);          // click → phase 1, pending.fromUrl = /login
    await browser.snapshot();                    // land on /dash → navigated → plateau loop
    const steps = browser.getRecordedSteps();
    expect(steps.length).toBe(1);
    expect(steps[0].settled).toBe(true);
    // toAX is the HYDRATED tree (adapting it yields the buttons/tab, not just the shell heading).
    const landed = adaptAXTree(steps[0].toAX);
    expect(landed.some((n) => n.role === 'button' && n.name === 'Filter')).toBe(true);
    expect(landed.some((n) => n.role === 'tab' && n.name === 'Overview')).toBe(true);
    expect(axCalls).toBeGreaterThanOrEqual(2);   // navigated refresh legitimately polls ≥2
  });

  it('never-stable NAVIGATED step: settled:false at budget, closes on the LAST tree', async () => {
    // Each getAX returns a DIFFERENT-count tree — never plateaus. Budget (tests/setup.ts = 100ms,
    // gap 5ms) exhausts; the step records settled:false with whatever tree was last read.
    let phase = 0; let n = 0; let axCalls = 0;
    const grow = (k: number): AXNode[] => [
      { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Feed' }, childIds: Array.from({ length: k }, (_, j) => String(j + 2)) },
      ...Array.from({ length: k }, (_, j) => ({ nodeId: String(j + 2), role: { value: 'button' }, name: { value: 'Item ' + j }, backendDOMNodeId: 400 + j })),
    ];
    const channel: AgentChannel = {
      getAX: async () => { axCalls++; return grow(2 + n++); },   // 2,3,4,… never repeats
      dispatch: async () => { phase = 1; },
      currentUrl: async () => (phase === 0 ? 'https://x.test/a' : 'https://x.test/b'),
    };
    const browser = makeLiveExtensionBrowser(channel, {});
    const y = await browser.snapshot();
    const node = parseSnapshot(y).find((n2) => n2.role === 'button')!;
    await browser.act(node.ref!, null);          // navigated (/a → /b)
    await browser.snapshot();
    const steps = browser.getRecordedSteps();
    expect(steps.length).toBe(1);
    expect(steps[0].settled).toBe(false);
    // closed on the LAST-read (biggest) tree, not the first
    const landed = adaptAXTree(steps[0].toAX);
    expect(landed.filter((x) => x.role === 'button').length).toBeGreaterThan(2);
  });

  it('bare snapshot with NO pending = exactly 1 getAX (agent read never balloons)', async () => {
    let axCalls = 0;
    const channel: AgentChannel = {
      getAX: async () => { axCalls++; return HYDRATED_AX; },
      dispatch: async () => {},
      currentUrl: async () => 'https://x.test/p',
    };
    const browser = makeLiveExtensionBrowser(channel, {});
    await browser.snapshot();
    expect(axCalls).toBe(1);
    await browser.snapshot();
    expect(axCalls).toBe(2);   // still 1 per bare read, no plateau polling
  });

  it('pending NON-navigated (same-page reveal) = exactly 1 getAX, settled undefined', async () => {
    // from-url == landed url → not navigated → no plateau loop (an auto-dismissing menu would
    // lose its reveal diff to extra polls). The step closes on the single read, settled=undefined.
    let i = 0; let axCalls = 0;
    const channel: AgentChannel = {
      getAX: async () => { axCalls++; const t = i === 0 ? SHELL_AX : HYDRATED_AX; i++; return t; },
      dispatch: async () => {},
      currentUrl: async () => 'https://x.test/same',   // never changes → not navigated
    };
    const browser = makeLiveExtensionBrowser(channel, {});
    const y = await browser.snapshot();          // read 1
    const node = parseSnapshot(y).find((n) => n.role === 'heading')!;
    await browser.act(node.ref!, null);          // reveal on the same page
    const before = axCalls;
    await browser.snapshot();                    // closes the reveal step
    expect(axCalls - before).toBe(1);            // exactly ONE getAX for the closing read
    const steps = browser.getRecordedSteps();
    expect(steps[0].settled).toBeUndefined();
  });
});

describe('recording: a click followed by a snapshot on the LANDED page yields a real navigation step', () => {
  it('the closed step carries the landing url + AX (not the degenerate same-page fallback)', async () => {
    // Two pages: home (has a Popular link) and popular (different heading).
    const HOME: AXNode[] = [
      { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Home' }, childIds: ['2'] },
      { nodeId: '2', role: { value: 'link' }, name: { value: 'Popular' }, backendDOMNodeId: 200 },
    ];
    const POPULAR: AXNode[] = [
      { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'r/popular' }, childIds: ['2'] },
      { nodeId: '2', role: { value: 'heading' }, name: { value: 'Popular feed' }, backendDOMNodeId: 300 },
    ];
    let ax = HOME; let url = 'https://r.test/';
    const channel: AgentChannel = {
      getAX: async () => ax,
      dispatch: async () => { /* click fired */ },
      currentUrl: async () => url,
    };
    const browser = makeLiveExtensionBrowser(channel, {});
    const homeYaml = await browser.snapshot();   // read home (lastAX = home)
    const popRef = parseSnapshot(homeYaml).find((n) => n.role === 'link' && n.name === 'Popular')!.ref!;
    await browser.act(popRef, null);          // click "Popular" → opens a pending step (fromAX=home)
    ax = POPULAR; url = 'https://r.test/r/popular/';   // the SPA navigated
    await browser.snapshot();                 // build_map's snapshot-first: closes the step on the LANDING
    const steps = browser.getRecordedSteps();
    expect(steps.length).toBe(1);
    expect(steps[0].fromUrl).toBe('https://r.test/');
    expect(steps[0].toUrl).toBe('https://r.test/r/popular/');   // real landing, NOT the degenerate from-url

    // and it ingests as a genuine navigation (distinct from + to → an edge is possible)
    const store = RecordStore.fromDatabase(new Database(':memory:'));
    ingestAX({ sessionId: 'nav', steps }, store);
    const fx = store.actionEffects('nav')[0];
    expect(fx.navigated).toBe(true);
  });
});
