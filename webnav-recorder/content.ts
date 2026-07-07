// webnav-recorder/content.ts
import { serialize, domToSNode, type SNode } from './serialize.js';

let recording = false;
chrome.storage.local.get('recording', (v) => { recording = !!v.recording; });
chrome.storage.onChanged.addListener((ch) => { if (ch.recording) recording = !!ch.recording.newValue; });

function isSecret(el: Element): boolean {
  if (!(el instanceof HTMLInputElement)) return false;
  return el.type === 'password' || /^cc-|cc-number|cc-csc/.test(el.autocomplete || '');
}
function fromSnapshot(): { snap: string; refByEl: Map<Element, string> } {
  // serialize the page and remember which ref maps to which element, so a click
  // can report the synthetic ref of the exact node clicked.
  const refByEl = new Map<Element, string>();
  let c = 0;
  const walk = (el: Element): SNode => {
    const ref = `e${++c}`; refByEl.set(el, ref);
    const role = el.getAttribute('role') || (el.tagName.toLowerCase() === 'body' ? 'RootWebArea' : 'generic');
    const name = el.getAttribute('aria-label') || (el.textContent || '').trim() || null;
    const url = el instanceof HTMLAnchorElement ? el.href : null;
    return { role, name, url, children: Array.from(el.children).map(walk) };
  };
  const tree = walk(document.body);
  return { snap: serialize(tree), refByEl };
}

let pending: { fromUrl: string; snap: string; ref: string | null } | null = null;

document.addEventListener('click', (e) => {
  if (!recording) return;
  const { snap, refByEl } = fromSnapshot();
  const el = e.target as Element;
  // never capture the typed value of a secret field; the fingerprint of the field is fine
  pending = { fromUrl: location.href, snap, ref: refByEl.get(el) ?? null };
}, true);

// after navigation settles, emit the RawStep for the click that caused it
window.addEventListener('load', () => {
  if (!recording || !pending) return;
  const step = {
    fromUrl: pending.fromUrl, fromSnapshot: pending.snap,
    toUrl: location.href, toSnapshot: fromSnapshot().snap,
    navigated: pending.fromUrl !== location.href, ref: pending.ref,
  };
  chrome.runtime.sendMessage({ type: 'step', step });
  pending = null;
});
