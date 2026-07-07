// webnav-recorder/content.ts
// SELF-CONTAINED (no imports): a classic MV3 content script CANNOT use ES `import`
// (it throws "Cannot use import statement" and never registers its listeners — which
// silently breaks all capture). So the serializer twin is INLINED here. It must stay
// in sync with src/recorder/snapshot-dom.ts (the in-repo oracle) — a byte-equivalence
// test guards that.
//
// Capture clicks + page-settle snapshots and hand them to the background worker, which
// does the click→settle CORRELATION. Correlation cannot live here: a real page-to-page
// navigation destroys this content-script context (a fresh copy runs in the new
// document), so any variable holding the "pending click" is gone by the next page.

interface SNode { role: string; name: string | null; url?: string | null; children?: SNode[] }

// TWIN of src/recorder/snapshot-dom.ts::serializeSnapshot — MUST stay in sync.
function serialize(root: SNode): string {
  const lines: string[] = []; let c = 0;
  const walk = (n: SNode, d: number) => {
    const ref = `e${++c}`, ind = '  '.repeat(d);
    lines.push(`${ind}${n.role}${n.name !== null ? ` "${n.name}"` : ''} [ref=${ref}]`);
    if (n.url) lines.push(`${ind}  /url: ${n.url}`);
    for (const ch of n.children ?? []) walk(ch, d + 1);
  };
  walk(root, 0); return lines.join('\n');
}
function implicitRole(el: Element): string {
  const t = el.tagName.toLowerCase();
  const map: Record<string, string> = { a: 'link', button: 'button', input: 'textbox',
    h1: 'heading', h2: 'heading', h3: 'heading', nav: 'navigation', main: 'main', body: 'RootWebArea' };
  return map[t] ?? 'generic';
}
function accessibleName(el: Element): string | null {
  const aria = el.getAttribute('aria-label'); if (aria) return aria;
  const txt = (el.textContent || '').trim(); return txt || null;
}
// Secret-field rule: NEVER read an input's .value. domToSNode reads role/name/href only.
function domToSNode(el: Element): SNode {
  return {
    role: el.getAttribute('role') || implicitRole(el),
    name: accessibleName(el),
    url: el instanceof HTMLAnchorElement ? el.href : null,
    children: Array.from(el.children).map(domToSNode),
  };
}

let recording = false;
chrome.storage.local.get('recording', (v) => { recording = !!v.recording; });
chrome.storage.onChanged.addListener((ch) => { if (ch.recording) recording = !!ch.recording.newValue; });

/** Build the parity snapshot + a map from each element to the synthetic eN ref
 *  serialize() emits for it. Refs are numbered in the SAME pre-order serialize()
 *  uses, walking DOM and SNode tree in lockstep so refByEl[el] is exactly that ref. */
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

// On click: snapshot the "from" state and tell background which element was clicked.
document.addEventListener('click', (e) => {
  if (!recording) return;
  const { snap, refByEl } = snapshotPage();
  const ref = refByEl.get(e.target as Element) ?? null;
  chrome.runtime.sendMessage({ type: 'click', fromUrl: location.href, fromSnapshot: snap, ref });
  // A same-page click (modal/sort/add-to-cart) won't fire `load`; send a settle
  // shortly after so background pairs it as a navigated:false step. If a real
  // navigation happens first, the new document's `load` settle wins the pairing.
  setTimeout(sendSettle, 400);
}, true);

// On page settle: snapshot the "to" state; background pairs it with the last click.
function sendSettle(): void {
  if (!recording) return;
  chrome.runtime.sendMessage({ type: 'settled', toUrl: location.href, toSnapshot: snapshotPage().snap });
}
// Fire once shortly after injection too, so the first page after Record establishes a
// baseline even though its `load` already passed.
if (document.readyState === 'complete') setTimeout(sendSettle, 100);
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
