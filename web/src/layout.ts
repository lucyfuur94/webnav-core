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
  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': mode === 'clusters' ? 'RIGHT' : 'DOWN',
      'elk.spacing.nodeNode': mode === 'clusters' ? '80' : '70',
      'elk.layered.spacing.nodeNodeBetweenLayers': '110',
      'elk.spacing.edgeNode': '30',
    },
    children: nodes.map((n) => ({ id: n.id, width: NODE_W, height: nodeHeight(n.badges) })),
    edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };

  let positions: Record<string, { x: number; y: number }> = {};
  try {
    const res = await elk.layout(elkGraph);
    for (const c of res.children ?? []) positions[c.id] = { x: c.x ?? 0, y: c.y ?? 0 };
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
  // Every edge is DIRECTED (from -> to). Give it an arrowhead so direction is
  // visible; color it to match (orange for fork edges, slate for normal).
  const rfEdges: Edge[] = edges.map((e) => {
    const core = e.core === true;
    const color = e.fork ? '#c2410c' : core ? '#1d4ed8' : '#94a3b8';
    const dashed = e.fork ? '6 4' : e.associative ? '2 4' : undefined;
    return {
      id: e.id, source: e.source, target: e.target,
      data: { fork: e.fork, core },
      animated: e.fork,
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 18, height: 18 },
      style: { stroke: color, strokeWidth: core ? 2.5 : 1, opacity: core || e.fork ? 1 : 0.55,
        ...(dashed ? { strokeDasharray: dashed } : {}) },
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
