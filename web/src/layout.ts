import ELK from 'elkjs/lib/elk.bundled.js';
import { MarkerType, type Node, type Edge } from '@xyflow/react';

export interface LayoutNode { id: string; label: string; parent?: string;
  // number of affordances this node renders (top-level) — used to estimate its
  // real height so elk spaces tall nodes correctly. Reveal children add a little.
  badges?: number;
  // a synthetic "?" pill standing in for an unexplored (dangling) edge target.
  unexplored?: boolean;
  // a synthetic SUB-NODE materialised by the VIEWER for a reveal affordance's
  // overlay (e.g. "burger menu open") — its options live here, not nested in the
  // parent. Placed BESIDE its parent and styled as a sub-state. Backend never
  // emits these; the data model keeps overlays as nested affordances.
  sub?: boolean;
  // for a sub-node: the id of the parent state it hangs off (so layout can place
  // it beside the parent even when no core spine exists).
  subParent?: string;
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
  // a synthetic VIEWER edge "opens the overlay": parent state → its reveal sub-node.
  // Drawn purple/dashed so it reads as "opens overlay", not "navigates away".
  reveal?: boolean;
}
export type LayoutMode = 'clusters' | 'interior';

// A routed point in absolute canvas coordinates (ELK's bend-points). The
// RoutedEdge renders a polyline through these to go AROUND node boxes.
export interface RoutePoint { x: number; y: number }

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
const SUB_W = NODE_W - 24;       // sub-nodes render slightly narrower

function nodeW(n: LayoutNode): number {
  if (n.unexplored) return UNEXPLORED_W;
  if (n.sub) return SUB_W;
  return NODE_W;
}
function nodeH(n: LayoutNode): number {
  return n.unexplored ? UNEXPLORED_H : nodeHeight(n.badges);
}

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
 * Lay out nodes/edges with ELK AND let ELK route the edges around the boxes.
 *
 * The whole graph (real states + synthesised reveal sub-nodes + synthetic
 * "unexplored" stubs) is handed to ELK's `layered` algorithm with
 * `edgeRouting: ORTHOGONAL`, so ELK places the nodes AND computes right-angle
 * edge routes that bend AROUND intervening boxes — the fix for back-edges
 * (Logout / Cancel / Back Home) that previously drew straight through node
 * boxes via smoothstep.
 *
 * The core spine (login→…→checkout-overview) is kept a clean vertical column by
 * activating ELK partitioning and giving each core node a partition index equal
 * to its spine position; branches / sub-nodes / stubs are placed by ELK around
 * the spine.
 *
 * For each edge ELK returns `sections[].startPoint / bendPoints / endPoint`
 * (absolute coords). We collect those into `data.points` and hand them to the
 * RoutedEdge, which draws a rounded polyline through them ('step' mode). The
 * 'curved'/'straight' connector shapes ignore the points and route
 * endpoint-to-endpoint (they intentionally do NOT avoid nodes). DANGLING edges
 * get a synthetic faded "?" target node so the unexplored exit reads as "leads
 * somewhere unmapped". Self edges (from===to) are typed 'selfloop'.
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

  // ── Build the FULL elk graph: every node + every edge, and let elk ROUTE. ──
  // Self edges aren't given to elk (it can't route a node→itself loop sensibly);
  // the SelfLoopEdge draws those from node geometry. Everything else is routed.
  const routableEdges = edges2.filter((e) => e.source !== e.target && e.target != null);
  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': mode === 'clusters' ? 'RIGHT' : 'DOWN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': mode === 'clusters' ? '80' : '90',
      'elk.layered.spacing.nodeNodeBetweenLayers': '140',
      'elk.layered.spacing.edgeNodeBetweenLayers': '40',
      'elk.spacing.edgeNode': '30',
      'elk.spacing.edgeEdge': '20',
      // keep the spine a straight top-to-bottom column even with the full graph.
      ...(spine ? { 'elk.partitioning.activate': 'true' } : {}),
    },
    children: allNodes.map((n) => {
      const p = corePartition.get(n.id);
      return {
        id: n.id,
        width: nodeW(n),
        height: nodeH(n),
        ...(spine && p !== undefined
          ? { layoutOptions: { 'elk.partitioning.partition': String(p) } }
          : {}),
      };
    }),
    edges: routableEdges.map((e) => ({
      id: e.id, sources: [e.source], targets: [e.target as string],
    })),
  };

  let positions: Record<string, { x: number; y: number }> = {};
  // edge id -> the absolute polyline elk routed for it (start → bends → end).
  const routes: Record<string, RoutePoint[]> = {};
  try {
    const res = await elk.layout(elkGraph);
    for (const c of res.children ?? []) positions[c.id] = { x: c.x ?? 0, y: c.y ?? 0 };
    for (const e of res.edges ?? []) {
      const sec = e.sections?.[0];
      if (!sec) continue;
      const pts: RoutePoint[] = [
        { x: sec.startPoint.x, y: sec.startPoint.y },
        ...(sec.bendPoints ?? []).map((b: { x: number; y: number }) => ({ x: b.x, y: b.y })),
        { x: sec.endPoint.x, y: sec.endPoint.y },
      ];
      routes[e.id] = pts;
    }
    // Only fall back to a full grid if ELK produced NOTHING (genuine failure).
    if (Object.keys(positions).length === 0) positions = gridPositions(allNodes);
  } catch {
    positions = gridPositions(allNodes);
  }

  const rfNodes: Node[] = allNodes.map((n) => ({
    id: n.id,
    position: positions[n.id] ?? { x: 0, y: 0 },
    data: { label: n.label, unexplored: n.unexplored === true, sub: n.sub === true },
    type: n.unexplored ? 'unexplored' : mode === 'clusters' ? 'site' : 'state',
  }));

  // Reciprocal pairs (a→b AND b→a) so both directions can be styled to read.
  const present = new Set(edges2.map((e) => e.source + ' ' + e.target));
  const isPair = (e: LayoutEdge) => e.target != null && present.has(e.target + ' ' + e.source);

  // node-id -> readable label, so a hovered edge can show "from → to".
  const labelOf = new Map(allNodes.map((n) => [n.id, n.label]));

  const rfEdges: Edge[] = edges2.map((e) => {
    const core = e.core === true;
    const dangling = e.dangling === true;
    const reveal = e.reveal === true;
    const isSelf = e.source === e.target;
    const pair = isPair(e);
    // ── Readability colour scheme (Change 3) ──
    //   core spine → bold blue; reveal → purple dashed; dangling → light grey
    //   dashed; fork → orange; everything else (back-edges) → faded grey.
    const color = reveal ? '#7c3aed'
      : dangling ? '#cbd5e1'
      : e.fork ? '#c2410c'
      : core ? '#1d4ed8'
      : '#94a3b8';

    // Attach the edge's SOURCE to a specific affordance PORT (the pink rect on that
    // row) for real via ids; synthetic 'edge:*' vias use the node default.
    const via = e.viaAffordance;
    const sourceHandle = via && !via.startsWith('edge:') ? 'aff_' + via : undefined;

    // Stroke weight + opacity: core dominates; non-core back-edges thin + faded.
    const width = core ? 2.5 : reveal ? 1.6 : dangling ? 1 : 1;
    const opacity = core ? 1
      : reveal ? 0.85
      : e.fork ? 0.8
      : dangling ? 0.45
      : 0.4;

    return {
      id: e.id,
      source: e.source,
      target: e.target as string,
      ...(sourceHandle ? { sourceHandle } : {}),
      type: isSelf ? 'selfloop' : 'routed',
      data: {
        color,
        width,
        dashed: dangling || reveal || e.associative === true,
        dimmed: false,
        hovered: false,
        label: e.label,
        core,
        // from/to labels surfaced on hover.
        fromLabel: labelOf.get(e.source) ?? e.source,
        toLabel: e.target != null ? (labelOf.get(e.target as string) ?? e.target) : '?',
        // ELK-routed polyline (absolute coords) for 'step' mode — routes around
        // boxes. Curved/straight modes ignore it and use the endpoint coords.
        points: routes[e.id],
        // connector shape, threaded from InteriorView; the edge picks the helper.
        shape: 'step' as const,
      },
      animated: e.fork,
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      style: { stroke: color, strokeWidth: width, opacity },
    };
  });
  return { nodes: rfNodes, edges: rfEdges };
}

function gridPositions(nodes: LayoutNode[]): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  const cols = Math.ceil(Math.sqrt(Math.max(1, nodes.length)));
  nodes.forEach((n, i) => {
    out[n.id] = { x: (i % cols) * (NODE_W + 60), y: Math.floor(i / cols) * (nodeHeight(n.badges) + 60) };
  });
  return out;
}
