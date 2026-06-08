import { BaseEdge, type EdgeProps } from '@xyflow/react';

// A bezier edge that bows to ONE side by a signed offset. For a bidirectional
// pair (a->b and b->a) the two edges get opposite bow signs, so together they
// read as a symmetric loop between the two nodes instead of overlapping.
// `data.bow` = signed magnitude (px). 0 / absent → a gentle default curve.
export function BowEdge(props: EdgeProps) {
  const { sourceX, sourceY, targetX, targetY, markerEnd, style, data } = props;
  const bow = (data as { bow?: number } | undefined)?.bow ?? 0;

  // Midpoint, pushed perpendicular to the source→target line by `bow`.
  const mx = (sourceX + targetX) / 2, my = (sourceY + targetY) / 2;
  const dx = targetX - sourceX, dy = targetY - sourceY;
  const len = Math.hypot(dx, dy) || 1;
  // unit normal (perpendicular)
  const nx = -dy / len, ny = dx / len;
  const cx = mx + nx * bow, cy = my + ny * bow;

  const path = `M ${sourceX} ${sourceY} Q ${cx} ${cy} ${targetX} ${targetY}`;
  return <BaseEdge path={path} markerEnd={markerEnd} style={style} />;
}
