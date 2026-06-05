import { Handle, Position, type NodeProps } from '@xyflow/react';

export function SiteNode({ data }: NodeProps) {
  const d = data as { label: string; capabilities?: string[] };
  return (
    <div style={{ border: '1px solid #334155', borderRadius: 8, background: '#fff',
      padding: '8px 12px', minWidth: 160, fontFamily: 'sans-serif' }}>
      <Handle type="target" position={Position.Left} />
      <div style={{ fontWeight: 600, fontSize: 13 }}>{d.label}</div>
      {d.capabilities?.length ? (
        <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {d.capabilities.map((c) => (
            <span key={c} style={{ fontSize: 10, background: '#e2e8f0', borderRadius: 4, padding: '1px 5px' }}>{c}</span>
          ))}
        </div>
      ) : null}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
