import type { SnapNode } from './snapshot.js';

// Adapt a raw CDP `Accessibility.getFullAXTree` node list into webnav's SnapNode[]
// contract — the same shape `parseSnapshot` produces from playwright's YAML. This is
// what lets an extension (no playwright-cli, only chrome.debugger) feed the engine
// identically to playwright's producer. Promoted + hardened from the snapshot-compat
// spike (docs/superpowers/specs/2026-07-18-extension-snapshot-spike-findings.md) per
// docs/superpowers/specs/2026-07-18-extension-phase1-design.md Increment A.
export interface AXNode {
  nodeId: string;
  ignored?: boolean;
  role?: { value: string };
  name?: { value: string };
  properties?: { name: string; value: { value?: unknown } }[];
  childIds?: string[];
  parentId?: string;
  backendDOMNodeId?: number;
}

// CDP roles playwright folds away (text merged into parent names, or structural/
// presentational wrappers) or that are the document root. Dropping these makes the
// two producers structurally comparable.
//
// `option` and `MenuListPopup` are dropped deliberately, not just for parity: a native
// <select>'s options are a VALUE DOMAIN (the choices a user could pick), and the map
// stores structure, never data values (CLAUDE.md "map stores structure not values").
// Surfacing them would leak instance data into the skeleton the same way an option
// list or instance heading would.
const DROP = new Set([
  'RootWebArea', 'StaticText', 'InlineTextBox', 'LineBreak', 'none', 'presentation',
  'option', 'MenuListPopup', 'LabelText', 'Legend',
]);
// CDP role token → playwright/ARIA vocabulary. Chromium already returns ARIA-canonical
// tokens for checkbox/radio/switch/combobox/menu/menuitem/menuitemcheckbox/button —
// verified empirically against tests/fixtures/ax/rich.ax.json — so `image`→`img` is the
// only translation needed.
const ROLE_MAP: Record<string, string> = { image: 'img' };

function prop(n: AXNode, name: string): unknown {
  return n.properties?.find((p) => p.name === name)?.value?.value;
}

/** Internal walk function shared by adaptAXTree and adaptAXTreeWithRefs.
 *  Traverses the AX tree and emits SnapNode[], optionally building a refMap.
 */
function walkAXTree(
  nodes: AXNode[],
  collectRefs: boolean = false,
): { nodes: SnapNode[]; refMap: Map<string, { nodeId: string; backendDOMNodeId?: number }> | null } {
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const root = nodes.find((n) => !n.parentId) ?? nodes[0];
  const out: SnapNode[] = [];
  const refMap = collectRefs ? new Map<string, { nodeId: string; backendDOMNodeId?: number }>() : null;
  let ref = 0;

  const visit = (id: string, depth: number) => {
    const n = byId.get(id);
    if (!n) return;
    const rawRole = n.role?.value ?? '';
    const kept = !n.ignored && rawRole && !DROP.has(rawRole);
    let childDepth = depth;
    if (kept) {
      const role = ROLE_MAP[rawRole] ?? rawRole;
      const nm = (n.name?.value ?? '').trim();
      const url = prop(n, 'url');
      const bRef = 'b' + (++ref);
      out.push({
        role,
        name: nm || null,
        ref: bRef,
        url: typeof url === 'string' && url ? url : null,
        raw: `${role}${nm ? ` "${nm}"` : ''} [ref=${bRef}]`,
        depth,
      });
      if (refMap) {
        refMap.set(bRef, { nodeId: n.nodeId, backendDOMNodeId: n.backendDOMNodeId });
      }
      childDepth = depth + 1;
    }
    for (const c of n.childIds ?? []) visit(c, childDepth);
  };

  visit(root.nodeId, 0);
  return { nodes: out, refMap };
}

/** AX tree (flat, childIds-linked) → SnapNode[] in document order, depth = nesting.
 *  Every emitted node gets a synthetic ref (b1,b2,…) — playwright refs every node too,
 *  and cross-resolve compares fingerprints (role+name+near), never the ref strings. */
export function adaptAXTree(nodes: AXNode[]): SnapNode[] {
  return walkAXTree(nodes, false).nodes;
}

/** AX tree → both SnapNode[] and a Map<bN ref, {nodeId, backendDOMNodeId}> for CDP driving.
 *  The nodes are identical to adaptAXTree; the refMap enables clicking via ref. */
export function adaptAXTreeWithRefs(
  nodes: AXNode[],
): { nodes: SnapNode[]; refMap: Map<string, { nodeId: string; backendDOMNodeId?: number }> } {
  const result = walkAXTree(nodes, true);
  return {
    nodes: result.nodes,
    refMap: result.refMap!,
  };
}
