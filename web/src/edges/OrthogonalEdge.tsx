// Orthogonal (right-angle) edges for the interior graph viewer. Replaces the old
// bezier FloatingEdge. The technique:
//  - read each node's LIVE absolute rect from the store (useInternalNode in v12)
//    so the route follows the node as it moves / measures.
//  - START at the source affordance ROW's right-edge handle (data.sourceAffordanceId)
//    when present — so the wire visibly leaves THAT row — else at the source
//    border-centre facing the target.
//  - run RIGHT into a vertical ROUTING LANE in the gutter to the right of the
//    source node, lane X = sourceRight + LANE_BASE + lane*LANE_STEP (data.lane);
//    reciprocal pairs push their lane further out (sign of data.reciprocalOffset).
//  - turn 90°, travel vertically to the target's level, turn into the target
//    border (top if target below, bottom if above, left if roughly level).
//  - emit a right-angle polyline with small rounded corners (quadratic at each
//    bend, radius ~6px), NOT a bezier S-curve.
//
// SelfLoopEdge (from===to) is a small right-side rectangular loop, same style.
import { useCallback } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  useInternalNode,
  useStore,
  type EdgeProps,
  type InternalNode,
} from '@xyflow/react';

type Rect = { x: number; y: number; width: number; height: number };
type Pt = { x: number; y: number };

const CORNER_R = 6;          // rounded-corner radius at each bend
const LANE_BASE = 16;        // first lane sits this far right of the source node
const LANE_STEP = 14;        // each subsequent lane shifts right by this much
const RECIP_PUSH = 80;       // extra gutter width for the reverse direction of a pair

function rectOf(n: InternalNode | undefined): Rect | null {
  if (!n) return null;
  const w = n.measured?.width;
  const h = n.measured?.height;
  if (w == null || h == null) return null;
  return { x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, width: w, height: h };
}

// Absolute centre of a named source handle inside a node, or null if absent.
function handleCenter(n: InternalNode | undefined, handleId: string): Pt | null {
  if (!n) return null;
  const hs = n.internals.handleBounds?.source;
  if (!hs) return null;
  const h = hs.find((x) => x.id === handleId);
  if (!h) return null;
  return {
    x: n.internals.positionAbsolute.x + h.x + h.width / 2,
    y: n.internals.positionAbsolute.y + h.y + h.height / 2,
  };
}

interface OrthogonalData {
  color?: string;
  width?: number;
  lane?: number;
  reciprocalOffset?: number;
  dashed?: boolean;
  dimmed?: boolean;
  label?: string;
  sourceAffordanceId?: string;
}

// Build a right-angle polyline through `pts` with rounded corners of radius `r`.
// Each interior vertex is replaced by a short straight run up to the corner, a
// quadratic curve around it, then continues — so the path reads as crisp 90°
// turns with softened bends rather than a wavy bezier.
function roundedPolyline(pts: Pt[], r: number): string {
  if (pts.length < 2) return '';
  if (pts.length === 2) return `M ${pts[0].x},${pts[0].y} L ${pts[1].x},${pts[1].y}`;
  let d = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const next = pts[i + 1];
    // shrink the corner radius if a segment is too short to fit it
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y) || 1;
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y) || 1;
    const rr = Math.min(r, inLen / 2, outLen / 2);
    const inX = cur.x - ((cur.x - prev.x) / inLen) * rr;
    const inY = cur.y - ((cur.y - prev.y) / inLen) * rr;
    const outX = cur.x + ((next.x - cur.x) / outLen) * rr;
    const outY = cur.y + ((next.y - cur.y) / outLen) * rr;
    d += ` L ${inX},${inY} Q ${cur.x},${cur.y} ${outX},${outY}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x},${last.y}`;
  return d;
}

export function OrthogonalEdge({ id, source, target, markerEnd, data }: EdgeProps): JSX.Element | null {
  const sNode = useInternalNode(source);
  const tNode = useInternalNode(target);
  // Subscribe to the store so the edge re-renders once handle bounds are measured.
  const measureTick = useStore(useCallback((s) => s.nodeLookup.get(source)?.internals.handleBounds ? 1 : 0, [source]));
  void measureTick;

  const sRect = rectOf(sNode);
  const tRect = rectOf(tNode);
  if (!sRect || !tRect) return null;

  const d = (data ?? {}) as OrthogonalData;
  const lane = d.lane ?? 0;
  const reciprocalOffset = d.reciprocalOffset ?? 0;

  // START point: the affordance row's right handle, else source border-centre on
  // the side facing the target.
  const affAnchor = d.sourceAffordanceId ? handleCenter(sNode, d.sourceAffordanceId) : null;
  const sourceRight = sRect.x + sRect.width;
  const sp: Pt = affAnchor ?? { x: sourceRight, y: sRect.y + sRect.height / 2 };

  // The vertical routing lane in the gutter right of the source node. Reciprocal
  // pairs split into separate gutters: the reverse direction (offset < 0) is pushed
  // an extra band further out so the two wires never overlap.
  const reciprocalBand = reciprocalOffset < 0 ? RECIP_PUSH : 0;
  const laneX = sourceRight + LANE_BASE + reciprocalBand + lane * LANE_STEP;

  // END point: turn into the target border. Top if target sits below the lane's
  // vertical travel, bottom if above, left if roughly level.
  const tTop = tRect.y;
  const tBottom = tRect.y + tRect.height;
  const tCenterY = tRect.y + tRect.height / 2;
  const tLeft = tRect.x;
  const tCenterX = tRect.x + tRect.width / 2;

  let tp: Pt;
  let pts: Pt[];
  const ROUGH = sRect.height / 2 + 8;   // "roughly level" band

  if (Math.abs(tCenterY - sp.y) <= ROUGH && tLeft >= laneX - 1) {
    // Target is roughly level and to the right → enter its LEFT border.
    tp = { x: tLeft, y: tCenterY };
    pts = [sp, { x: laneX, y: sp.y }, { x: laneX, y: tp.y }, tp];
  } else if (tCenterY > sp.y) {
    // Target below → travel down the lane, enter the TOP border.
    tp = { x: tCenterX, y: tTop };
    pts = [sp, { x: laneX, y: sp.y }, { x: laneX, y: tp.y }, tp];
  } else {
    // Target above → travel up the lane, enter the BOTTOM border.
    tp = { x: tCenterX, y: tBottom };
    pts = [sp, { x: laneX, y: sp.y }, { x: laneX, y: tp.y }, tp];
  }

  const path = roundedPolyline(pts, CORNER_R);

  // Label on the vertical segment of the lane (clear of the node boxes).
  const labelX = laneX;
  const labelY = (sp.y + tp.y) / 2;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: d.color,
          strokeWidth: d.dashed ? 1.4 : d.width,
          strokeDasharray: d.dashed ? '5 4' : undefined,
          opacity: d.dimmed ? 0.12 : d.dashed ? 0.7 : 1,
          fill: 'none',
          transition: 'opacity 120ms ease',
        }}
      />
      {!d.dimmed && d.label ? (
        <EdgeLabelRenderer>
          <div
            className="wn-edge-label"
            style={{
              position: 'absolute',
              transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`,
              fontSize: 9,
              fontFamily: 'sans-serif',
              background: 'rgba(248,250,252,0.9)',
              color: '#475569',
              padding: '1px 4px',
              borderRadius: 4,
              pointerEvents: 'none',
              maxWidth: 160,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {d.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

// Self-loop (from===to) as a small right-side RECTANGULAR loop: out the row's
// right handle, right into the gutter, down a bit, and back into the node's right
// border — right-angle style with rounded corners to match OrthogonalEdge.
export function SelfLoopEdge({ id, source, markerEnd, data }: EdgeProps): JSX.Element | null {
  const sNode = useInternalNode(source);
  const rect = rectOf(sNode);
  if (!rect) return null;
  const d = (data ?? {}) as OrthogonalData;
  const aff = d.sourceAffordanceId ? handleCenter(sNode, d.sourceAffordanceId) : null;

  const rightX = rect.x + rect.width;
  const startY = aff ? aff.y : rect.y + rect.height / 2;
  const lane = d.lane ?? 0;
  const laneX = rightX + LANE_BASE + lane * LANE_STEP;
  const drop = 22;                       // vertical extent of the loop
  const reentryY = startY + drop;

  // out → right to lane → down → back left into the right border.
  const pts: Pt[] = [
    { x: aff ? aff.x : rightX, y: startY },
    { x: laneX, y: startY },
    { x: laneX, y: reentryY },
    { x: rightX, y: reentryY },
  ];
  const path = roundedPolyline(pts, CORNER_R);
  const labelX = laneX + 4;
  const labelY = (startY + reentryY) / 2;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: d.color,
          strokeWidth: d.width,
          opacity: d.dimmed ? 0.12 : 1,
          fill: 'none',
          transition: 'opacity 120ms ease',
        }}
      />
      {!d.dimmed && d.label ? (
        <EdgeLabelRenderer>
          <div
            className="wn-edge-label"
            style={{
              position: 'absolute',
              transform: `translate(0,-50%) translate(${labelX}px,${labelY}px)`,
              fontSize: 9,
              fontFamily: 'sans-serif',
              background: 'rgba(248,250,252,0.9)',
              color: '#475569',
              padding: '1px 4px',
              borderRadius: 4,
              pointerEvents: 'none',
              maxWidth: 160,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            ↻ {d.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
