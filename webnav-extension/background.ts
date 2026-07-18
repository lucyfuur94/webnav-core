// webnav-extension/background.ts
// Increment B: the sensor is chrome.debugger's CDP `Accessibility.getFullAXTree` — a
// content script cannot call CDP, so this must run in the background service worker.
// The extension stays DUMB (no adaptAXTree, no fingerprinting here): it POSTs raw AX
// node arrays to the server's /ingest-ax, which reconstructs fingerprints + diffs with
// tested code (src/recorder/ingest.ts). This replaces the old click→settle DOM-walk
// correlation — Increment B's testable goal is a single "Capture this page" action,
// not the full record loop (deferred).

type AXNode = Record<string, unknown>;

async function captureTabAX(tabId: number): Promise<{ url: string; nodes: AXNode[] }> {
  await chrome.debugger.attach({ tabId }, '1.3');
  try {
    await chrome.debugger.sendCommand({ tabId }, 'Accessibility.enable');
    const result = await chrome.debugger.sendCommand({ tabId }, 'Accessibility.getFullAXTree');
    const tab = await chrome.tabs.get(tabId);
    return { url: tab.url ?? '', nodes: (result as { nodes: AXNode[] }).nodes };
  } finally {
    // ALWAYS detach — left attached, the yellow "debugging this browser" banner sticks.
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type !== 'capture') return false;
  (async () => {
    try {
      const { url, nodes } = await captureTabAX(msg.tabId);
      // A landing-only observation: fromAX/fromUrl empty + clickedRef null tell the
      // server this is a pure fresh landing, not a click→settle pair.
      const body = {
        sessionId: msg.sessionId,
        steps: [{ fromUrl: '', fromAX: [], toUrl: url, toAX: nodes, clickedRef: null }],
      };
      const res = await fetch(msg.ingestUrl, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await res.json();
      reply(j);
    } catch (e) {
      reply({ ok: false, error: String(e) });
    }
  })();
  return true; // async reply
});
