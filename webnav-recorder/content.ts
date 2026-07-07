// webnav-recorder/content.ts
// Capture clicks + page-settle snapshots and hand them to the background worker,
// which does the click→settle CORRELATION. Correlation cannot live here: a real
// page-to-page navigation destroys this content-script context (a fresh copy runs
// in the new document), so any in-page variable holding the "pending click" is
// gone by the time the next page loads. The background worker survives navigation.
import { serialize, domToSNode, type SNode } from './serialize.js';

let recording = false;
chrome.storage.local.get('recording', (v) => { recording = !!v.recording; });
chrome.storage.onChanged.addListener((ch) => { if (ch.recording) recording = !!ch.recording.newValue; });

/** Build the parity snapshot + a map from each element to the synthetic eN ref
 *  serialize() will emit for it. The SNode tree comes from domToSNode (the twin's
 *  REAL role derivation: <a>→link, <button>→button, <input>→textbox); refs are
 *  numbered in the SAME pre-order serialize() uses, walking DOM and SNode tree in
 *  lockstep so refByEl[el] is exactly the ref serialize() prints for el. */
function snapshotPage(): { snap: string; refByEl: Map<Element, string> } {
  const refByEl = new Map<Element, string>();
  let c = 0;
  const number = (el: Element, node: SNode): void => {
    refByEl.set(el, `e${++c}`);
    const kids = Array.from(el.children);
    const nodeKids = node.children ?? [];
    for (let i = 0; i < kids.length; i++) number(kids[i], nodeKids[i]);
  };
  const tree = domToSNode(document.body);
  number(document.body, tree);
  return { snap: serialize(tree), refByEl };
}

// On click: snapshot the page NOW (the "from" state) and tell the background worker
// which element was clicked. Secret-field rule: domToSNode never reads an input's
// .value, so nothing typed is ever captured.
document.addEventListener('click', (e) => {
  if (!recording) return;
  const { snap, refByEl } = snapshotPage();
  const ref = refByEl.get(e.target as Element) ?? null;
  chrome.runtime.sendMessage({ type: 'click', fromUrl: location.href, fromSnapshot: snap, ref });
  // A same-page click (modal/sort/add-to-cart) won't fire `load`; send a settle
  // shortly after so background can pair it as a navigated:false step. If a real
  // navigation happens first, the new document's `load` settle wins the pairing.
  setTimeout(sendSettle, 400);
}, true);

// On page settle: snapshot the CURRENT page (the "to" state) and send it. Background
// pairs it with the most recent unpaired click.
function sendSettle(): void {
  if (!recording) return;
  chrome.runtime.sendMessage({ type: 'settled', toUrl: location.href, toSnapshot: snapshotPage().snap });
}
window.addEventListener('load', sendSettle);

// SPA (History API) navigations don't fire `load`; treat them as settles too.
addEventListener('popstate', () => setTimeout(sendSettle, 200));
for (const m of ['pushState', 'replaceState'] as const) {
  const orig = history[m];
  history[m] = function (this: History, ...args: unknown[]) {
    const r = (orig as (...a: unknown[]) => unknown).apply(this, args);
    setTimeout(sendSettle, 200);
    return r;
  } as History[typeof m];
}
