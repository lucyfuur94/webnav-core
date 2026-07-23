import { adaptAXTreeWithRefs, type AXNode } from '../playwright/ax-adapter.js';
import { parseSnapshot, findByRoleAndName } from '../playwright/snapshot.js';
import { snapshotsPlateaued } from './readiness.js';
import { didNavigate } from '../explorer/diff.js';
import type { RawAXStep } from '../recorder/ingest.js';
import type { WalkBrowser } from './walk.js';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// The extension-side channel: talks to the live tab over HTTP/SSE (real impl is a
// later task). getAX() returns the raw CDP AX tree; dispatch() performs one action.
export interface AgentChannel {
  getAX(): Promise<AXNode[]>;
  dispatch(cmd: { kind: 'click' | 'type'; nodeId: string; text?: string }): Promise<void>;
  currentUrl?(): Promise<string>;
  goto?(url: string): Promise<void>;
  scroll?(dy: number): Promise<void>;
}

// A LiveExtensionBrowser that also buffers the run as RawAXStep[] for ingestAX. The
// loop flushes getRecordedSteps() at run end so the run shows on the dashboard + feeds
// run-2 recall. It's a WalkBrowser with the recording accessor bolted on — the walk/agent
// use it as a plain WalkBrowser; only the flush site reads the extra method.
export interface RecordingBrowser extends WalkBrowser {
  /** All completed steps (fromAX/toAX raw, clickedRef = bN in fromAX). Finalizes any
   *  step still awaiting its post-action snapshot using the last observed AX. */
  getRecordedSteps(): RawAXStep[];
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
): RecordingBrowser {
  let calls = 0;
  let lastSnapshot = '';
  let refMap = new Map<string, { nodeId: string; backendDOMNodeId?: number }>();

  // --- recording state (all internal; snapshot()/act()/goto() behavior is unchanged) ---
  // The raw AX + eN->bN map of the CURRENT snapshot. We must keep the RAW ax (not the
  // eN-rekeyed SnapNode[]) because ingestAX re-adapts fromAX itself and looks up the
  // clicked node by its bN ref — the same ref adaptAXTreeWithRefs assigned here.
  let lastAX: AXNode[] = [];
  let lastUrl = '';
  let eToB = new Map<string, string>();
  const steps: RawAXStep[] = [];
  // A step whose action has fired but whose post-action AX isn't observed yet. The next
  // refresh() completes it (toAX = that snapshot); getRecordedSteps() finalizes any leftover.
  let pending: { fromUrl: string; fromAX: AXNode[]; clickedRef: string | null } | null = null;

  // URL is fetched only when a step actually needs it (begin/complete), never on every
  // bare snapshot — avoids an extra channel round-trip per agent read. Falls back to the
  // last known url when the channel can't report one (unit fake / test channel).
  async function url(): Promise<string> {
    return channel.currentUrl ? await channel.currentUrl() : lastUrl;
  }

  // completePending pairs `toAX` as the pending step's landing. `settled` records whether
  // refresh()'s plateau loop below confirmed the landing stopped changing (undefined =
  // legacy semantics: the caller handed an already-observed snapshot, so we don't claim a
  // verdict — beginStep's pending-flush does exactly this).
  async function completePending(toAX: AXNode[], settled?: boolean): Promise<void> {
    if (!pending) return;
    const p = pending;
    pending = null;   // clear before await so a re-entrant begin can't double-close
    // tMs = when this step's post-action snapshot landed → the ledger shows real per-step
    // times instead of the single flush-time. (Browser runtime: Date.now() is fine here.)
    steps.push({ fromUrl: p.fromUrl, fromAX: p.fromAX, toUrl: await url(), toAX, clickedRef: p.clickedRef, tMs: Date.now(), settled });
  }

  // Serialize an AX tree to comparable YAML (role/name/depth lines) for the plateau
  // comparator ONLY. Cheap on purpose: snapshotsPlateaued reads node count + role:name
  // identity tokens, so the walk-ref rekeying + refMap/eToB build (the expensive block in
  // refresh) is irrelevant here and MUST NOT run per poll — it runs exactly once, on the
  // final stable tree, inside refresh().
  function axLines(ax: AXNode[]): string {
    const { nodes } = adaptAXTreeWithRefs(ax);
    const lines: string[] = [];
    for (const n of nodes) {
      lines.push(' '.repeat(n.depth) + n.raw);
      if (n.url) lines.push(' '.repeat(n.depth + 1) + '/url: ' + n.url);
    }
    return lines.join('\n');
  }

  // Open a step for a just-fired action. fromAX/fromUrl = the last observed snapshot;
  // clickedRef = the bN in that fromAX for the eN acted on (null for a pure goto). If an
  // action was already pending (no snapshot since), close it first using the current AX
  // so we never drop a step or mis-pair two actions.
  async function beginStep(clickedRef: string | null): Promise<void> {
    if (pending) await completePending(lastAX);
    pending = { fromUrl: await url(), fromAX: lastAX, clickedRef };
  }

  async function refresh(): Promise<string> {
    // THE PITFALL (why the plateau loop lives HERE, at the top of refresh, and completePending
    // is called EXACTLY ONCE with the FINAL tree): refresh side-effects — its first getAX()
    // result used to be handed straight to completePending, closing the pending click's step
    // with WHATEVER snapshot arrived first, i.e. the un-hydrated shell. A heavy SPA renders a
    // shell (passes classifyReadiness's floor), then hydrates. So we must poll raw getAX() to a
    // plateau BEFORE completePending sees anything, and pair the STABLE tree as the landing.
    //
    // Scope: settle ONLY when a pending step exists AND it navigated (a fresh page must hydrate).
    // A same-page reveal (non-navigated pending — an overlay/menu) must NOT plateau-loop: an
    // auto-dismissing menu would lose its reveal diff to the extra polls. Bare no-pending reads
    // stay exactly ONE getAX (the agent's `snapshot` tool must not balloon). The navigated check
    // costs one extra url() round-trip, and ONLY when a pending step is open.
    let ax: AXNode[];
    let settled: boolean | undefined = undefined;
    const shouldSettle = pending !== null && didNavigate(pending.fromUrl, await url());
    if (shouldSettle) {
      // No eval capability on AgentChannel (getAX/dispatch/currentUrl/goto/scroll only), and we
      // may NOT add one — webnav-extension/background.ts is untouchable. So this is plateau
      // polling only (no DOM-quiet fast path); latency is bounded by the same budget knob the
      // core settle uses. gap/budget read at CALL time (tests/setup.ts pins them tiny).
      const gapMs = Number(process.env.WEBNAV_SETTLE_GAP_MS) || 800;
      const budgetMs = Number(process.env.WEBNAV_SETTLE_BUDGET_MS) || 10000;
      const deadline = Date.now() + budgetMs;
      ax = await channel.getAX();
      calls++;
      settled = false;
      // Poll until two successive AX trees plateau (compared on structure/identity via axLines
      // + snapshotsPlateaued), or the budget runs out (→ record the LAST tree, settled:false —
      // honest: the page never stopped changing, exactly the non-hydration posture).
      let prevYaml = axLines(ax);
      while (Date.now() < deadline) {
        await sleep(Math.min(gapMs, Math.max(0, deadline - Date.now())));
        const next = await channel.getAX();
        calls++;
        const nextYaml = axLines(next);
        if (snapshotsPlateaued(prevYaml, nextYaml)) { ax = next; settled = true; break; }
        ax = next; prevYaml = nextYaml;
      }
    } else {
      ax = await channel.getAX();
      calls++;
    }
    // A prior action was awaiting its landing — the FINAL stable snapshot is it. Called EXACTLY
    // ONCE (never inside the poll loop) so the step closes on the hydrated tree, not the shell.
    await completePending(ax, settled);
    const { nodes, refMap: bRefMap } = adaptAXTreeWithRefs(ax);
    const walkRefMap = new Map<string, { nodeId: string; backendDOMNodeId?: number }>();
    const walkEToB = new Map<string, string>();
    const lines: string[] = [];
    nodes.forEach((n, i) => {
      const walkRef = 'e' + (i + 1);
      const real = bRefMap.get(n.ref!)!;   // every emitted node has a ref (ax-adapter invariant)
      walkRefMap.set(walkRef, real);
      walkEToB.set(walkRef, n.ref!);       // retain eN -> bN so a recorded click maps to fromAX's bN
      const raw = n.ref ? n.raw.replace(`[ref=${n.ref}]`, `[ref=${walkRef}]`) : n.raw;
      lines.push(' '.repeat(n.depth) + raw);
      if (n.url) lines.push(' '.repeat(n.depth + 1) + '/url: ' + n.url);
    });
    refMap = walkRefMap;
    eToB = walkEToB;
    lastAX = ax;
    lastSnapshot = lines.join('\n');
    return lastSnapshot;
  }

  // eN (what the walk/agent acts on) -> bN (the ref indexing the RAW fromAX ingestAX
  // re-adapts). THIS is the pairing trap: recording the eN would make ingestAX's
  // fromNodes.find(n => n.ref === clickedRef) miss (adapted nodes carry bN, not eN).
  function clickedBRef(ref: string): string | null {
    return eToB.get(ref) ?? null;
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

  const browser: RecordingBrowser = {
    snapshot: () => refresh(),
    callCount: () => calls,
    waitMs: (ms: number) => new Promise((r) => setTimeout(r, ms)),
    act: async (ref: string, inputSlot: string | null) => {
      // ponytail: commit-gating (hard rule #2) is walkRoute's job, not the
      // browser's — act() doesn't see the edge, so it just resolves+dispatches.
      // RECORD the SEMANTIC clicked node (ref = the button), NOT the credential/shipping
      // pre-fills below. Resolve its bN NOW — a fieldRef miss can refresh() and rebuild
      // eToB, which would invalidate this ref's mapping.
      await beginStep(clickedBRef(ref));
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
    // A standalone type (the agent's `type` tool). Records the typed FIELD's identity
    // (role+name+fp), NEVER the text — the step carries no value (secret-safe).
    typeText: async (ref: string, text: string) => {
      await beginStep(clickedBRef(ref));
      await dispatchType(ref, text);
    },
    getRecordedSteps: () => {
      // Finalize a step whose landing was never snapshotted (run ended right after an
      // action): use its own fromAX as toAX. didNavigate('','') → false; a degenerate but
      // honest same-page effect, better than dropping the click entirely. settled:false —
      // the landing was NEVER observed, so we can't claim it plateaued (honest, not legacy).
      if (pending) { steps.push({ fromUrl: pending.fromUrl, fromAX: pending.fromAX, toUrl: pending.fromUrl, toAX: pending.fromAX, clickedRef: pending.clickedRef, tMs: Date.now(), settled: false }); pending = null; }
      return steps;
    },
  };
  if (channel.goto) {
    // A pure navigation: clickedRef = null. beginStep captures the current page as fromAX;
    // the next snapshot (or getRecordedSteps) supplies toAX.
    browser.goto = async (url: string) => { await beginStep(null); await channel.goto!(url); };
  }
  if (channel.scroll) {
    // A pure in-page reveal (no navigation, no click) — records NO step. The next
    // snapshot() naturally picks up whatever scrolled into view.
    browser.scroll = (dy: number) => channel.scroll!(dy);
  }
  if (channel.currentUrl) {
    browser.currentUrl = () => channel.currentUrl!();
  }
  // ponytail: no reopenFresh — the extension can't reopen a fresh browser tab;
  // walkRoute already treats an absent reopenFresh as "skip the wall retry".
  return browser;
}
