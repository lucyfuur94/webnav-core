// Edges for the interior graph viewer.
//
// RoutedEdge supports THREE connector shapes (toggled in InteriorView):
//   • 'step'     — the ORTHOGONAL polyline ELK routed AROUND the node boxes
//                  (data.points, absolute coords), rounded corners. This is the
//                  collision-aware path — arrows never cut through a box.
//   • 'curved'   — a bezier between the React-Flow endpoint coords (point-to-
//                  point; does NOT avoid nodes — the user's explicit choice).
//   • 'straight' — a straight line between the endpoint coords (likewise).
//
// SelfLoopEdge (from===to) draws a small right-side rectangular loop from node
// geometry — ELK doesn't route node→itself loops, so this is the ONLY edge that
// reads node internals (via useInternalNode).
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getStraightPath,
  useInternalNode,
  type EdgeProps,
  type InternalNode,
} from '@xyflow/react';

const CORNER_R = 12; // rounded-corner radius at interior bends
const END_R = 24;    // larger radius on the first/last bend → curved lead-in/out (Fix 5)
const HILITE = '#f59e0b'; // amber highlight for the hovered edge

export type ConnectorShape = 'step' | 'curved' | 'straight';

interface RoutedData {
  color?: string;
  width?: number;
  dashed?: boolean;
  dimmed?: boolean;
  hovered?: boolean;
  core?: boolean;
  label?: string;
  fromLabel?: string;
  toLabel?: string;
  // ELK-routed polyline (absolute coords) — used in 'step' mode to route around
  // boxes. Undefined if ELK produced no route (then 'step' falls back to a line).
  points?: { x: number; y: number }[];
  // which connector shape to render; defaults to 'step'.
  shape?: ConnectorShape;
}

function edgeStyle(d: RoutedData): React.CSSProperties {
  const hovered = d.hovered === true;
  return {
    stroke: hovered ? HILITE : d.color,
    strokeWidth: hovered ? (d.width ?? 1) + 1.5 : d.width,
    strokeDasharray: d.dashed && !hovered ? '5 4' : undefined,
    opacity: d.dimmed ? 0.08 : hovered ? 1 : d.dashed ? 0.7 : undefined,
    fill: 'none',
    transition: 'opacity 120ms ease, stroke 120ms ease, stroke-width 120ms ease',
  };
}

function EdgeLabel({ x, y, text, caption }: {
  x: number; y: number; text?: string; caption?: string;
}): JSX.Element {
  return (
    <EdgeLabelRenderer>
      <div
        className="wn-edge-label"
        style={{
          position: 'absolute',
          // Sit ABOVE the edge (lift the chip clear of the line) rather than centred
          // on it, so the wire stays unobscured.
          transform: `translate(-50%,-100%) translate(${x}px,${y - 6}px)`,
          fontSize: 9,
          fontFamily: 'sans-serif',
          background: caption ? 'rgba(255,251,235,0.97)' : 'rgba(248,250,252,0.9)',
          color: '#475569',
          padding: caption ? '3px 6px' : '1px 4px',
          borderRadius: 4,
          border: caption ? `1px solid ${HILITE}` : 'none',
          boxShadow: caption ? '0 1px 4px rgba(0,0,0,0.18)' : 'none',
          pointerEvents: 'none',
          maxWidth: 220,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          zIndex: caption ? 5 : 1,
        }}
      >
        {text ? <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{text}</div> : null}
        {caption ? (
          <div style={{ fontSize: 9, color: '#92400e', fontWeight: 600, marginTop: text ? 2 : 0 }}>
            {caption}
          </div>
        ) : null}
      </div>
    </EdgeLabelRenderer>
  );
}

/** SVG path through the points with rounded corners. The FIRST and LAST corners
 *  use a LARGER radius (`endR`) so the wire eases out of its source and into its
 *  target with a gentle curve instead of a sharp right-angle — this visually
 *  separates several edges that emerge from / merge into the same node (Fix 5). */
function roundedPolyline(pts: { x: number; y: number }[], r: number, endR: number): string {
  if (pts.length < 2) return '';
  if (pts.length === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
  const corners = pts.length - 2;   // number of interior bend points
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1], cur = pts[i], next = pts[i + 1];
    // bigger radius on the first corner (leaving source) and last (entering target)
    const rr = (i === 1 || i === corners) ? endR : r;
    const p1 = shorten(cur, prev, rr);
    const p2 = shorten(cur, next, rr);
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

/** Label anchor = midpoint of the single LONGEST segment of the polyline. On a
 *  top-down flow this reliably lands on a long run that visibly belongs to the
 *  line, never on a short corner jog (the old mid-INDEX pick floated labels). */
function labelAnchor(pts: { x: number; y: number }[]): { x: number; y: number } {
  if (pts.length === 0) return { x: 0, y: 0 };
  if (pts.length === 1) return pts[0];
  let best = 0, bestLen = -1;
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    if (len > bestLen) { bestLen = len; best = i; }
  }
  const a = pts[best], b = pts[best + 1];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function RoutedEdge(props: EdgeProps): JSX.Element {
  const {
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, id,
    interactionWidth,
  } = props;
  const d = (props.data ?? {}) as RoutedData;
  const shape = d.shape ?? 'step';

  let path: string;
  let labelX: number;
  let labelY: number;

  if (shape === 'curved') {
    const [p, lx, ly] = getBezierPath({
      sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
    });
    path = p; labelX = lx; labelY = ly;
  } else if (shape === 'straight') {
    const [p, lx, ly] = getStraightPath({ sourceX, sourceY, targetX, targetY });
    path = p; labelX = lx; labelY = ly;
  } else {
    // 'step' — the ELK-routed orthogonal polyline (around the boxes).
    const pts = d.points;
    if (pts && pts.length >= 2) {
      path = roundedPolyline(pts, CORNER_R, END_R);
      const m = labelAnchor(pts);
      labelX = m.x; labelY = m.y;
    } else {
      // no route from ELK — fall back to a straight line between endpoints.
      const [p, lx, ly] = getStraightPath({ sourceX, sourceY, targetX, targetY });
      path = p; labelX = lx; labelY = ly;
    }
  }

  const hovered = d.hovered === true;
  // No static edge text — labels appear ONLY on hover (the from→to caption).
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={edgeStyle(d)}
        interactionWidth={interactionWidth ?? 10}
      />
      {hovered && !d.dimmed ? (
        <EdgeLabel
          x={labelX}
          y={labelY}
          caption={`${d.fromLabel ?? '?'} → ${d.toLabel ?? '?'}`}
        />
      ) : null}
    </>
  );
}

// Self-loop (from===to) as a small right-side RECTANGULAR loop: out the source
// node's right border, into a short gutter, down a bit, and back into the right
// border with the arrow touching the node. The ONLY edge that reads node
// internals (via useInternalNode) — self-loops genuinely need node geometry.
type Rect = { x: number; y: number; width: number; height: number };

function rectOf(n: InternalNode | undefined): Rect | null {
  if (!n) return null;
  const w = n.measured?.width;
  const h = n.measured?.height;
  if (w == null || h == null) return null;
  return { x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, width: w, height: h };
}

export function SelfLoopEdge({ id, source, markerEnd, data }: EdgeProps): JSX.Element | null {
  const sNode = useInternalNode(source);
  const rect = rectOf(sNode);
  if (!rect) return null;
  const d = (data ?? {}) as RoutedData;

  const rightX = rect.x + rect.width;
  const midY = rect.y + rect.height / 2;
  const gutter = 28; // how far right the loop bulges
  const drop = 24; // vertical extent of the loop
  const startY = midY - drop / 2;
  const endY = midY + drop / 2;
  const laneX = rightX + gutter;
  // out from right border → right to lane → down → back left into the right border.
  const path =
    `M ${rightX},${startY}` +
    ` L ${laneX - CORNER_R},${startY}` +
    ` Q ${laneX},${startY} ${laneX},${startY + CORNER_R}` +
    ` L ${laneX},${endY - CORNER_R}` +
    ` Q ${laneX},${endY} ${laneX - CORNER_R},${endY}` +
    ` L ${rightX},${endY}`;

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={edgeStyle(d)} />
      {d.hovered && !d.dimmed ? (
        <EdgeLabel
          x={laneX + 6}
          y={midY}
          caption={`↻ ${d.fromLabel ?? '?'} → ${d.toLabel ?? '?'}`}
        />
      ) : null}
    </>
  );
}
