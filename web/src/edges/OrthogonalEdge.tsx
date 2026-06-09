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

interface OrthogonalData {
  color?: string;
  width?: number;
  dashed?: boolean;
  dimmed?: boolean;
  label?: string;
}

function edgeStyle(d: OrthogonalData): React.CSSProperties {
  return {
    stroke: d.color,
    strokeWidth: d.dashed ? 1.4 : d.width,
    strokeDasharray: d.dashed ? '5 4' : undefined,
    opacity: d.dimmed ? 0.12 : d.dashed ? 0.7 : 1,
    fill: 'none',
    transition: 'opacity 120ms ease',
  };
}

function EdgeLabel({ x, y, text }: { x: number; y: number; text: string }): JSX.Element {
  return (
    <EdgeLabelRenderer>
      <div
        className="wn-edge-label"
        style={{
          position: 'absolute',
          transform: `translate(-50%,-50%) translate(${x}px,${y}px)`,
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
        {text}
      </div>
    </EdgeLabelRenderer>
  );
}

export function OrthogonalEdge(props: EdgeProps): JSX.Element {
  const {
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, id,
  } = props;
  const d = (props.data ?? {}) as OrthogonalData;

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: CORNER_R,
  });

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={edgeStyle(d)} />
      {!d.dimmed && d.label ? <EdgeLabel x={labelX} y={labelY} text={d.label} /> : null}
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
      {!d.dimmed && d.label ? <EdgeLabel x={laneX + 6} y={midY} text={`↻ ${d.label}`} /> : null}
    </>
  );
}
