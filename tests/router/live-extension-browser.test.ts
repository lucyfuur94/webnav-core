import { describe, it, expect } from 'vitest';
import { makeLiveExtensionBrowser, type AgentChannel } from '../../src/router/live-extension-browser.js';
import { parseSnapshot } from '../../src/playwright/snapshot.js';
import type { AXNode } from '../../src/playwright/ax-adapter.js';

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
