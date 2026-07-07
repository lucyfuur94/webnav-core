// webnav-recorder/serialize.ts
// TWIN of src/recorder/snapshot-dom.ts::serializeSnapshot — MUST stay in sync.
// Walk a captured accessibility tree → the parity snapshot text parseSnapshot reads.
export interface SNode { role: string; name: string | null; url?: string | null; children?: SNode[] }
export function serialize(root: SNode): string {
  const lines: string[] = []; let c = 0;
  const walk = (n: SNode, d: number) => {
    const ref = `e${++c}`, ind = '  '.repeat(d);
    lines.push(`${ind}${n.role}${n.name !== null ? ` "${n.name}"` : ''} [ref=${ref}]`);
    if (n.url) lines.push(`${ind}  /url: ${n.url}`);
    for (const ch of n.children ?? []) walk(ch, d + 1);
  };
  walk(root, 0); return lines.join('\n');
}
// Build an SNode tree from the live DOM. Uses ARIA role + accessible name.
// Secret-field rule: NEVER read .value of password / autocomplete=cc-*/PII inputs.
export function domToSNode(el: Element): SNode {
  const role = el.getAttribute('role') || implicitRole(el);
  const name = accessibleName(el);
  const url = el instanceof HTMLAnchorElement ? el.href : null;
  const children = Array.from(el.children).map(domToSNode);
  return { role, name, url, children };
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
