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
    const a = Math.sign(reciprocalOffset) * Math.min(140, Math.max(34, lenc * 0.14));
    const sp = affAnchor ?? intersect(sRect, { x: tCenter.x + px * a, y: tCenter.y + py * a });
    const tp = intersect(tRect, { x: sCenter.x + px * a, y: sCenter.y + py * a });
    const midX = (sp.x + tp.x) / 2 + px * a * 1.7;
    const midY = (sp.y + tp.y) / 2 + py * a * 1.7;
    path = `M ${sp.x},${sp.y} Q ${midX},${midY} ${tp.x},${tp.y}`;
    const baseX = 0.25 * sp.x + 0.5 * midX + 0.25 * tp.x;
    const baseY = 0.25 * sp.y + 0.5 * midY + 0.25 * tp.y;
    const labelPush = Math.sign(a) * 16;
    labelX = baseX + px * labelPush;
    labelY = baseY + py * labelPush;
  } else {
    const sp = affAnchor ?? intersect(sRect, tCenter);
    const tp = intersect(tRect, affAnchor ?? sCenter);
    const [p, lx, ly] = getBezierPath({
      sourceX: sp.x,
      sourceY: sp.y,
      targetX: tp.x,
      targetY: tp.y,
      sourcePosition: affAnchor ? Position.Right : sideOf(sRect, tCenter),
      targetPosition: sideOf(tRect, affAnchor ?? sCenter),
      curvature: d.curvature ?? 0.25,
    });
    path = p;
    labelX = lx;
    labelY = ly;
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
