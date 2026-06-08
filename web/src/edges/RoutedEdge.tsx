import { BaseEdge, type EdgeProps } from '@xyflow/react';

// Draws an edge along the polyline ELK routed AROUND the boxes (orthogonal
// bend-points), with lightly rounded corners — so arrows never cut through a
// node. Falls back to a straight source→target line if no route is present.
export function RoutedEdge(props: EdgeProps) {
  const { data, sourceX, sourceY, targetX, targetY, markerEnd, style } = props;
  const pts = (data as { routed?: { x: number; y: number }[] } | undefined)?.routed;

  let path: string;
  if (pts && pts.length >= 2) {
    path = roundedPolyline(pts, 8);
  } else {
    path = `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
  }
  return <BaseEdge path={path} markerEnd={markerEnd} style={style} />;
}

/** Build an SVG path through the points with rounded corners of radius r. */
function roundedPolyline(pts: { x: number; y: number }[], r: number): string {
  if (pts.length < 3) return `M ${pts[0].x} ${pts[0].y} L ${pts[pts.length - 1].x} ${pts[pts.length - 1].y}`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1], cur = pts[i], next = pts[i + 1];
    const p1 = shorten(cur, prev, r);   // point r before the corner
    const p2 = shorten(cur, next, r);   // point r after the corner
    d += ` L ${p1.x} ${p1.y} Q ${cur.x} ${cur.y} ${p2.x} ${p2.y}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

/** A point r away from `from` toward `to` (clamped to the segment's half-length). */
function shorten(from: { x: number; y: number }, to: { x: number; y: number }, r: number) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const k = Math.min(r, len / 2) / len;
  return { x: from.x + dx * k, y: from.y + dy * k };
}
