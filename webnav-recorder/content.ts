// webnav-recorder/content.ts
import { serialize, domToSNode, type SNode } from './serialize.js';

let recording = false;
chrome.storage.local.get('recording', (v) => { recording = !!v.recording; });
chrome.storage.onChanged.addListener((ch) => { if (ch.recording) recording = !!ch.recording.newValue; });

function fromSnapshot(): { snap: string; refByEl: Map<Element, string> } {
  // Build the SNode tree via domToSNode (the twin's REAL role derivation: <a>→link,
  // <button>→button, <input>→textbox — NOT a weak inline copy that flattens everything
  // to 'generic'). Then assign synthetic eN refs in the SAME pre-order serialize() uses,
  // walking DOM and SNode tree in lockstep so refByEl[clickedEl] is the ref serialize()
  // emits for it. (Secret-field rule: domToSNode never reads an input's .value.)
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
