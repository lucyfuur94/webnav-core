// Invisible handles: edges render, no visible dots (no-handle drops edges in v12).
import { Handle, Position, type NodeProps } from '@xyflow/react';

const HIDDEN = { opacity: 0, width: 1, height: 1, minWidth: 1, border: 'none', background: 'transparent' } as const;

export function SiteNode({ data }: NodeProps) {
  const d = data as { label: string; capabilities?: string[] };
  return (
    <div style={{ border: '1px solid #334155', borderRadius: 8, background: '#fff',
      padding: '8px 12px', width: 200, boxSizing: 'border-box', fontFamily: 'sans-serif' }}>
      <Handle type="target" position={Position.Left} style={HIDDEN} />
      <div style={{ fontWeight: 600, fontSize: 13 }}>{d.label}</div>
      {d.capabilities?.length ? (
        <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {d.capabilities.map((c) => (
            <span key={c} style={{ fontSize: 10, background: '#e2e8f0', borderRadius: 4, padding: '1px 5px' }}>{c}</span>
          ))}
        </div>
      ) : null}
      <Handle type="source" position={Position.Right} style={HIDDEN} />
    </div>
  );
}
