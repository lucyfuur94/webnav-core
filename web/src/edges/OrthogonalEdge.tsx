// Orthogonal (right-angle) edges for the interior graph viewer.
//
// CANONICAL React Flow pattern: React Flow computes the edge's endpoint
// coordinates FROM THE HANDLES it connects to and passes them as props
// (sourceX/sourceY/targetX/targetY/sourcePosition/targetPosition). This edge just
// feeds those into the BUILT-IN getSmoothStepPath helper — so the arrowhead
// attaches exactly at the target handle / node border (no hand-rolled geometry,
// no manual gap, no rect reading). The source endpoint IS the pink affordance
// port the edge connects to (sourceHandle on the edge object), the target
// endpoint IS the node's top target handle (targetHandle: 'in').
//
// SelfLoopEdge (from===to) is the ONLY edge that reads node internals — self-loops
// genuinely need node geometry, which getSmoothStepPath does not handle.
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useInternalNode,
  type EdgeProps,
  type InternalNode,
} from '@xyflow/react';

const CORNER_R = 8; // rounded-corner radius at each bend
// How far the wire runs straight out of its source/target handle before bending.
// A generous offset makes each edge step horizontally out of its OWN affordance
// row (distinct Y) before turning, so you can see which row it came from and
// parallel edges don't immediately bunch onto one track (Issue B).
const STEP_OFFSET = 34;
const HILITE = '#f59e0b'; // amber highlight for the hovered edge

interface OrthogonalData {
  color?: string;
  width?: number;
  dashed?: boolean;
  dimmed?: boolean;
  hovered?: boolean;
  label?: string;
  fromLabel?: string;
  toLabel?: string;
  // where along the run the bend happens (0 = at source, 1 = at target). Staggered
  // per-edge in layout.ts so edges sharing a target handle fan apart (Issue A).
  stepPosition?: number;
  // how far the wire runs out of its source before the first 90° turn = which
  // vertical GUTTER it uses. Distinct per edge between the same node pair so
  // reciprocal/parallel wires never share a track (Issue A).
  offset?: number;
}

function edgeStyle(d: OrthogonalData): React.CSSProperties {
  const hovered = d.hovered === true;
  return {
    stroke: hovered ? HILITE : d.color,
    strokeWidth: hovered ? (d.width ?? 1) + 1.5 : d.dashed ? 1.4 : d.width,
    strokeDasharray: d.dashed && !hovered ? '5 4' : undefined,
    opacity: d.dimmed ? 0.1 : hovered ? 1 : d.dashed ? 0.7 : 1,
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
          transform: `translate(-50%,-50%) translate(${x}px,${y}px)`,
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

export function OrthogonalEdge(props: EdgeProps): JSX.Element {
  const {
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, id,
    interactionWidth,
  } = props;
  const d = (props.data ?? {}) as OrthogonalData;

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
    borderRadius: CORNER_R, offset: d.offset ?? STEP_OFFSET,
    stepPosition: d.stepPosition ?? 0.5,
  });

  const hovered = d.hovered === true;
  // Always show the step label when present; on hover also show a "from → to"
  // caption so you can read what the edge connects.
  const showLabel = !d.dimmed && (d.label || hovered);
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={edgeStyle(d)}
        interactionWidth={interactionWidth ?? 10}
      />
      {showLabel ? (
        <EdgeLabel
          x={labelX}
          y={labelY}
          text={d.label}
          caption={hovered ? `${d.fromLabel ?? '?'} → ${d.toLabel ?? '?'}` : undefined}
        />
      ) : null}
    </>
  );
}

// Self-loop (from===to) as a small right-side RECTANGULAR loop: out the source
// node's right border, into a short gutter, down a bit, and back into the right
// border with the arrow touching the node. This is the ONLY edge that reads node
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
  const d = (data ?? {}) as OrthogonalData;

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
      {!d.dimmed && d.label ? (
        <EdgeLabel
          x={laneX + 6}
          y={midY}
          text={`↻ ${d.label}`}
          caption={d.hovered ? `${d.fromLabel ?? '?'} → ${d.toLabel ?? '?'}` : undefined}
        />
      ) : null}
    </>
  );
}
