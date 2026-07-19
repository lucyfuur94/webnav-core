// webnav-extension/background.ts
// The sidePanel's DRIVE job over a PERSISTENT chrome.debugger attach (CDP `1.3`): the
// sidePanel attaches once per run; the agent loop (server-side) streams `action`
// commands over SSE, the panel forwards each here, and we execute it via CDP
// (get-ax / click / type / goto / current-url). We DO NOT detach per command — the
// yellow "debugging this browser" banner persists for the session by design. A zombie
// attach is the failure mode, so we detach on every teardown path.
// The extension stays DUMB: it ships raw AX node arrays and dispatches raw CDP input;
// all reasoning (adaptAXTree, fingerprints, ranking) lives server-side.
// (The Phase-1 "Capture this page" popup + its `capture` message were removed — the
// toolbar icon opens the side panel now, and nothing sent that message anymore.)

type AXNode = {
  nodeId: string;
  backendDOMNodeId?: number;
  [k: string]: unknown;
};

// ---------------------------------------------------------------------------
// Persistent driving session.
// ---------------------------------------------------------------------------
// Exactly one driven tab at a time (one panel, one run). The AX tree from the last
// get-ax is cached so a click/type command (which arrives carrying an AX `nodeId`) can
// resolve nodeId → backendDOMNodeId → box model without re-fetching the whole tree.
let driveTabId: number | null = null;
let lastAxByNodeId: Map<string, AXNode> = new Map();

async function detachDrive(): Promise<void> {
  if (driveTabId == null) return;
  const id = driveTabId;
  driveTabId = null;
  lastAxByNodeId = new Map();
  await chrome.debugger.detach({ tabId: id }).catch(() => {});
}

async function attachDrive(tabId: number): Promise<void> {
  // Re-attaching to the same tab is a no-op; switching tabs detaches the old one first.
  if (driveTabId === tabId) return;
  await detachDrive();
  await chrome.debugger.attach({ tabId }, '1.3');
  driveTabId = tabId;
  await chrome.debugger.sendCommand({ tabId }, 'Accessibility.enable');
  await chrome.debugger.sendCommand({ tabId }, 'DOM.enable');
}

function assertDriving(tabId: number): void {
  if (driveTabId !== tabId) {
    throw new Error(`drive session not attached to tab ${tabId} (attached: ${driveTabId})`);
  }
}

// A cross-origin navigation commits a NEW renderer; for a brief window right after, the
// chrome.debugger session is transiently unavailable and a sendCommand rejects with a
// "detached"/"not attached"/"target closed"-class error. That's not real drift — the tab
// and the agent's nodeId are still valid — so RE-ATTACH once and retry the command ONCE.
// Bounded single retry (no loop). A genuine element-not-found/stale-node error is NOT in
// this class and is NOT retried — that's the agent's job to re-resolve (see nodeCenter).
function isDetachClassError(e: unknown): boolean {
  const m = String((e as { message?: unknown })?.message ?? e).toLowerCase();
  return m.includes('detached') || m.includes('not attached') ||
    m.includes('target closed') || m.includes('cannot access') ||
    m.includes('no target with given id') || m.includes('debugger is not attached') ||
    // assertDriving's own message after chrome.debugger.onDetach cleared driveTabId.
    m.includes('drive session not attached');
}

async function withReattach<T>(tabId: number, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!isDetachClassError(e)) throw e; // real error (stale-node etc.) → let the agent re-resolve
    // Transient CDP window after a cross-origin nav: re-attach to the same tab, retry once.
    driveTabId = null; // force attachDrive to re-run the enable dance (skip the no-op guard)
    lastAxByNodeId = new Map();
    await attachDrive(tabId);
    // TODO(user-gated): only a real cross-origin nav exercises this transient window;
    // confirm the single re-attach+retry actually recovers a click issued mid-nav.
    return await fn();
  }
}

async function getAX(tabId: number): Promise<AXNode[]> {
  assertDriving(tabId);
  const result = await chrome.debugger.sendCommand({ tabId }, 'Accessibility.getFullAXTree');
  const nodes = (result as { nodes: AXNode[] }).nodes;
  lastAxByNodeId = new Map(nodes.map((n) => [n.nodeId, n]));
  return nodes;
}

// CDP call chain for a click, given an AX-tree `nodeId` (the server sends this — it is
// the same id we returned from get-ax):
//   1. AX nodeId → cached AXNode → backendDOMNodeId (a DOM backend node id).
//   2. DOM.getBoxModel({ backendNodeId }) → the `content` quad [x1,y1,x2,y2,x3,y3,x4,y4].
//   3. quad centre = mean of its 4 corners.
//   4. Input.dispatchMouseEvent mousePressed + mouseReleased at (x,y), left button, 1 click.
async function nodeCenter(tabId: number, nodeId: string): Promise<{ x: number; y: number }> {
  const ax = lastAxByNodeId.get(nodeId);
  const backendNodeId = ax?.backendDOMNodeId;
  if (backendNodeId == null) {
    // STALE NODE — honest error, no fake recovery. AX nodeIds are EPHEMERAL: every
    // getFullAXTree mints brand-new ids, so re-fetching the tree and re-finding this OLD
    // id would ALWAYS miss (the old id no longer exists). The real contract: a nodeId not
    // in the current cached snapshot means the page re-rendered since the agent last read
    // it — the exec-command handler replies {ok:false,error}, the panel POSTs an error
    // command-result, the tool returns the error, and the AGENT re-calls get_page_ax and
    // re-resolves by fingerprint (the loop already does this on a failed action). We must
    // NOT silently click a wrong element by guessing a substitute.
    throw new Error(`stale-node: AX nodeId ${nodeId} not in current snapshot — re-snapshot needed`);
  }
  return boxCenter(tabId, backendNodeId);
}

async function boxCenter(tabId: number, backendNodeId: number): Promise<{ x: number; y: number }> {
  const box = (await chrome.debugger.sendCommand(
    { tabId }, 'DOM.getBoxModel', { backendNodeId },
  )) as { model?: { content: number[] } };
  const quad = box.model?.content;
  if (!quad || quad.length < 8) throw new Error(`no box model for backend node ${backendNodeId}`);
  const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
  const y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
  return { x, y };
}

// On-page highlight pulse — shows the user WHERE the agent just acted (Claude-for-Chrome
// has no such indicator). Reuses the {x,y} already computed for the click/type — zero
// extra CDP round-trip. Injected as a single self-removing div via Runtime.evaluate:
// ponytail: an injected div is simpler than the Overlay domain (would need Overlay.enable
// + a separate highlight-config dance on the same attach); a div is one call, self-cleans,
// and can't outlive the page since it removes itself.
// A highlight failure must NEVER break the actual click/type — always wrapped, always
// fire-and-forget (not awaited by the caller's critical path).
function paintPulse(tabId: number, x: number, y: number): void {
  const expr = `(() => {
    try {
      const d = document.createElement('div');
      d.style.cssText = 'position:fixed;left:${x}px;top:${y}px;width:24px;height:24px;' +
        'margin-left:-12px;margin-top:-12px;border-radius:50%;background:rgba(74,124,255,0.55);' +
        'border:2px solid rgba(74,124,255,0.9);pointer-events:none;z-index:2147483647;' +
        'transform:scale(0.4);opacity:1;transition:transform 600ms ease-out,opacity 600ms ease-out;';
      document.documentElement.appendChild(d);
      requestAnimationFrame(() => { d.style.transform = 'scale(1.8)'; d.style.opacity = '0'; });
      setTimeout(() => d.remove(), 650);
    } catch (e) {}
  })()`;
  // Fire-and-forget: never await this on the click/type path, never throw past it.
  // TODO(user-gated): confirm the pulse actually renders above real page content (a
  // page with its own extreme z-index or a strict CSP could theoretically block it).
  chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', { expression: expr }).catch(() => {});
}

async function clickNode(tabId: number, nodeId: string): Promise<void> {
  assertDriving(tabId);
  const { x, y } = await nodeCenter(tabId, nodeId);
  const base = { x, y, button: 'left' as const, clickCount: 1 };
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
  // Paint AFTER dispatch (never before) so the pulse can't intercept the real click; it's
  // also pointer-events:none, so it wouldn't block input even if it landed first.
  paintPulse(tabId, x, y);
}

async function typeNode(tabId: number, nodeId: string, text: string): Promise<void> {
  assertDriving(tabId);
  // Focus by clicking the field first (reliable across widgets), then insert text.
  // Input.insertText is the simplest reliable CDP text entry — it fires the same input
  // events a paste would, which every framework's controlled input handles.
  await clickNode(tabId, nodeId);
  await chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text });
}

// Navigate the driven tab and WAIT until it finishes loading before returning — the
// agent's next get-ax must read the settled destination, not the pre-navigation page.
// ponytail: chrome.tabs.onUpdated 'complete' is the native load signal; no CDP
// Page.frameStoppedLoading dance needed. 15s ceiling so a hung load can't wedge the loop.
function gotoTab(tabId: number, url: string, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err?: Error): void => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      err ? reject(err) : resolve();
    };
    const onUpdated = (updatedTabId: number, changeInfo: chrome.tabs.OnUpdatedInfo): void => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') finish();
    };
    const timer = setTimeout(() => finish(new Error(`goto "${url}" did not finish loading within ${timeoutMs}ms`)), timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.update(tabId, { url }).catch((e) => finish(e instanceof Error ? e : new Error(String(e))));
  });
}

// ---------------------------------------------------------------------------
// Teardown listeners — a zombie attach is THE failure mode; detach on every path.
// ---------------------------------------------------------------------------
chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId != null && source.tabId === driveTabId) {
    driveTabId = null;
    lastAxByNodeId = new Map();
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === driveTabId) { driveTabId = null; lastAxByNodeId = new Map(); }
});

// The panel opens a long-lived port at load (see sidepanel.ts) purely so we can detect
// panel close/reload: onDisconnect fires when the panel document goes away, whether or
// not Stop was clicked. This is the safety net for the zombie-attach failure mode — Stop's
// explicit detach-drive still fires immediately; this just catches the ungraceful case.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'webnav-panel') return;
  port.onDisconnect.addListener(() => { detachDrive().catch(() => {}); });
});

// Clicking the toolbar icon opens the SIDE PANEL directly (no popup) — the Claude-extension
// behavior. setPanelBehavior makes the action-icon click a valid user gesture for the panel.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// The command whose suggested key is Cmd+E / Ctrl+E. onCommand is a user gesture, which
// sidePanel.open requires. Open the panel for the command's window.
chrome.commands.onCommand.addListener((command) => {
  if (command !== 'toggle-panel') return;
  chrome.windows.getCurrent().then((w) => {
    if (w.id != null) chrome.sidePanel.open({ windowId: w.id }).catch(() => {});
  });
});

// ---------------------------------------------------------------------------
// Message router.
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'attach-drive') {
    (async () => {
      try { await attachDrive(msg.tabId); reply({ ok: true }); }
      catch (e) { reply({ ok: false, error: String(e) }); }
    })();
    return true;
  }

  if (msg.type === 'detach-drive') {
    (async () => { await detachDrive(); reply({ ok: true }); })();
    return true;
  }

  // Execute one agent command via the persistent session; reply the result the panel
  // POSTs back to /api/agent/command-result. get-ax → raw AXNode[]; click/type → {ok}.
  if (msg.type === 'exec-command') {
    (async () => {
      const cmd = msg.cmd as { kind: string; nodeId?: string; text?: string; url?: string };
      try {
        // withReattach: recover the transient post-cross-origin-nav CDP detach window
        // (re-attach once, retry once); a stale-node/element error is NOT retried.
        if (cmd.kind === 'get-ax') {
          reply({ ok: true, result: await withReattach(msg.tabId, () => getAX(msg.tabId)) });
        } else if (cmd.kind === 'click') {
          await withReattach(msg.tabId, () => clickNode(msg.tabId, cmd.nodeId!));
          reply({ ok: true, result: { ok: true } });
        } else if (cmd.kind === 'type') {
          await withReattach(msg.tabId, () => typeNode(msg.tabId, cmd.nodeId!, cmd.text ?? ''));
          reply({ ok: true, result: { ok: true } });
        } else if (cmd.kind === 'goto') {
          // goto/current-url act on the driven tab itself (not an AX node), so they
          // need the attached tab, not msg.tabId's node cache.
          if (driveTabId == null) throw new Error('no attached tab to navigate');
          await gotoTab(driveTabId, cmd.url!);
          reply({ ok: true, result: { ok: true } });
        } else if (cmd.kind === 'current-url') {
          if (driveTabId == null) throw new Error('no attached tab');
          const t = await chrome.tabs.get(driveTabId);
          reply({ ok: true, result: t.url });
        } else {
          reply({ ok: false, error: `unknown command kind: ${cmd.kind}` });
        }
      } catch (e) {
        // Reply ok:false so the panel can POST an error result and the loop unblocks.
        reply({ ok: false, error: String(e), result: { ok: false, error: String(e) } });
      }
    })();
    return true;
  }

  return false;
});
