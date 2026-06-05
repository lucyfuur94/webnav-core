import { Handle, Position, type NodeProps } from '@xyflow/react';

export function StateNode({ data }: NodeProps) {
  const d = data as { label: string; role?: string; signals?: string[] };
  return (
    <div style={{ border: '1px solid #475569', borderRadius: 8, background: '#f8fafc',
      padding: '8px 12px', minWidth: 150, fontFamily: 'sans-serif' }}>
      <Handle type="target" position={Position.Top} />
      <div style={{ fontWeight: 600, fontSize: 13 }}>{d.label}</div>
      {d.role ? <div style={{ fontSize: 10, color: '#64748b' }}>{d.role}</div> : null}
      {d.signals?.length ? (
        <div style={{ fontSize: 10, color: '#0f766e' }}>{d.signals.join(', ')}</div>
      ) : null}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
