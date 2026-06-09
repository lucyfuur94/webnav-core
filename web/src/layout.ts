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
 * are typed 'selfloop' (from===to) or 'orthogonal' (everything else). Orthogonal
 * edges attach to specific handles the canonical React Flow way: sourceHandle =
 * 'aff_'+via (the pink affordance PORT on that row) for real vias, and targetHandle
 * = one of the node's three target handles ('in-top'/'in-left'/'in-bottom') chosen
 * by geometry so reciprocal/back edges don't coincide. React Flow computes the
 * endpoint coords from those handles and the OrthogonalEdge feeds them to
 * getSmoothStepPath (with a per-edge offset/stepPosition) — clean right-angle wires
 * whose arrowhead touches the target node, no hand-rolled lanes.
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

  // Reveal SUB-NODES are always placed BESIDE their parent (never by elk) so the
  // overlay reads as "hangs off this state". Exclude them from the elk graph in
  // every mode; position them in placeSubNodes after the main layout.
  const subIds = new Set(allNodes.filter((n) => n.sub).map((n) => n.id));
  const layoutNodes = (spine ? allNodes.filter((n) => isCore(n.id)) : allNodes)
    .filter((n) => !n.sub);
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
      // drop any edge touching a sub-node — those nodes aren't in the elk graph.
      .filter((e) => !subIds.has(e.source) && !(e.target != null && subIds.has(e.target as string)))
      .map((e) => ({ id: e.id, sources: [e.source], targets: [e.target as string] })),
  };

  let positions: Record<string, { x: number; y: number }> = {};
  try {
    const res = await elk.layout(elkGraph);
    for (const c of res.children ?? []) positions[c.id] = { x: c.x ?? 0, y: c.y ?? 0 };
    if (spine) placeBranches(allNodes, edges2, corePartition, positions);
    placeSubNodes(allNodes, positions);
    if (Object.keys(positions).length < allNodes.length) positions = gridPositions(allNodes);
  } catch {
    positions = gridPositions(allNodes);
  }

  const rfNodes: Node[] = allNodes.map((n) => ({
    id: n.id,
    position: positions[n.id] ?? { x: 0, y: 0 },
    data: { label: n.label, unexplored: n.unexplored === true, sub: n.sub === true },
    type: n.unexplored ? 'unexplored' : mode === 'clusters' ? 'site' : 'state',
  }));

  // Reciprocal pairs (a→b AND b→a) are drawn slightly thicker so both directions
  // read clearly. They no longer overlap: targetHandle is chosen by geometry below
  // so the two directions land on DIFFERENT node sides.
  const present = new Set(edges2.map((e) => e.source + ' ' + e.target));
  const isPair = (e: LayoutEdge) => e.target != null && present.has(e.target + ' ' + e.source);

  // node-id -> readable label, so a hovered edge can show "from → to".
  const labelOf = new Map(allNodes.map((n) => [n.id, n.label]));

  // Choose which TARGET handle an edge lands on, purely from post-layout geometry:
  //   source clearly ABOVE target  → 'in-top'    (normal forward / spine flow)
  //   source clearly BELOW target  → 'in-bottom' (a back-edge going UP the page)
  //   roughly level                → 'in-left'   (side-by-side / branch siblings)
  // Forward (a→b) and reverse (b→a) of a pair therefore differ in sign of (dy) and
  // get opposite handles, so smoothstep routes them on separate tracks.
  const LEVEL_BAND = 40; // |dy| below this counts as "level"
  function targetHandle(e: LayoutEdge): string {
    const s = positions[e.source];
    const t = e.target != null ? positions[e.target as string] : undefined;
    if (!s || !t) return 'in-top';
    const dy = t.y - s.y; // >0 → target below source → forward/down
    if (dy > LEVEL_BAND) return 'in-top';
    if (dy < -LEVEL_BAND) return 'in-bottom';
    return 'in-left';
  }

  // Edges that share the same (target, targetHandle) would otherwise stack on one
  // approach track. Give each a distinct stepPosition so their vertical/horizontal
  // turn happens at a different point along the run — fans them apart.
  const trackKey = (e: LayoutEdge, th: string) => (e.target as string) + '|' + th;
  const trackCount = new Map<string, number>();
  for (const e of edges2) {
    if (e.source === e.target) continue;
    const k = trackKey(e, targetHandle(e));
    trackCount.set(k, (trackCount.get(k) ?? 0) + 1);
  }
  const trackSeen = new Map<string, number>();

  // The smoothstep `offset` sets how far a wire runs out of its source before the
  // first 90° turn — i.e. WHICH vertical gutter it travels in. Two edges with the
  // SAME offset share a gutter and overlap (the inventory↔cart pair bug). So give
  // each edge a DISTINCT offset. We group by the unordered node pair so the two
  // directions of a reciprocal pair (and any parallel multi-edges between the same
  // two nodes) get pushed into clearly separate gutters.
  const OFFSET_BASE = 26;   // first gutter distance
  const OFFSET_STEP = 22;   // each extra wire between the same pair steps out further
  const pairKey = (a: string, b: string) => (a < b ? a + '|' + b : b + '|' + a);
  const pairCount = new Map<string, number>();
  for (const e of edges2) {
    if (e.source === e.target || e.target == null) continue;
    const k = pairKey(e.source, e.target as string);
    pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
  }
  const pairSeen = new Map<string, number>();

  const rfEdges: Edge[] = edges2.map((e) => {
    const core = e.core === true;
    const dangling = e.dangling === true;
    const reveal = e.reveal === true;
    const color = reveal ? '#7c3aed' : dangling ? '#cbd5e1' : e.fork ? '#c2410c' : core ? '#1d4ed8' : '#94a3b8';
    const isSelf = e.source === e.target;
    const pair = isPair(e);
    // Attach the edge's SOURCE to a specific affordance PORT (the pink rect on that
    // row) for real via ids; synthetic 'edge:*' vias use the node default.
    const via = e.viaAffordance;
    const sourceHandle = via && !via.startsWith('edge:') ? 'aff_' + via : undefined;
    const th = targetHandle(e);

    // stagger stepPosition for edges sharing this approach track, spread across the
    // run (e.g. 2 edges → 0.33 / 0.66; 1 edge → 0.5).
    const total = trackCount.get(trackKey(e, th)) ?? 1;
    const idx = trackSeen.get(trackKey(e, th)) ?? 0;
    if (!isSelf) trackSeen.set(trackKey(e, th), idx + 1);
    const stepPosition = total > 1 ? (idx + 1) / (total + 1) : 0.5;

    // Distinct gutter per edge between the same node pair → reciprocal/parallel
    // wires no longer share a vertical track (the main overlap fix).
    const pk = pairKey(e.source, (e.target as string) ?? e.id);
    const pIdx = isSelf ? 0 : (pairSeen.get(pk) ?? 0);
    if (!isSelf) pairSeen.set(pk, pIdx + 1);
    const offset = OFFSET_BASE + pIdx * OFFSET_STEP;

    return {
      id: e.id,
      source: e.source,
      target: e.target as string,
      // SOURCE = the affordance port (when known); TARGET = a geometry-chosen handle.
      ...(sourceHandle ? { sourceHandle } : {}),
      targetHandle: isSelf ? 'in-top' : th,
      type: isSelf ? 'selfloop' : 'orthogonal',
      data: {
        color,
        width: core || pair ? 2 : 1,
        dashed: dangling || reveal || e.associative === true,
        dimmed: false,
        hovered: false,
        label: e.label,
        // from/to labels surfaced on hover (Issue C).
        fromLabel: labelOf.get(e.source) ?? e.source,
        toLabel: e.target != null ? (labelOf.get(e.target as string) ?? e.target) : '?',
        // per-edge stepPosition so parallel approaches fan apart (Issue A/B).
        stepPosition,
        // per-edge gutter distance so reciprocal/parallel wires use SEPARATE
        // vertical tracks instead of overlapping (Issue A).
        offset,
      },
      animated: e.fork,
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      style: {
        stroke: color,
        strokeWidth: reveal ? 2 : core || pair ? 2 : 1,
        opacity: dangling ? 0.6 : reveal || core || e.fork || pair ? 1 : 0.6,
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

/** Place each reveal SUB-NODE just to the RIGHT of its parent state (ports are on
 *  the right, so the overlay reads as opening sideways). Stacks multiple sub-nodes
 *  of the same parent vertically. Handles nested sub-nodes by resolving parents
 *  first (a sub-node whose parent is itself a sub-node steps further right).
 *  Mutates `positions`. */
function placeSubNodes(
  nodes: LayoutNode[], positions: Record<string, { x: number; y: number }>,
): void {
  const GAP = NODE_W + 80;
  const subs = nodes.filter((n) => n.sub && n.subParent);
  const usedByParent = new Map<string, number>();
  // Resolve in dependency order so a sub-node hanging off another sub-node lands
  // after its parent has a position (a few passes suffice for shallow nesting).
  let remaining = subs.slice();
  for (let pass = 0; pass < 8 && remaining.length; pass++) {
    const next: LayoutNode[] = [];
    for (const n of remaining) {
      const base = positions[n.subParent as string];
      if (!base) { next.push(n); continue; }
      const k = usedByParent.get(n.subParent as string) ?? 0;
      usedByParent.set(n.subParent as string, k + 1);
      positions[n.id] = { x: base.x + GAP, y: base.y + k * (nodeHeight(n.badges) + 40) };
    }
    remaining = next;
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
