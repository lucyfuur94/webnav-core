// Invisible handles on all four sides (source + target each), matching StateNode,
// so layout.ts's per-edge sourceHandle/targetHandle (s-{t,b,l,r} / t-{t,b,l,r})
// resolve here too. No visible dots.
import { Handle, Position, type NodeProps } from '@xyflow/react';

const HIDDEN = { opacity: 0, width: 1, height: 1, minWidth: 1, border: 'none', background: 'transparent' } as const;
const SIDES = [
  ['t', Position.Top], ['b', Position.Bottom], ['l', Position.Left], ['r', Position.Right],
] as const;

export function SiteNode({ data }: NodeProps) {
  const d = data as { label: string; capabilities?: string[]; dark?: boolean };
  const dark = d.dark === true;
  const bg = dark ? '#334155' : '#fff';
  const text = dark ? '#f8fafc' : '#0f172a';
  const chipBg = dark ? '#475569' : '#e2e8f0';
  const chipText = dark ? '#e2e8f0' : '#334155';
  return (
    <div style={{ border: `1px solid ${dark ? '#64748b' : '#334155'}`, borderRadius: 8, background: bg,
      color: text, padding: '8px 12px', width: 200, boxSizing: 'border-box', fontFamily: 'sans-serif' }}>
      {SIDES.map(([k, pos]) => (<Handle key={'s' + k} id={'s-' + k} type="source" position={pos} style={HIDDEN} />))}
      {SIDES.map(([k, pos]) => (<Handle key={'t' + k} id={'t-' + k} type="target" position={pos} style={HIDDEN} />))}
      <div style={{ fontWeight: 600, fontSize: 13 }}>{d.label}</div>
      {d.capabilities?.length ? (
        <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {d.capabilities.map((c) => (
            <span key={c} style={{ fontSize: 10, background: chipBg, color: chipText, borderRadius: 4, padding: '1px 5px' }}>{c}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
