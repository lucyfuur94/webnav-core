// Floating edges ported from process-map's FlowEdge/SelfLoopEdge (reactflow v11)
// to @xyflow/react v12. The technique:
//  - read each node's LIVE absolute rect from the store (useInternalNode in v12,
//    not s.nodeInternals as in v11) and compute the endpoint as the intersection
//    of the center→center ray with the node border, so arrowheads land ON the
//    border, never inside the box.
//  - reciprocal pairs (a→b AND b→a) bow to OPPOSITE sides using a DIRECTION-
//    INVARIANT perpendicular (always low-id→high-id), so only the per-direction
//    offset sign decides the side (see the long comment in the reciprocal branch).
//  - SelfLoopEdge (from===to) is drawn fully OUTSIDE the node off its right edge.
//
// v12 extension for this project: an edge may carry `data.sourceAffordanceId` —
// the id of a source <Handle> sitting on a specific affordance ROW inside the
// source node. When that handle exists we anchor the edge's START at the handle's
// live screen position (so the arrow visibly leaves that row) instead of the
// border intersection. The END still lands on the target border.
import { useCallback } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getBezierPath,
  useInternalNode,
  useStore,
  type EdgeProps,
  type InternalNode,
} from '@xyflow/react';

type Rect = { x: number; y: number; width: number; height: number };
type Pt = { x: number; y: number };

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

// The point where an edge should LEAVE the source node toward `toward`, exiting
// the border SIDE that faces the target. When an affordance row is given, the
// edge keeps that row's vertical position if it exits left/right (so the arrow
// visibly leaves that row), but exits the bottom/top centre when the target is
// above/below — which keeps stacked-node edges straight instead of looping out
// the right side and back through the box.
function exitPoint(rect: Rect, toward: Pt, aff: Pt | null): { pt: Pt; side: Position } {
  const side = sideOf(rect, toward);
  const cx = rect.x + rect.width / 2;
  if (side === Position.Bottom) return { pt: { x: cx, y: rect.y + rect.height }, side };
  if (side === Position.Top) return { pt: { x: cx, y: rect.y }, side };
  // Left/Right: leave from the affordance row's Y when we have one, else centre.
  const y = aff ? aff.y : rect.y + rect.height / 2;
  const x = side === Position.Right ? rect.x + rect.width : rect.x;
  return { pt: { x, y }, side };
}

// Intersection of the line from rect center toward `target` with the rect border.
function intersect(rect: Rect, target: Pt): Pt {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const dx = target.x - cx;
  const dy = target.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const w = rect.width / 2;
  const h = rect.height / 2;
  const scale = 1 / Math.max(Math.abs(dx) / w, Math.abs(dy) / h);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

function sideOf(rect: Rect, p: Pt): Position {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  if (Math.abs(p.x - cx) > Math.abs(p.y - cy) * (rect.width / rect.height)) {
    return p.x < cx ? Position.Left : Position.Right;
  }
  return p.y < cy ? Position.Top : Position.Bottom;
}

interface FloatingData {
  color?: string;
  width?: number;
  curvature?: number;
  reciprocalOffset?: number;
  dashed?: boolean;
  dimmed?: boolean;
  label?: string;
  sourceAffordanceId?: string;
}

export function FloatingEdge({ id, source, target, markerEnd, data }: EdgeProps): JSX.Element | null {
  const sNode = useInternalNode(source);
  const tNode = useInternalNode(target);
  // Subscribe to the store so the edge re-renders once handle bounds are measured
  // (handleBounds is populated after the first node measure pass).
  const measureTick = useStore(useCallback((s) => s.nodeLookup.get(source)?.internals.handleBounds ? 1 : 0, [source]));
  void measureTick;

  const sRect = rectOf(sNode);
  const tRect = rectOf(tNode);
  if (!sRect || !tRect) return null;

  const d = (data ?? {}) as FloatingData;
  const sCenter: Pt = { x: sRect.x + sRect.width / 2, y: sRect.y + sRect.height / 2 };
  const tCenter: Pt = { x: tRect.x + tRect.width / 2, y: tRect.y + tRect.height / 2 };

  // Anchor the START at a specific affordance-row handle when one is present and
  // measured; otherwise fall back to the source-border intersection.
  const affAnchor = d.sourceAffordanceId ? handleCenter(sNode, d.sourceAffordanceId) : null;
  const reciprocalOffset: number = d.reciprocalOffset ?? 0;

  let path: string;
  let labelX: number;
  let labelY: number;

  if (reciprocalOffset !== 0) {
    // Direction-invariant perpendicular (always lower-id → higher-id). If we used
    // tCenter-sCenter, swapping source/target would flip BOTH px/py and the offset
    // sign and the two flips cancel — making both reciprocal arcs bow to the SAME
    // side (the bug). With a fixed perpendicular only the per-direction offset sign
    // decides the side, so the two directions bow to opposite sides as intended.
    const lowFirst = source < target;
    const aC = lowFirst ? sCenter : tCenter;
    const bC = lowFirst ? tCenter : sCenter;
    const dxc = bC.x - aC.x;
    const dyc = bC.y - aC.y;
    const lenc = Math.hypot(dxc, dyc) || 1;
    const px = -dyc / lenc;
    const py = dxc / lenc;
    // Gentle, capped bow so the two arcs separate WITHOUT ballooning over the boxes.
    const a = Math.sign(reciprocalOffset) * Math.min(46, Math.max(24, lenc * 0.10));
    // Endpoints sit ON the border facing the other node (shifted toward this arc's
    // side), so arrowheads land on the border and the arc never starts inside a box.
    const sp = intersect(sRect, { x: tCenter.x + px * a, y: tCenter.y + py * a });
    const tp = intersect(tRect, { x: sCenter.x + px * a, y: sCenter.y + py * a });
    // Single control point at the midpoint pushed out by `a` (not 1.7×) → a shallow,
    // even arc that clears the nodes without the old over-curl.
    const midX = (sp.x + tp.x) / 2 + px * a;
    const midY = (sp.y + tp.y) / 2 + py * a;
    path = `M ${sp.x},${sp.y} Q ${midX},${midY} ${tp.x},${tp.y}`;
    // Push each label OUTWARD along this arc's own bow side (full signed `a` + a
    // margin) so the two reciprocal labels land on opposite sides instead of
    // stacking on top of each other at the midpoint.
    const labelPush = a + Math.sign(a) * 14;
    labelX = (sp.x + tp.x) / 2 + px * labelPush;
    labelY = (sp.y + tp.y) / 2 + py * labelPush;
  } else {
    // Leave the source from the border SIDE facing the target (keeping the
    // affordance row's Y only when exiting left/right); enter the target on the
    // border facing the source. This stops the edge from cutting across the box.
    const { pt: sp, side: sSide } = exitPoint(sRect, tCenter, affAnchor);
    const tp = intersect(tRect, sp);
    const tSide = sideOf(tRect, sp);
    // STRAIGHT line when the two endpoints are essentially axis-aligned (a stacked
    // spine, or a side-by-side pair) — a curve there only adds noise.
    const dx = Math.abs(tp.x - sp.x);
    const dy = Math.abs(tp.y - sp.y);
    const aligned = dx < 8 || dy < 8;
    if (aligned) {
      path = `M ${sp.x},${sp.y} L ${tp.x},${tp.y}`;
      labelX = (sp.x + tp.x) / 2;
      labelY = (sp.y + tp.y) / 2;
    } else {
      const [p, lx, ly] = getBezierPath({
        sourceX: sp.x, sourceY: sp.y, targetX: tp.x, targetY: tp.y,
        sourcePosition: sSide, targetPosition: tSide,
        curvature: d.curvature ?? 0.2,
      });
      path = p;
      labelX = lx;
      labelY = ly;
    }
  }

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

// Self-loop drawn fully OUTSIDE the node, off its right edge. Anchored to a
// specific affordance row's handle when present, else hugging the right border.
export function SelfLoopEdge({ id, source, markerEnd, data }: EdgeProps): JSX.Element | null {
  const sNode = useInternalNode(source);
  const rect = rectOf(sNode);
  if (!rect) return null;
  const d = (data ?? {}) as FloatingData;
  const aff = d.sourceAffordanceId ? handleCenter(sNode, d.sourceAffordanceId) : null;

  const rightX = rect.x + rect.width;
  const midY = aff ? aff.y : rect.y + rect.height / 2;
  const topY = midY - 14;
  const botY = midY + 14;
  const bow = 26;
  const path = `M ${rightX} ${botY} C ${rightX + bow} ${botY + 4}, ${rightX + bow} ${topY - 4}, ${rightX} ${topY}`;
  const labelX = rightX + bow + 4;
  const labelY = midY;
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
