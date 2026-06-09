import ELK from 'elkjs/lib/elk.bundled.js';
import { MarkerType, type Node, type Edge } from '@xyflow/react';

export interface LayoutNode { id: string; label: string; parent?: string;
  // number of affordances this node renders (top-level) — used to ESTIMATE height
  // on the FIRST layout pass (before React Flow has measured the rendered node).
  badges?: number;
  // MEASURED size from React Flow (node.measured) — supplied on the SECOND pass so
  // ELK lays out with the true rendered dimensions (the documented two-pass: render
  // → measure → re-layout). When present these win over the badges estimate.
  w?: number;
  h?: number;
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

// Prefer the MEASURED size (two-pass) when present; else fall back to the estimate.
function nodeW(n: LayoutNode): number {
  if (n.w && n.w > 0) return n.w;
  if (n.unexplored) return UNEXPLORED_W;
  if (n.sub) return SUB_W;
  return NODE_W;
}
function nodeH(n: LayoutNode): number {
  if (n.h && n.h > 0) return n.h;
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
  const unexploredIds = new Set(allNodes.filter((n) => n.unexplored).map((n) => n.id));
  const isReal = (id: string) => !unexploredIds.has(id);

  // ── Build the FULL elk graph: every node + every edge, and let elk ROUTE. ──
  // Self edges aren't given to elk (it can't route a node→itself loop sensibly);
  // the SelfLoopEdge draws those from node geometry. Everything else is routed.
  //
  // Each real node declares TWO ports (FIXED_POS): a SOUTH source at bottom-centre
  // and a NORTH target at top-centre. So every outgoing edge leaves bottom-centre,
  // every incoming edge enters top-centre — ELK's start/end points are exact and
  // in the SAME coord space React Flow uses, so the 'step' polyline (drawn purely
  // from data.points) connects to the box with no gap. We DON'T anchor per-row
  // (that needs measured pixel-y + a two-pass render — deferred); "which affordance"
  // is read from the edge label instead.
  const routableEdges = edges2.filter((e) => e.source !== e.target && e.target != null);
  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': mode === 'clusters' ? 'RIGHT' : 'DOWN',
      // Read ELK's orthogonal edge routes (sections/bendPoints) → edges go AROUND
      // boxes (the documented way to avoid lines through nodes on a cyclic graph).
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': mode === 'clusters' ? '60' : '45',
      'elk.layered.spacing.nodeNodeBetweenLayers': '70',
      'elk.layered.spacing.edgeNodeBetweenLayers': '24',
      'elk.spacing.edgeNode': '20',
      'elk.spacing.edgeEdge': '14',
      // NETWORK_SIMPLEX minimises total weighted edge length → pulls one dominant
      // chain (the spine) into a straight line (ELK ref: best for a spine; verified).
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      // Cycle-breaking that RESPECTS model order: only true back-edges get reversed
      // for layering, the forward spine stays intact (saucedemo has 5 back-edges).
      'elk.layered.cycleBreaking.strategy': 'GREEDY_MODEL_ORDER',
      // Honor the order we feed nodes/edges (spine emitted first) for a deterministic
      // layout, as a soft constraint (doesn't force extra crossings).
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      // keep the spine a straight top-to-bottom column even with the full graph.
      ...(spine ? { 'elk.partitioning.activate': 'true' } : {}),
    },
    children: allNodes.map((n) => {
      const p = corePartition.get(n.id);
      const w = nodeW(n), h = nodeH(n);
      const opts: Record<string, string> = {};
      if (isReal(n.id)) opts['elk.portConstraints'] = 'FIXED_POS';
      if (spine && p !== undefined) opts['elk.partitioning.partition'] = String(p);
      return {
        id: n.id,
        width: w,
        height: h,
        ...(Object.keys(opts).length ? { layoutOptions: opts } : {}),
        ...(isReal(n.id)
          ? {
              ports: [
                { id: 'src_' + n.id, x: w / 2, y: h, width: 1, height: 1,
                  layoutOptions: { 'elk.port.side': 'SOUTH' } },
                { id: 'in_' + n.id, x: w / 2, y: 0, width: 1, height: 1,
                  layoutOptions: { 'elk.port.side': 'NORTH' } },
              ],
            }
          : {}),
      };
    }),
    edges: routableEdges.map((e) => ({
      id: e.id,
      sources: [isReal(e.source) ? 'src_' + e.source : e.source],
      targets: [isReal(e.target as string) ? 'in_' + (e.target as string) : (e.target as string)],
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
    else snapSpine(allNodes, edges2, corePartition, positions, routes, spine);
  } catch {
    positions = gridPositions(allNodes);
  }

  const rfNodes: Node[] = allNodes.map((n) => ({
    id: n.id,
    position: positions[n.id] ?? { x: 0, y: 0 },
    data: { label: n.label, unexplored: n.unexplored === true, sub: n.sub === true },
    type: n.unexplored ? 'unexplored' : mode === 'clusters' ? 'site' : 'state',
  }));

  // node-id -> readable label, so a hovered edge can show "from → to".
  const labelOf = new Map(allNodes.map((n) => [n.id, n.label]));

  const rfEdges: Edge[] = edges2.map((e) => {
    const dangling = e.dangling === true;
    const reveal = e.reveal === true;
    const isSelf = e.source === e.target;
    // UNIFORM edge styling — no special "core path" colour. Every navigation edge
    // is the same neutral slate; only REVEAL (opens an overlay) and DANGLING
    // (unexplored exit) stay visually distinct because they mean something different.
    const color = reveal ? '#7c3aed'
      : dangling ? '#cbd5e1'
      : e.fork ? '#c2410c'
      : '#64748b';

    // Node-level handles: bottom-centre source 'src', top-centre target 'in-top'
    // (mirror the ELK SOUTH/NORTH ports). Unexplored targets have no 'in-top'.
    const srcHandle = isReal(e.source) ? 'src' : undefined;
    const tgtHandle = isReal(e.target as string) ? 'in-top' : undefined;

    const width = reveal ? 1.6 : 1.6;
    const opacity = reveal ? 0.85 : e.fork ? 0.85 : dangling ? 0.4 : 0.85;

    return {
      id: e.id,
      source: e.source,
      target: e.target as string,
      ...(srcHandle ? { sourceHandle: srcHandle } : {}),
      ...(tgtHandle ? { targetHandle: tgtHandle } : {}),
      type: isSelf ? 'selfloop' : 'routed',
      data: {
        color,
        width,
        dashed: dangling || reveal || e.associative === true,
        dimmed: false,
        hovered: false,
        // No static label on edges (Fix: remove edge text); the from→to is still
        // surfaced on HOVER via fromLabel/toLabel.
        fromLabel: labelOf.get(e.source) ?? e.source,
        toLabel: e.target != null ? (labelOf.get(e.target as string) ?? e.target) : '?',
        // ELK-routed polyline (absolute coords) for 'step' mode.
        points: routes[e.id],
        shape: 'step' as const,
      },
      animated: e.fork,
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      style: { stroke: color, strokeWidth: width, opacity },
    };
  });
  return { nodes: rfNodes, edges: rfEdges };
}

const SPINE_GAP = 90;   // vertical gap between consecutive spine nodes

/**
 * Deterministic spine LAYOUT — pins the core path to a clean vertical column in
 * PARTITION ORDER, independent of what ELK did. ELK's placement drifts (different
 * x per node) and, worse, EXPANDING an overlay adds nodes/edges that make ELK
 * reorder the spine's y (verified: login slid below cart, boxes overlapped). So
 * we OWN the spine's geometry: stack the core nodes top-to-bottom by partition
 * index at one shared x, with gaps sized to each node's real height, and recompute
 * the core forward edges as clean vertical segments. Branches / sub-nodes / back-
 * edges keep ELK's positions + around-box routes (they hang off this fixed spine).
 */
function snapSpine(
  allNodes: LayoutNode[], edges: LayoutEdge[], corePartition: Map<string, number>,
  positions: Record<string, { x: number; y: number }>, routes: Record<string, RoutePoint[]>,
  spine: boolean,
): void {
  if (!spine || corePartition.size === 0) return;
  const byId = new Map(allNodes.map((n) => [n.id, n]));
  // spine node ids in partition order (0,1,2,…) = the flow sequence.
  const ordered = [...corePartition.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);

  // Shared column x = median of ELK's core x's (keeps the column near where ELK
  // put it relative to branches); y = sequential stack by partition.
  const xs = ordered.map((id) => positions[id]?.x ?? 0).sort((a, b) => a - b);
  const colX = xs[Math.floor(xs.length / 2)] ?? 0;
  const topY = Math.min(...ordered.map((id) => positions[id]?.y ?? 0));
  let y = Number.isFinite(topY) ? topY : 0;
  for (const id of ordered) {
    const n = byId.get(id);
    positions[id] = { x: colX, y };
    y += (n ? nodeH(n) : NODE_H_BASE) + SPINE_GAP;
  }

  // Because we MOVED the spine nodes, ELK's routes for any edge touching them are
  // now stale (that's the giant box-shaped detours wrapping the whole spine). So we
  // re-route every edge that touches a spine node:
  //   • core FORWARD edge (down the flow): a clean vertical 2-point segment.
  //   • everything else touching the spine (back-edges, overlay→spine, branch→spine):
  //     a LEFT-gutter return lane — out the left border, down/up a lane to the left
  //     of the column, into the target's left border. Orthogonal, clear of the spine.
  const onSpine = (id: string | null) => id != null && corePartition.has(id);
  const cx = (id: string) => positions[id].x + nodeW(byId.get(id)!) / 2;
  const cyTop = (id: string) => positions[id].y;
  const cyBot = (id: string) => positions[id].y + nodeH(byId.get(id)!);
  const leftMid = (id: string) => ({ x: positions[id].x, y: positions[id].y + nodeH(byId.get(id)!) / 2 });

  // Collect the spine-touching NON-forward edges so each gets its OWN return lane
  // (otherwise they'd stack on one x and overlap — the wrapping-box look).
  const returns: typeof edges = [];
  for (const e of edges) {
    if (e.target == null) continue;
    const s = e.source, t = e.target as string;
    if (!onSpine(s) && !onSpine(t)) continue;          // doesn't touch the spine → keep ELK's route
    if (!byId.get(s) || !byId.get(t) || !positions[s] || !positions[t]) continue;
    const sp = corePartition.get(s), tp = corePartition.get(t);
    if (e.core && sp !== undefined && tp !== undefined && tp > sp) {
      // forward spine edge → straight vertical, centre-bottom to centre-top.
      routes[e.id] = [{ x: cx(s), y: cyBot(s) }, { x: cx(t), y: cyTop(t) }];
    } else {
      returns.push(e);
    }
  }
  // Each return edge gets a distinct lane just LEFT of the column. Lanes hug the
  // node (start close, step out only slightly per edge) so the in/out lines
  // originate/merge near the node rather than via a far detour.
  const LANE_STEP = 16;
  returns
    .sort((a, b) => Math.abs(positions[a.source].y - positions[a.target as string].y)
      - Math.abs(positions[b.source].y - positions[b.target as string].y))
    .forEach((e, i) => {
      const a = leftMid(e.source), b = leftMid(e.target as string);
      const laneX = colX - 18 - i * LANE_STEP;
      routes[e.id] = [a, { x: laneX, y: a.y }, { x: laneX, y: b.y }, b];
    });
}

function gridPositions(nodes: LayoutNode[]): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  const cols = Math.ceil(Math.sqrt(Math.max(1, nodes.length)));
  nodes.forEach((n, i) => {
    out[n.id] = { x: (i % cols) * (NODE_W + 60), y: Math.floor(i / cols) * (nodeHeight(n.badges) + 60) };
  });
  return out;
}
