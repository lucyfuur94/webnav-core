import { describe, it, expect } from 'vitest';
import { MapStore } from '../../src/mapstore/store.js';
import { makeState, makeEdge } from '../../src/mapstore/types.js';
import type { State } from '../../src/mapstore/types.js';
import { runAgentGoal, type QueryFn, type ToolDef } from '../../src/agent/loop.js';
import type { AgentEvent } from '../../src/agent/server.js';
import type { WalkBrowser } from '../../src/router/walk.js';

// The REAL SDK is never imported here. runAgentGoal takes an injectable `query`
// seam; every test passes a fake async generator that drives the tools it was
// handed, proving tool calls route to the browser without any network call.

// A fake WalkBrowser that records the calls the loop's tools make against it, and
// returns a scripted snapshot YAML (so check_route can parse + match a state).
function fakeBrowser(snapshotYaml: string): WalkBrowser & { acted: Array<[string, string | null]>; gotos: string[]; typed: Array<[string, string]>; scrolls: number[] } {
  const acted: Array<[string, string | null]> = [];
  const gotos: string[] = [];
  const typed: Array<[string, string]> = [];
  const scrolls: number[] = [];
  return {
    acted,
    gotos,
    typed,
    scrolls,
    snapshot: async () => snapshotYaml,
    act: async (ref, slot) => { acted.push([ref, slot]); },
    goto: async (url) => { gotos.push(url); },
    typeText: async (ref, text) => { typed.push([ref, text]); },
    scroll: async (dy) => { scrolls.push(dy); },
    callCount: () => acted.length + gotos.length,
  };
}

// A browser variant with NO typeText — proves the honest-fallback path (no
// silent click-and-claim-success on a browser that can't do raw free-text input).
function fakeBrowserNoTypeText(snapshotYaml: string): WalkBrowser & { acted: Array<[string, string | null]>; gotos: string[] } {
  const acted: Array<[string, string | null]> = [];
  const gotos: string[] = [];
  return {
    acted,
    gotos,
    snapshot: async () => snapshotYaml,
    act: async (ref, slot) => { acted.push([ref, slot]); },
    goto: async (url) => { gotos.push(url); },
    callCount: () => acted.length + gotos.length,
  };
}

// One text block + one tool_use, mirroring the SDK's assistant-message shape
// (msg.message.content[]) enough for the loop's stream forwarding to read it.
function assistantMsg(blocks: unknown[]): any {
  return { type: 'assistant', message: { content: blocks } };
}
function resultMsg(text: string): any {
  return { type: 'result', subtype: 'success', result: text };
}

// Build a fake query that (a) narrates one line, (b) invokes a named tool via the
// handed-in ToolDef[], then (c) forwards the tool result text and finishes. The
// tool call runs the REAL handler (which drives the injected browser/store).
function fakeQueryCalling(toolName: string, input: Record<string, unknown>): { fn: QueryFn; toolResult: () => string } {
  let captured = '';
  const fn: QueryFn = async function* ({ tools, emit: _emit }) {
    yield assistantMsg([{ type: 'text', text: 'thinking about it' }]);
    const def = tools.find((t) => t.name === toolName);
    if (!def) throw new Error('fake query: tool not found: ' + toolName);
    yield assistantMsg([{ type: 'tool_use', name: 'mcp__webnav__' + toolName, input }]);
    const out = await def.handler(input, {});
    captured = (out.content?.[0] as any)?.text ?? '';
    yield resultMsg('done: ' + captured.slice(0, 40));
  };
  return { fn, toolResult: () => captured };
}

function emitSpy(): { emit: (e: AgentEvent) => void; events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  return { emit: (e) => events.push(e), events };
}

function newStore(): MapStore {
  return new MapStore(':memory:');
}

// A snapshot whose nodes match the `inventory` state fingerprint below.
const INVENTORY_SNAP = [
  'RootWebArea "Swag Labs" [ref=e1]',
  '  button "Add to cart" [ref=e2]',
  '  link "Cart" [ref=e3]',
].join('\n');

function invStates(): State[] {
  const inv = makeState({ id: 'sd:inventory', nodeId: 'saucedemo', semanticName: 'Inventory', urlPattern: '/inventory.html', role: 'section', fingerprint: ['button:Add to cart'] });
  const cart = makeState({ id: 'sd:cart', nodeId: 'saucedemo', semanticName: 'Cart', urlPattern: '/cart.html', role: 'section', fingerprint: ['link:Checkout'] });
  return [inv, cart];
}

describe('runAgentGoal — agent loop over webnav tools', () => {
  it('a click tool-call in the fake query stream routes to browser.act(ref, null)', async () => {
    const browser = fakeBrowser(INVENTORY_SNAP);
    const store = newStore();
    const { fn } = fakeQueryCalling('click', { ref: 'e2' });
    const { emit } = emitSpy();
    await runAgentGoal({ goal: 'add to cart', sessionId: 's1', mode: 'act', browser, store, states: [], emit, query: fn });
    expect(browser.acted).toEqual([['e2', null]]);
  });

  it('a type tool-call routes to browser.typeText(ref, text) — NOT act (act only clicks)', async () => {
    const browser = fakeBrowser(INVENTORY_SNAP);
    const store = newStore();
    const { fn, toolResult } = fakeQueryCalling('type', { ref: 'e5', text: 'hello' });
    const { emit } = emitSpy();
    await runAgentGoal({ goal: 'type it', sessionId: 's2', mode: 'act', browser, store, states: [], emit, query: fn });
    expect(browser.typed).toEqual([['e5', 'hello']]);
    expect(browser.acted).toEqual([]);
    expect(toolResult()).toContain('hello');
    expect(toolResult()).toContain('e5');
  });

  it('a type tool-call on a browser with no typeText support returns an honest NOT-filled result (never a silent click)', async () => {
    const browser = fakeBrowserNoTypeText(INVENTORY_SNAP);
    const store = newStore();
    const { fn, toolResult } = fakeQueryCalling('type', { ref: 'e5', text: 'hello' });
    const { emit } = emitSpy();
    await runAgentGoal({ goal: 'type it', sessionId: 's2b', mode: 'act', browser, store, states: [], emit, query: fn });
    expect(browser.acted).toEqual([]);
    expect(toolResult()).toMatch(/not filled|cannot type/i);
  });

  it('a goto tool-call routes to browser.goto(url)', async () => {
    const browser = fakeBrowser(INVENTORY_SNAP);
    const store = newStore();
    const { fn } = fakeQueryCalling('goto', { url: 'https://x.test/cart.html' });
    const { emit } = emitSpy();
    await runAgentGoal({ goal: 'go', sessionId: 's3', mode: 'act', browser, store, states: [], emit, query: fn });
    expect(browser.gotos).toEqual(['https://x.test/cart.html']);
  });

  it('a scroll tool-call routes to browser.scroll(dy)', async () => {
    const browser = fakeBrowser(INVENTORY_SNAP);
    const store = newStore();
    const { fn } = fakeQueryCalling('scroll', { dy: 600 });
    const { emit } = emitSpy();
    await runAgentGoal({ goal: 'scroll down', sessionId: 's-scroll', mode: 'act', browser, store, states: [], emit, query: fn });
    expect(browser.scrolls).toEqual([600]);
  });

  it('get_page_ax returns the browser snapshot as tool text', async () => {
    const browser = fakeBrowser(INVENTORY_SNAP);
    const store = newStore();
    const { fn, toolResult } = fakeQueryCalling('get_page_ax', {});
    const { emit } = emitSpy();
    await runAgentGoal({ goal: 'look', sessionId: 's4', mode: 'ask', browser, store, states: [], emit, query: fn });
    expect(toolResult()).toContain('Add to cart');
  });

  // ---- list_routes: the agent discovers a site's recallable destinations --------
  // Two sites in one loaded state-set. siteA has two real destinations + a _shell
  // (empty fp, routing source only) + an empty-fp stub. siteB is a whole other site.
  function twoSiteStates(): State[] {
    const aHome = makeState({ id: 'siteA:home', nodeId: 'site.example', semanticName: 'Home', urlPattern: '/', role: 'section', fingerprint: ['button:Add to cart'] });
    const aCart = makeState({ id: 'siteA:cart', nodeId: 'site.example', semanticName: 'Cart', urlPattern: '/cart', role: 'section', fingerprint: ['link:Checkout'] });
    const aShell = makeState({ id: 'siteA:_shell', nodeId: 'site.example', semanticName: 'shell', urlPattern: '/', role: 'shell', fingerprint: [] });
    const aStub = makeState({ id: 'siteA:stub', nodeId: 'site.example', semanticName: 'Provisional', urlPattern: '/x', role: 'detail', fingerprint: [] });
    const bHome = makeState({ id: 'siteB:home', nodeId: 'other.example', semanticName: 'B Home', urlPattern: '/', role: 'section', fingerprint: ['heading:Welcome'] });
    return [aHome, aCart, aShell, aStub, bHome];
  }

  it('list_routes on siteA lists siteA real destinations (id+name), EXCLUDES _shell + empty-fp stubs, EXCLUDES other site', async () => {
    const store = newStore();
    const states = twoSiteStates();
    // Browser is on siteA:home (its fingerprint), so the current site resolves to site.example.
    const browser = fakeBrowser(INVENTORY_SNAP);
    const { fn, toolResult } = fakeQueryCalling('list_routes', {});
    const { emit } = emitSpy();
    await runAgentGoal({ goal: 'discover', sessionId: 'l1', mode: 'act', browser, store, states, emit, query: fn });
    const out = toolResult();
    expect(out).toContain('siteA:home');
    expect(out).toContain('Home');
    expect(out).toContain('siteA:cart');
    expect(out).toContain('Cart');
    expect(out).not.toContain('siteA:_shell');   // routing source, never a destination
    expect(out).not.toContain('siteA:stub');     // empty fingerprint = not a real destination
    expect(out).not.toContain('siteB:home');     // a different site
  });

  it('list_routes when the current page matches NO state falls back to ALL sites\' destinations (still excludes _shell + empty-fp)', async () => {
    const store = newStore();
    const states = twoSiteStates();
    const browser = fakeBrowser('RootWebArea "Unknown page" [ref=e1]');
    const { fn, toolResult } = fakeQueryCalling('list_routes', {});
    const { emit } = emitSpy();
    await runAgentGoal({ goal: 'discover', sessionId: 'l2', mode: 'act', browser, store, states, emit, query: fn });
    const out = toolResult();
    expect(out).toContain('siteA:home');
    expect(out).toContain('siteB:home');
    expect(out).not.toContain('siteA:_shell');
    expect(out).not.toContain('siteA:stub');
  });

  it('discovery -> recall: an id surfaced by list_routes is usable by check_route (findPath matches it)', async () => {
    const store = newStore();
    const states = invStates();
    for (const s of states) store.upsertState(s);
    store.upsertEdge(makeEdge({ fromState: 'sd:inventory', toState: 'sd:cart', semanticStep: 'open cart', kind: 'navigate' }));
    const browser = fakeBrowser(INVENTORY_SNAP);
    // Step 1: list_routes surfaces the destination id.
    const list = fakeQueryCalling('list_routes', {});
    const { emit: e1 } = emitSpy();
    await runAgentGoal({ goal: 'discover', sessionId: 'l3a', mode: 'act', browser, store, states, emit: e1, query: list.fn });
    expect(list.toolResult()).toContain('sd:cart');
    // Step 2: feed that id to check_route — it resolves a route (proves the id is usable).
    const check = fakeQueryCalling('check_route', { goalStateId: 'sd:cart' });
    const { emit: e2 } = emitSpy();
    await runAgentGoal({ goal: 'reach cart', sessionId: 'l3b', mode: 'act', browser, store, states, emit: e2, query: check.fn });
    expect(check.toolResult()).toContain('sd:inventory');
    expect(check.toolResult()).toContain('sd:cart');
    expect(check.toolResult()).not.toMatch(/drive manually|no route/i);
  });

  it('check_route on a KNOWN state with a findable path consults findPath and runs walkRoute', async () => {
    // Store the two states + an edge so findPath(inventory -> cart) succeeds.
    const store = newStore();
    const states = invStates();
    for (const s of states) store.upsertState(s);
    store.upsertEdge(makeEdge({ fromState: 'sd:inventory', toState: 'sd:cart', semanticStep: 'open cart', kind: 'navigate' }));
    // The browser snapshot matches sd:inventory, so matchState resolves the start.
    const browser = fakeBrowser(INVENTORY_SNAP);
    const { fn, toolResult } = fakeQueryCalling('check_route', { goalStateId: 'sd:cart' });
    const { emit } = emitSpy();
    await runAgentGoal({ goal: 'reach cart', sessionId: 's5', mode: 'act', browser, store, states, emit, query: fn });
    // A hit reports the path it found + the walkRoute terminal status — never a "drive manually".
    expect(toolResult()).toContain('sd:inventory');
    expect(toolResult()).toContain('sd:cart');
    expect(toolResult()).not.toMatch(/drive manually|no route/i);
  });

  it('check_route with NO matching state returns the drive-manually branch (no walkRoute)', async () => {
    const store = newStore();
    const states = invStates();
    for (const s of states) store.upsertState(s);
    // A snapshot that matches NO state fingerprint.
    const browser = fakeBrowser('RootWebArea "Unknown page" [ref=e1]');
    const { fn, toolResult } = fakeQueryCalling('check_route', { goalStateId: 'sd:cart' });
    const { emit } = emitSpy();
    await runAgentGoal({ goal: 'reach cart', sessionId: 's6', mode: 'act', browser, store, states, emit, query: fn });
    expect(toolResult()).toMatch(/drive manually|not on a known state|no route/i);
    // walkRoute was never entered, so the browser did no navigation actions.
    expect(browser.acted).toEqual([]);
    expect(browser.gotos).toEqual([]);
  });

  it('emits events in order: turn, then narrate, then done', async () => {
    const browser = fakeBrowser(INVENTORY_SNAP);
    const store = newStore();
    const { fn } = fakeQueryCalling('click', { ref: 'e2' });
    const { emit, events } = emitSpy();
    await runAgentGoal({ goal: 'go', sessionId: 's7', mode: 'act', browser, store, states: [], emit, query: fn });
    const kinds = events.map((e) => e.type);
    const turnIdx = kinds.indexOf('turn');
    const narrateIdx = kinds.indexOf('narrate');
    const doneIdx = kinds.lastIndexOf('done');
    expect(turnIdx).toBeGreaterThanOrEqual(0);
    expect(narrateIdx).toBeGreaterThan(turnIdx);
    expect(doneIdx).toBeGreaterThan(narrateIdx);
  });

  it('the loop emits ZERO type:"action" events — action is the EXECUTE channel (server.ts), narration is display-only', async () => {
    const browser = fakeBrowser(INVENTORY_SNAP);
    const store = newStore();
    // Exercise every narrating tool + the tool_use forwarding path.
    for (const [tool, input] of [
      ['click', { ref: 'e2' }],
      ['type', { ref: 'e5', text: 'x' }],
      ['goto', { url: 'https://x.test/' }],
      ['get_page_ax', {}],
    ] as const) {
      const { fn } = fakeQueryCalling(tool, input as Record<string, unknown>);
      const { emit, events } = emitSpy();
      await runAgentGoal({ goal: 'g', sessionId: 'sz', mode: 'act', browser, store, states: [], emit, query: fn });
      expect(events.some((e) => e.type === 'action')).toBe(false);
    }
  });

  it('mode "ask" emits a plan event at the start', async () => {
    const browser = fakeBrowser(INVENTORY_SNAP);
    const store = newStore();
    const { fn } = fakeQueryCalling('get_page_ax', {});
    const { emit, events } = emitSpy();
    await runAgentGoal({ goal: 'g', sessionId: 's8', mode: 'ask', browser, store, states: [], emit, query: fn });
    expect(events.some((e) => e.type === 'plan')).toBe(true);
  });

  it('a thrown error in the query stream surfaces as an error event', async () => {
    const browser = fakeBrowser(INVENTORY_SNAP);
    const store = newStore();
    const fn: QueryFn = async function* () { throw new Error('boom'); };
    const { emit, events } = emitSpy();
    await runAgentGoal({ goal: 'g', sessionId: 's9', mode: 'act', browser, store, states: [], emit, query: fn });
    expect(events.some((e) => e.type === 'error' && /boom/.test((e as any).message))).toBe(true);
  });

  // ---- Ask/Auto/Act gate semantics (crit #3/#4) -----------------------------
  // A query that RECORDS whether it ran (so we can assert Ask blocks before driving).
  function trackingQuery(): { fn: QueryFn; ran: () => boolean } {
    let started = false;
    const fn: QueryFn = async function* () {
      started = true;
      yield assistantMsg([{ type: 'text', text: 'go' }]);
      yield resultMsg('done');
    };
    return { fn, ran: () => started };
  }

  it('ask mode: emits plan, then AWAITS approval BEFORE query runs (blocks before first drive)', async () => {
    const browser = fakeBrowser(INVENTORY_SNAP);
    const store = newStore();
    const { fn, ran } = trackingQuery();
    const { emit, events } = emitSpy();
    // Controllable gate: stays pending until we resolve it.
    let resolveApproval!: (v: boolean) => void;
    const approvalP = new Promise<boolean>((r) => { resolveApproval = r; });
    let awaited = false;
    const awaitApproval = () => { awaited = true; return approvalP; };

    const runP = runAgentGoal({ goal: 'g', sessionId: 'a1', mode: 'ask', browser, store, states: [], emit, query: fn, awaitApproval });
    // Give the loop a tick to emit the plan + reach the await.
    await new Promise((r) => setTimeout(r, 0));
    expect(events.some((e) => e.type === 'plan')).toBe(true);
    expect(awaited).toBe(true);
    expect(ran()).toBe(false); // BLOCKED — query has NOT started before approval

    resolveApproval(true);
    await runP;
    expect(ran()).toBe(true); // approved → query ran
  });

  it('ask mode + deny: query never runs, no browser calls, a "denied" done event is emitted', async () => {
    const browser = fakeBrowser(INVENTORY_SNAP);
    const store = newStore();
    const { fn, ran } = trackingQuery();
    const { emit, events } = emitSpy();
    const awaitApproval = () => Promise.resolve(false);

    await runAgentGoal({ goal: 'g', sessionId: 'a2', mode: 'ask', browser, store, states: [], emit, query: fn, awaitApproval });
    expect(ran()).toBe(false);
    expect(browser.callCount()).toBe(0);
    const done = events.find((e) => e.type === 'done') as any;
    expect(done).toBeTruthy();
    expect(String(done.summary)).toMatch(/denied/i);
  });

  it('act mode: runs immediately, approval is NEVER awaited', async () => {
    const browser = fakeBrowser(INVENTORY_SNAP);
    const store = newStore();
    const { fn, ran } = trackingQuery();
    const { emit } = emitSpy();
    let awaited = false;
    const awaitApproval = () => { awaited = true; return Promise.resolve(true); };

    await runAgentGoal({ goal: 'g', sessionId: 'a3', mode: 'act', browser, store, states: [], emit, query: fn, awaitApproval });
    expect(awaited).toBe(false); // Act gates nothing
    expect(ran()).toBe(true);
  });

  it('act mode: a cross-origin goto drives freely (no approval, no gate)', async () => {
    // Two-mode model (Ask/Act): Auto and its cross-origin confirm were removed. Act just
    // drives; the only hard stop is a commit point, enforced by walkRoute, not by mode.
    const store = newStore();
    const browser = fakeBrowser('RootWebArea "on x" [ref=e1]');
    (browser as any).currentUrl = async () => 'https://x.test/page';
    const { fn: gotoFn } = fakeQueryCalling('goto', { url: 'https://other.test/here' });
    const { emit } = emitSpy();
    let awaited = false;
    const awaitApproval = () => { awaited = true; return Promise.resolve(false); };
    await runAgentGoal({ goal: 'g', sessionId: 'a5', mode: 'act', browser, store, states: [], emit, query: gotoFn, awaitApproval });
    expect(awaited).toBe(false); // Act never asks
    expect(browser.gotos).toEqual(['https://other.test/here']); // navigated freely
  });

  // ---- model selection: the panel's chosen model threads into the QueryFn -------
  // A fake that CAPTURES the `model` param the loop passed (undefined when unset),
  // proving runAgentGoal({ model }) reaches the SDK-query seam.
  function modelCapturingQuery(): { fn: QueryFn; model: () => string | undefined; called: () => boolean } {
    let captured: string | undefined;
    let called = false;
    const fn: QueryFn = async function* ({ model }) {
      called = true;
      captured = model;
      yield resultMsg('ok');
    };
    return { fn, model: () => captured, called: () => called };
  }

  it('a model id threads into the QueryFn params', async () => {
    const browser = fakeBrowser(INVENTORY_SNAP);
    const store = newStore();
    const { fn, model, called } = modelCapturingQuery();
    const { emit } = emitSpy();
    await runAgentGoal({ goal: 'g', sessionId: 'm1', mode: 'act', model: 'claude-opus-4-8', browser, store, states: [], emit, query: fn });
    expect(called()).toBe(true);
    expect(model()).toBe('claude-opus-4-8');
  });

  it('omitting model → the QueryFn receives params.model === undefined (SDK default)', async () => {
    const browser = fakeBrowser(INVENTORY_SNAP);
    const store = newStore();
    const { fn, model, called } = modelCapturingQuery();
    const { emit } = emitSpy();
    await runAgentGoal({ goal: 'g', sessionId: 'm2', mode: 'act', browser, store, states: [], emit, query: fn });
    expect(called()).toBe(true);
    expect(model()).toBeUndefined();
  });

  it('act mode: a goto to a new origin does NOT await approval (Act gates nothing)', async () => {
    const store = newStore();
    const browser = fakeBrowser('RootWebArea "on x" [ref=e1]');
    (browser as any).currentUrl = async () => 'https://x.test/page';
    const { fn: gotoFn } = fakeQueryCalling('goto', { url: 'https://other.test/here' });
    const { emit } = emitSpy();
    let awaited = false;
    const awaitApproval = () => { awaited = true; return Promise.resolve(false); };
    await runAgentGoal({ goal: 'g', sessionId: 'a7', mode: 'act', browser, store, states: [], emit, query: gotoFn, awaitApproval });
    expect(awaited).toBe(false);
    expect(browser.gotos).toEqual(['https://other.test/here']);
  });

  // ---- SDK conversation continuity (resume) ---------------------------------
  // A fake that CAPTURES the prompt + the `resume` param it was handed, and yields
  // a message carrying a canned session_id (mirrors the SDK's result SDKMessage).
  function continuityQuery(sessionIdToEmit: string): {
    fn: QueryFn;
    prompt: () => string;
    resume: () => string | undefined;
  } {
    let capturedPrompt = '';
    let capturedResume: string | undefined;
    const fn: QueryFn = async function* ({ prompt, resume }) {
      capturedPrompt = prompt;
      capturedResume = resume;
      yield { type: 'result', subtype: 'success', result: 'ok', session_id: sessionIdToEmit } as any;
    };
    return { fn, prompt: () => capturedPrompt, resume: () => capturedResume };
  }

  it('a FRESH run (no resumeSessionId): sends SYSTEM+goal, no resume, captures the SDK session_id', async () => {
    const browser = fakeBrowser(INVENTORY_SNAP);
    const store = newStore();
    const q = continuityQuery('sdk-abc');
    const { emit } = emitSpy();
    let captured: string | undefined;
    await runAgentGoal({
      goal: 'open reports', sessionId: 'c1', mode: 'act', browser, store, states: [], emit,
      query: q.fn, onSdkSession: (id) => { captured = id; },
    });
    expect(q.resume()).toBeUndefined();          // fresh: no resume threaded
    expect(q.prompt()).toContain('open reports'); // goal present
    expect(q.prompt()).toMatch(/RECALL FIRST/);   // SYSTEM prompt injected on turn 1
    expect(captured).toBe('sdk-abc');             // session_id captured for the next turn
  });

  it('a RESUMED run (resumeSessionId set): passes resume:<id> and sends JUST the goal (no SYSTEM re-injection)', async () => {
    const browser = fakeBrowser(INVENTORY_SNAP);
    const store = newStore();
    const q = continuityQuery('sdk-def');
    const { emit } = emitSpy();
    await runAgentGoal({
      goal: 'now open Reports', sessionId: 'c2', mode: 'act', browser, store, states: [], emit,
      query: q.fn, resumeSessionId: 'sdk-abc',
    });
    expect(q.resume()).toBe('sdk-abc');            // resume threaded to the SDK
    expect(q.prompt()).toBe('now open Reports');   // ONLY the goal — SYSTEM not re-injected
    expect(q.prompt()).not.toMatch(/RECALL FIRST/);
  });
});

// Keep ToolDef exported-type referenced so the import isn't dropped.
const _typecheck: ToolDef | undefined = undefined;
void _typecheck;
