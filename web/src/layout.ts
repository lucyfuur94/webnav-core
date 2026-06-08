import ELK from 'elkjs/lib/elk.bundled.js';
import { MarkerType, type Node, type Edge } from '@xyflow/react';

export interface LayoutNode { id: string; label: string; parent?: string;
  // number of affordance badges this node renders — used to estimate its real
  // height so elk spaces tall nodes correctly (badges wrap inside a fixed width).
  badges?: number;
}
export interface LayoutEdge {
  id: string; source: string; target: string; fork: boolean;
  // Inter-site ASSOCIATIVE edge (capability/co-use/content — "related to", not a
  // navigable link). Drawn dotted to distinguish from a real hyperlink/within-site
  // navigation. Interior edges never set this.
  associative?: boolean;
  core?: boolean;
}
export type LayoutMode = 'clusters' | 'interior';

const elk = new ELK();
// Boxes are FIXED-WIDTH (StateNode/SiteNode cap at this); height grows with the
// number of affordance badges (they wrap into rows of ~2 at this width). Feeding
// elk the REAL dimensions is what keeps edges from threading through nodes.
const NODE_W = 220;
const NODE_H_BASE = 52;          // label + role line, no badges
const BADGE_ROW_H = 20;          // each wrapped row of badges
const BADGES_PER_ROW = 2;        // ~2 chips fit per row at NODE_W
function nodeHeight(badges = 0): number {
  return NODE_H_BASE + Math.ceil(badges / BADGES_PER_ROW) * BADGE_ROW_H;
}

/** Chain the core edges into an ordered spine and return a node-id -> partition
 *  index map (login=0, inventory=1, ...). Empty if there's no core path. */
function spinePartitions(edges: LayoutEdge[]): Map<string, number> {
  const core = edges.filter((e) => e.core);
  if (core.length === 0) return new Map();
  const next = new Map(core.map((e) => [e.source, e.target]));
  const targets = new Set(core.map((e) => e.target));
  const start = core.map((e) => e.source).find((s) => !targets.has(s));
  const out = new Map<string, number>();
  let cur = start, i = 0;
  const seen = new Set<string>();
  while (cur !== undefined && !seen.has(cur)) {
    seen.add(cur); out.set(cur, i++); cur = next.get(cur);
  }
  return out;
}

/**
 * Lay out nodes/edges with ELK. `interior` = layered top-down (state machine);
 * `clusters` = layered left-right with more spacing (capability neighborhoods).
 * Pure mapping: our shapes → ELK graph → positioned xyflow nodes/edges.
 * On ANY elk failure (or if elk drops a node, e.g. duplicate id), fall back to a
 * deterministic grid so render never dies.
 */
export async function layoutGraph(
  nodes: LayoutNode[], edges: LayoutEdge[], mode: LayoutMode,
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  // Derive the CORE PATH spine: chain the core edges from their start (a core
  // `from` that is never a core `to`) and assign each spine node a consecutive
  // ELK partition, so the core journey lays out as a straight ordered column and
  // branches/back-edges hang off it. (elk partitioning: activate on the root,
  // partition index per node.)
  const corePartition = spinePartitions(edges);
  const spine = corePartition.size > 0 && mode === 'interior';
  const isCore = (id: string) => corePartition.has(id);

  // When we have a core spine: lay out ONLY the core nodes (vertical, partition-
  // ordered) via elk, then place branch nodes BESIDE their core neighbor (Task:
  // branches go to the side, not stacked above/below the spine). Otherwise lay
  // out everything normally.
  const layoutNodes = spine ? nodes.filter((n) => isCore(n.id)) : nodes;
  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': mode === 'clusters' ? 'RIGHT' : 'DOWN',
      'elk.spacing.nodeNode': mode === 'clusters' ? '80' : '70',
      'elk.layered.spacing.nodeNodeBetweenLayers': '120',
      ...(spine ? { 'elk.partitioning.activate': 'true' } : {}),
    },
    children: layoutNodes.map((n) => {
      const p = corePartition.get(n.id);
      return {
        id: n.id, width: NODE_W, height: nodeHeight(n.badges),
        ...(spine && p !== undefined ? { layoutOptions: { 'elk.partitioning.partition': String(p) } } : {}),
      };
    }),
    // Only CORE edges drive the spine layout (branches are placed by hand below).
    edges: (spine ? edges.filter((e) => e.core) : edges)
      .map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };

  let positions: Record<string, { x: number; y: number }> = {};
  try {
    const res = await elk.layout(elkGraph);
    for (const c of res.children ?? []) positions[c.id] = { x: c.x ?? 0, y: c.y ?? 0 };
    if (spine) placeBranches(nodes, edges, corePartition, positions);
    if (Object.keys(positions).length < nodes.length) positions = gridPositions(nodes);
  } catch {
    positions = gridPositions(nodes);
  }

  const rfNodes: Node[] = nodes.map((n) => ({
    id: n.id,
    position: positions[n.id] ?? { x: 0, y: 0 },
    data: { label: n.label },
    type: mode === 'clusters' ? 'site' : 'state',
  }));
  // Every edge is DIRECTED (from -> to). Curved bezier (xyflow 'default') so edges
  // bow smoothly; with branches placed to the side (placeBranches), curved edges
  // don't overlap the spine or cut through boxes.
  const rfEdges: Edge[] = edges.map((e) => {
    const core = e.core === true;
    const color = e.fork ? '#c2410c' : core ? '#1d4ed8' : '#94a3b8';
    const dashed = e.fork ? '6 4' : e.associative ? '2 4' : undefined;
    const { sourceHandle, targetHandle } = pickHandles(positions[e.source], positions[e.target]);
    return {
      id: e.id, source: e.source, target: e.target, sourceHandle, targetHandle,
      type: 'default',
      data: { fork: e.fork, core },
      animated: e.fork,
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 18, height: 18 },
      style: { stroke: color, strokeWidth: core ? 2.5 : 1, opacity: core || e.fork ? 1 : 0.55,
        ...(dashed ? { strokeDasharray: dashed } : {}) },
    };
  });
  return { nodes: rfNodes, edges: rfEdges };
}

/** Choose which handles an edge connects to based on the two nodes' relative
 *  position: side-by-side (horizontal gap dominates) → use right/left so the edge
 *  is a clean horizontal arc; otherwise → bottom/top for the vertical spine.
 *  Handle ids match StateNode's: source `s-{t,b,l,r}`, target `t-{t,b,l,r}`. */
function pickHandles(a?: { x: number; y: number }, b?: { x: number; y: number }):
  { sourceHandle?: string; targetHandle?: string } {
  if (!a || !b) return {};
  const dx = b.x - a.x, dy = b.y - a.y;
  if (Math.abs(dx) > Math.abs(dy)) {
    // horizontal: leave the right/left side toward the target, enter the opposite side
    return dx >= 0
      ? { sourceHandle: 's-r', targetHandle: 't-l' }
      : { sourceHandle: 's-l', targetHandle: 't-r' };
  }
  // vertical: down → leave bottom enter top; up → leave top enter bottom
  return dy >= 0
    ? { sourceHandle: 's-b', targetHandle: 't-t' }
    : { sourceHandle: 's-t', targetHandle: 't-b' };
}

/** Place each non-core (branch) node BESIDE its nearest core neighbor: to the
 *  right of that core node, at the same y. Alternates right/left and stacks
 *  multiple branches of the same core node so they don't collide. Mutates
 *  `positions` (which already holds the elk-laid-out core spine). */
function placeBranches(
  nodes: LayoutNode[], edges: LayoutEdge[], corePartition: Map<string, number>,
  positions: Record<string, { x: number; y: number }>,
): void {
  const isCore = (id: string) => corePartition.has(id);
  const GAP = NODE_W + 90;            // horizontal distance from the spine
  const usedSidesByCore = new Map<string, number>();   // how many branches placed per core node
  for (const n of nodes) {
    if (isCore(n.id) || positions[n.id]) continue;
    // find a core neighbor (edge in either direction to a core node)
    const e = edges.find((x) => (x.source === n.id && isCore(x.target)) || (x.target === n.id && isCore(x.source)));
    const coreId = e ? (isCore(e.target) ? e.target : e.source) : undefined;
    const base = coreId ? positions[coreId] : undefined;
    if (!base) continue;
    const k = usedSidesByCore.get(coreId!) ?? 0;
    usedSidesByCore.set(coreId!, k + 1);
    // first branch to the right, second to the left, then stack further out
    const side = k % 2 === 0 ? 1 : -1;
    const ring = Math.floor(k / 2) + 1;
    positions[n.id] = { x: base.x + side * GAP * ring, y: base.y };
  }
}

function gridPositions(nodes: LayoutNode[]): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  const cols = Math.ceil(Math.sqrt(Math.max(1, nodes.length)));
  nodes.forEach((n, i) => {
    out[n.id] = { x: (i % cols) * (NODE_W + 60), y: Math.floor(i / cols) * (nodeHeight(n.badges) + 60) };
  });
  return out;
}
