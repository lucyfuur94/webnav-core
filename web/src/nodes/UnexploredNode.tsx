// A small faded pill standing in for an unexplored (dangling) edge target — a
// navigate/reveal affordance that the map knows EXISTS but hasn't followed yet.
// It only needs a target handle (edges only arrive here).
import { Handle, Position, type NodeProps } from '@xyflow/react';

const HIDDEN = { opacity: 0, width: 1, height: 1, border: 'none', background: 'transparent' } as const;

export function UnexploredNode(_props: NodeProps): JSX.Element {
  return (
    <div style={{ border: '1px dashed #94a3b8', borderRadius: 999, background: '#f1f5f9',
      padding: '4px 12px', fontFamily: 'sans-serif', fontSize: 10, color: '#64748b',
      display: 'flex', alignItems: 'center', gap: 4, opacity: 0.85 }}>
      <Handle id="t-l" type="target" position={Position.Left} style={HIDDEN} />
      <Handle id="t-t" type="target" position={Position.Top} style={HIDDEN} />
      <span style={{ fontWeight: 700 }}>?</span>
      <span>unexplored</span>
    </div>
  );
}
