import { adaptAXTreeWithRefs, type AXNode } from '../playwright/ax-adapter.js';
import { parseSnapshot, findByRoleAndName } from '../playwright/snapshot.js';
import type { WalkBrowser } from './walk.js';

// The extension-side channel: talks to the live tab over HTTP/SSE (real impl is a
// later task). getAX() returns the raw CDP AX tree; dispatch() performs one action.
export interface AgentChannel {
  getAX(): Promise<AXNode[]>;
  dispatch(cmd: { kind: 'click' | 'type'; nodeId: string; text?: string }): Promise<void>;
  currentUrl?(): Promise<string>;
  goto?(url: string): Promise<void>;
}

/**
 * WalkBrowser over an AgentChannel — the extension-driven counterpart to
 * makeLiveWalkBrowser (walk-live.ts), so walkRoute runs UNMODIFIED against a live
 * tab instead of a playwright-cli session.
 *
 * REF FORMAT NOTE: adaptAXTreeWithRefs assigns each node a synthetic `bN` ref
 * (settled format, tests/playwright/ax-adapter.test.ts asserts /^b\d+$/). But
 * parseSnapshot's REF_RE only matches `e\d+` (playwright-cli's own format) — a
 * literal `bN` token would round-trip as SnapNode.ref === null, and every walk-side
 * consumer (resolveStep, resolveByFingerprint) filters on `n.ref` truthy, so the
 * walk could never resolve anything. Fix: re-key each node's ref to a sequential
 * `eN` "walk ref" when serializing, and cache walkRef -> real {nodeId,
 * backendDOMNodeId} for act() to dispatch against. This is entirely internal to
 * this file — ax-adapter.ts / snapshot.ts are untouched.
 */
export function makeLiveExtensionBrowser(
  channel: AgentChannel,
  inputs: Record<string, string>,
): WalkBrowser {
  let calls = 0;
  let lastSnapshot = '';
  let refMap = new Map<string, { nodeId: string; backendDOMNodeId?: number }>();

  async function refresh(): Promise<string> {
    const ax = await channel.getAX();
    calls++;
    const { nodes, refMap: bRefMap } = adaptAXTreeWithRefs(ax);
    const walkRefMap = new Map<string, { nodeId: string; backendDOMNodeId?: number }>();
    const lines: string[] = [];
    nodes.forEach((n, i) => {
      const walkRef = 'e' + (i + 1);
      const real = bRefMap.get(n.ref!)!;   // every emitted node has a ref (ax-adapter invariant)
      walkRefMap.set(walkRef, real);
      const raw = n.ref ? n.raw.replace(`[ref=${n.ref}]`, `[ref=${walkRef}]`) : n.raw;
      lines.push(' '.repeat(n.depth) + raw);
      if (n.url) lines.push(' '.repeat(n.depth + 1) + '/url: ' + n.url);
    });
    refMap = walkRefMap;
    lastSnapshot = lines.join('\n');
    return lastSnapshot;
  }

  // Resolve a textbox ref by accessible name against the CACHED snapshot (mirrors
  // makeLiveWalkBrowser's fieldRef), refreshing once on miss.
  async function fieldRef(name: string): Promise<string> {
    let nodes = parseSnapshot(lastSnapshot);
    let node = findByRoleAndName(nodes, 'textbox', name);
    if (!node || !node.ref) {
      await refresh();
      nodes = parseSnapshot(lastSnapshot);
      node = findByRoleAndName(nodes, 'textbox', name);
    }
    if (!node || !node.ref) throw new Error('live-extension-browser: could not resolve textbox "' + name + '"');
    return node.ref;
  }

  function nodeIdFor(ref: string): string {
    const entry = refMap.get(ref);
    if (!entry) throw new Error('live-extension-browser: ref "' + ref + '" not found in the current snapshot');
    return entry.nodeId;
  }

  async function dispatchClick(ref: string): Promise<void> {
    await channel.dispatch({ kind: 'click', nodeId: nodeIdFor(ref) });
    calls++;
  }
  async function dispatchType(ref: string, text: string): Promise<void> {
    await channel.dispatch({ kind: 'type', nodeId: nodeIdFor(ref), text });
    calls++;
  }

  const browser: WalkBrowser = {
    snapshot: () => refresh(),
    callCount: () => calls,
    waitMs: (ms: number) => new Promise((r) => setTimeout(r, ms)),
    act: async (ref: string, inputSlot: string | null) => {
      // ponytail: commit-gating (hard rule #2) is walkRoute's job, not the
      // browser's — act() doesn't see the edge, so it just resolves+dispatches.
      if (inputSlot === 'credentials') {
        await dispatchType(await fieldRef('Username'), inputs.username);
        await dispatchType(await fieldRef('Password'), inputs.password);
        await dispatchClick(ref);
        return;
      }
      if (inputSlot === 'shipping') {
        await dispatchType(await fieldRef('First Name'), inputs.firstName ?? 'A');
        await dispatchType(await fieldRef('Last Name'), inputs.lastName ?? 'B');
        await dispatchType(await fieldRef('Zip/Postal Code'), inputs.zip);
        await dispatchClick(ref);
        return;
      }
      await dispatchClick(ref);
    },
    typeText: (ref: string, text: string) => dispatchType(ref, text),
  };
  if (channel.goto) {
    browser.goto = async (url: string) => { await channel.goto!(url); };
  }
  if (channel.currentUrl) {
    browser.currentUrl = () => channel.currentUrl!();
  }
  // ponytail: no reopenFresh — the extension can't reopen a fresh browser tab;
  // walkRoute already treats an absent reopenFresh as "skip the wall retry".
  return browser;
}
