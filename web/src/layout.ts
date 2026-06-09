import ELK from 'elkjs/lib/elk.bundled.js';
import { MarkerType, type Node, type Edge } from '@xyflow/react';

export interface LayoutNode { id: string; label: string; parent?: string;
  // number of affordances this node renders (top-level) — used to estimate its
  // real height so elk spaces tall nodes correctly. Reveal children add a little.
  badges?: number;
  // a synthetic "?" pill standing in for an unexplored (dangling) edge target.
  unexplored?: boolean;
}
export interface LayoutEdge {
  id: string; source: string; target: string | null; fork: boolean;
  // Inter-site ASSOCIATIVE edge (capability/co-use/content — "related to", not a
  // navigable link). Interior edges never set this.
  associative?: boolean;
  core?: boolean;
  // The affordance id that triggers this transition (for anchoring the arrow to a
  // specific affordance ROW). Synthetic via ids look like 'edge:...' — for those
  // we anchor to the node, not a row.
  viaAffordance?: string;
  // Explored-but-unmapped exit (server gives to===null + dangling:true).
  dangling?: boolean;
  // optional human label drawn on the edge.
  label?: string;
}
export type LayoutMode = 'clusters' | 'interior';

const elk = new ELK();
// Boxes are FIXED-WIDTH (StateNode caps at this); height grows with the number of
// affordances (each is a ~18px row plus per-kind headers). Feeding elk the REAL
// dimensions is what keeps edges from threading through nodes.
const NODE_W = 240;
const NODE_H_BASE = 58;          // title + role + signal line
const AFF_ROW_H = 18;            // each affordance row
const KIND_HEADER_H = 12;        // per non-empty kind group header (~up to 4)
function nodeHeight(badges = 0): number {
  // assume up to ~3 kind groups present on a typical state; reveal children add a
  // little expansion slack so a node that expands doesn't overlap its neighbor.
  const groups = Math.min(4, Math.max(1, Math.ceil(badges / 3)));
  return NODE_H_BASE + badges * AFF_ROW_H + groups * KIND_HEADER_H + 12;
}
const UNEXPLORED_W = 90;
const UNEXPLORED_H = 36;

/** Chain the core edges into an ordered spine and return a node-id -> partition
 *  index map (login=0, inventory=1, ...). Empty if there's no core path. */
function spinePartitions(edges: LayoutEdge[]): Map<string, number> {
  const core = edges.filter((e) => e.core && e.target);
  if (core.length === 0) return new Map();
  const next = new Map(core.map((e) => [e.source, e.target as string]));
  const targets = new Set(core.map((e) => e.target as string));
  const start = core.map((e) => e.source).find((s) => !targets.has(s));
  const out = new Map<string, number>();
  let cur: string | undefined = start;
  let i = 0;
  const seen = new Set<string>();
  while (cur !== undefined && !seen.has(cur)) {
    seen.add(cur); out.set(cur, i++); cur = next.get(cur);
  }
  return out;
}

/**
 * Lay out nodes/edges with ELK. `interior` = layered top-down (state machine);
 * `clusters` = layered left-right with more spacing.
 *
 * DANGLING edges (target===null, dangling:true) get a synthetic faded "?" target
 * node so the unexplored exit reads as "leads somewhere unmapped". Interior edges
 * are typed 'selfloop' (from===to) or 'orthogonal' (everything else); orthogonal
 * edges anchor their start at the source affordance ROW via data.sourceAffordanceId,
 * run into a per-edge vertical routing lane (data.lane = the Nth outgoing edge of
 * the source) and turn into the target border — clean right-angle wires, no arcs.
 */
export async function layoutGraph(
  nodes: LayoutNode[], edges: LayoutEdge[], mode: LayoutMode,
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  // Materialise a synthetic target node for every dangling edge, and rewrite the
  // edge to point at it. Done up-front so the rest of layout treats them uniformly.
  const synthNodes: LayoutNode[] = [];
  const edges2: LayoutEdge[] = edges.map((e) => {
    if (e.target === null || e.dangling) {
      const synthId = `unexplored:${e.id}`;
      synthNodes.push({ id: synthId, label: '?', unexplored: true });
      return { ...e, target: synthId, dangling: true };
    }
    return e;
  });
  const allNodes = [...nodes, ...synthNodes];

  const corePartition = spinePartitions(edges2);
  const spine = corePartition.size > 0 && mode === 'interior';
  const isCore = (id: string) => corePartition.has(id);

  const layoutNodes = spine ? allNodes.filter((n) => isCore(n.id)) : allNodes;
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
        id: n.id,
        width: n.unexplored ? UNEXPLORED_W : NODE_W,
        height: n.unexplored ? UNEXPLORED_H : nodeHeight(n.badges),
        ...(spine && p !== undefined ? { layoutOptions: { 'elk.partitioning.partition': String(p) } } : {}),
      };
    }),
    edges: (spine ? edges2.filter((e) => e.core) : edges2)
      .map((e) => ({ id: e.id, sources: [e.source], targets: [e.target as string] })),
  };

  let positions: Record<string, { x: number; y: number }> = {};
  try {
    const res = await elk.layout(elkGraph);
    for (const c of res.children ?? []) positions[c.id] = { x: c.x ?? 0, y: c.y ?? 0 };
    if (spine) placeBranches(allNodes, edges2, corePartition, positions);
    if (Object.keys(positions).length < allNodes.length) positions = gridPositions(allNodes);
  } catch {
    positions = gridPositions(allNodes);
  }

  const rfNodes: Node[] = allNodes.map((n) => ({
    id: n.id,
    position: positions[n.id] ?? { x: 0, y: 0 },
    data: { label: n.label, unexplored: n.unexplored === true },
    type: n.unexplored ? 'unexplored' : mode === 'clusters' ? 'site' : 'state',
  }));

  // Reciprocal pairs (a→b AND b→a): each direction routes through its OWN gutter.
  // The OrthogonalEdge reads the sign of reciprocalOffset to push the reverse
  // direction's lane further right, so the two wires run parallel, not overlapping.
  const present = new Set(edges2.map((e) => e.source + ' ' + e.target));
  const isPair = (e: LayoutEdge) => e.target != null && present.has(e.target + ' ' + e.source);

  // Lane assignment: the Nth outgoing edge of a source node gets lane N, so
  // multiple wires leaving the same node occupy distinct vertical gutters and
  // never overlap. Counted in edge order, deterministic per render.
  const laneCounter = new Map<string, number>();

  const rfEdges: Edge[] = edges2.map((e) => {
    const core = e.core === true;
    const dangling = e.dangling === true;
    const color = dangling ? '#cbd5e1' : e.fork ? '#c2410c' : core ? '#1d4ed8' : '#94a3b8';
    const isSelf = e.source === e.target;
    const pair = isPair(e);
    // Anchor to a specific affordance row only for real (non-synthetic) via ids.
    const via = e.viaAffordance;
    const sourceAffordanceId = via && !via.startsWith('edge:') ? 'aff_' + via : undefined;
    const reciprocalOffset = pair ? (e.source < (e.target as string) ? 40 : -40) : 0;
    // Nth outgoing edge of this source → lane N (distinct gutter per wire).
    const lane = laneCounter.get(e.source) ?? 0;
    laneCounter.set(e.source, lane + 1);
    return {
      id: e.id,
      source: e.source,
      target: e.target as string,
      type: isSelf ? 'selfloop' : 'orthogonal',
      data: {
        color,
        width: core || pair ? 2 : 1,
        lane,
        reciprocalOffset,
        dashed: dangling || e.associative === true,
        dimmed: false,
        sourceAffordanceId,
        label: e.label,
      },
      animated: e.fork,
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      style: {
        stroke: color,
        strokeWidth: core || pair ? 2 : 1,
        opacity: dangling ? 0.6 : core || e.fork || pair ? 1 : 0.6,
      },
    };
  });
  return { nodes: rfNodes, edges: rfEdges };
}

/** Place each non-core (branch) node BESIDE its nearest core neighbor. Mutates
 *  `positions` (which already holds the elk-laid-out core spine). */
function placeBranches(
  nodes: LayoutNode[], edges: LayoutEdge[], corePartition: Map<string, number>,
  positions: Record<string, { x: number; y: number }>,
): void {
  const isCore = (id: string) => corePartition.has(id);
  const GAP = NODE_W + 90;
  const usedSidesByCore = new Map<string, number>();
  for (const n of nodes) {
    if (isCore(n.id) || positions[n.id]) continue;
    const e = edges.find((x) =>
      (x.source === n.id && x.target != null && isCore(x.target)) ||
      (x.target === n.id && isCore(x.source)));
    const coreId = e ? (e.target != null && isCore(e.target) ? e.target : e.source) : undefined;
    const base = coreId ? positions[coreId] : undefined;
    if (!base || !coreId) continue;
    const k = usedSidesByCore.get(coreId) ?? 0;
    usedSidesByCore.set(coreId, k + 1);
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
