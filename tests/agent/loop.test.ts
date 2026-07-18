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
function fakeBrowser(snapshotYaml: string): WalkBrowser & { acted: Array<[string, string | null]>; gotos: string[] } {
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

  it('a type tool-call routes to the browser', async () => {
    const browser = fakeBrowser(INVENTORY_SNAP);
    const store = newStore();
    const { fn } = fakeQueryCalling('type', { ref: 'e5', text: 'hello' });
    const { emit } = emitSpy();
    await runAgentGoal({ goal: 'type it', sessionId: 's2', mode: 'act', browser, store, states: [], emit, query: fn });
    // type dispatches through the browser (a click+type on the same ref); at minimum act saw the ref.
    expect(browser.acted.length).toBeGreaterThan(0);
    expect(browser.acted.some(([ref]) => ref === 'e5')).toBe(true);
  });

  it('a goto tool-call routes to browser.goto(url)', async () => {
    const browser = fakeBrowser(INVENTORY_SNAP);
    const store = newStore();
    const { fn } = fakeQueryCalling('goto', { url: 'https://x.test/cart.html' });
    const { emit } = emitSpy();
    await runAgentGoal({ goal: 'go', sessionId: 's3', mode: 'act', browser, store, states: [], emit, query: fn });
    expect(browser.gotos).toEqual(['https://x.test/cart.html']);
  });

  it('get_page_ax returns the browser snapshot as tool text', async () => {
    const browser = fakeBrowser(INVENTORY_SNAP);
    const store = newStore();
    const { fn, toolResult } = fakeQueryCalling('get_page_ax', {});
    const { emit } = emitSpy();
    await runAgentGoal({ goal: 'look', sessionId: 's4', mode: 'ask', browser, store, states: [], emit, query: fn });
    expect(toolResult()).toContain('Add to cart');
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
    await runAgentGoal({ goal: 'reach cart', sessionId: 's5', mode: 'auto', browser, store, states, emit, query: fn });
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
    await runAgentGoal({ goal: 'reach cart', sessionId: 's6', mode: 'auto', browser, store, states, emit, query: fn });
    expect(toolResult()).toMatch(/drive manually|not on a known state|no route/i);
    // walkRoute was never entered, so the browser did no navigation actions.
    expect(browser.acted).toEqual([]);
    expect(browser.gotos).toEqual([]);
  });

  it('emits events in order: turn, then action, then done', async () => {
    const browser = fakeBrowser(INVENTORY_SNAP);
    const store = newStore();
    const { fn } = fakeQueryCalling('click', { ref: 'e2' });
    const { emit, events } = emitSpy();
    await runAgentGoal({ goal: 'go', sessionId: 's7', mode: 'act', browser, store, states: [], emit, query: fn });
    const kinds = events.map((e) => e.type);
    const turnIdx = kinds.indexOf('turn');
    const actionIdx = kinds.indexOf('action');
    const doneIdx = kinds.lastIndexOf('done');
    expect(turnIdx).toBeGreaterThanOrEqual(0);
    expect(actionIdx).toBeGreaterThan(turnIdx);
    expect(doneIdx).toBeGreaterThan(actionIdx);
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
});

// Keep ToolDef exported-type referenced so the import isn't dropped.
const _typecheck: ToolDef | undefined = undefined;
void _typecheck;
