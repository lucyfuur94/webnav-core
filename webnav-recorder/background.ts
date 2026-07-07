// webnav-recorder/background.ts
// Owns the click→settle CORRELATION and the step buffer. Both live in
// chrome.storage.session (NOT module variables): a service worker can be evicted
// between events, and a page navigation runs a fresh content script — only
// storage survives both. A `click` records the "from" state + clicked ref; the
// next `settled` pairs with it into one RawStep (navigated is recomputed
// server-side by `dev ingest`, so we don't send it).
type Pending = { fromUrl: string; fromSnapshot: string; ref: string | null } | null;
type RawStep = { fromUrl: string; fromSnapshot: string; toUrl: string; toSnapshot: string; ref: string | null };

async function get<T>(key: string, fallback: T): Promise<T> {
  const v = await chrome.storage.session.get(key);
  return (v[key] as T) ?? fallback;
}
const set = (obj: Record<string, unknown>) => chrome.storage.session.set(obj);

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  (async () => {
    if (msg.type === 'click') {
      // Record the pending click. If a prior click never got a settle (e.g. it did
      // nothing), it's simply overwritten — we only pair the most recent click.
      await set({ pending: { fromUrl: msg.fromUrl, fromSnapshot: msg.fromSnapshot, ref: msg.ref } as Pending });
      reply?.({ ok: true });
      return;
    }
    if (msg.type === 'settled') {
      const pending = await get<Pending>('pending', null);
      if (!pending) { reply?.({ ok: true, skipped: 'no pending click' }); return; }
      const buffer = await get<RawStep[]>('buffer', []);
      buffer.push({ fromUrl: pending.fromUrl, fromSnapshot: pending.fromSnapshot,
        toUrl: msg.toUrl, toSnapshot: msg.toSnapshot, ref: pending.ref });
      await set({ buffer, pending: null });  // clear pending so a second settle doesn't double-emit
      reply?.({ ok: true, steps: buffer.length });
      return;
    }
    if (msg.type === 'stop') {
      const buffer = await get<RawStep[]>('buffer', []);
      try {
        const res = await fetch(msg.ingestUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: msg.sessionId, steps: buffer }) });
        const j = await res.json();
        await set({ buffer: [], pending: null });
        reply?.(j);
      } catch (e) { reply?.({ ok: false, error: String(e) }); }
      return;
    }
    if (msg.type === 'reset') { await set({ buffer: [], pending: null }); reply?.({ ok: true }); }
  })();
  return true; // async reply
});
