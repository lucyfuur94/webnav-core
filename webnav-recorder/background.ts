// webnav-recorder/background.ts
type RawStep = { fromUrl: string; fromSnapshot: string; toUrl: string; toSnapshot: string; navigated: boolean; ref: string | null };
let buffer: RawStep[] = [];

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg.type === 'step') { buffer.push(msg.step); reply?.({ ok: true }); return; }
  if (msg.type === 'stop') {
    const { sessionId, ingestUrl } = msg;
    fetch(ingestUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, steps: buffer }) })
      .then((r) => r.json()).then((j) => { buffer = []; reply?.(j); })
      .catch((e) => reply?.({ ok: false, error: String(e) }));
    return true; // async reply
  }
  if (msg.type === 'reset') { buffer = []; reply?.({ ok: true }); }
});
