// xyflow needs connection points for edges to render, but we don't want the
// visible "dots". So we keep ONE invisible source + ONE invisible target handle
// per node: edges draw, no dots show. (No-handle drops edges entirely in v12.)
import { Handle, Position, type NodeProps } from '@xyflow/react';

const HIDDEN = { opacity: 0, width: 1, height: 1, minWidth: 1, border: 'none', background: 'transparent' } as const;

export function StateNode({ data }: NodeProps) {
  const d = data as { label: string; role?: string; signals?: string[]; affordances?: string[] };
  return (
    <div style={{ border: '1px solid #475569', borderRadius: 8, background: '#f8fafc',
      padding: '8px 12px', width: 220, boxSizing: 'border-box', fontFamily: 'sans-serif' }}>
      <Handle type="target" position={Position.Top} style={HIDDEN} />
      <div style={{ fontWeight: 600, fontSize: 13 }}>{d.label}</div>
      {d.role ? <div style={{ fontSize: 10, color: '#64748b' }}>{d.role}</div> : null}
      {d.affordances?.length ? (
        <div style={{ marginTop: 4, display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          {d.affordances.map((a) => (
            <span key={a} style={{ fontSize: 9, background: '#e0e7ff', color: '#3730a3',
              borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap' }}>{a}</span>
          ))}
        </div>
      ) : null}
      <Handle type="source" position={Position.Bottom} style={HIDDEN} />
    </div>
  );
}
