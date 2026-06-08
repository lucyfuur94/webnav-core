// Invisible handles on ALL FOUR sides (top/bottom/left/right), each as both a
// source and a target, so an edge can connect via whichever side is cleanest:
// vertical edges use top/bottom, side-by-side edges use left/right (set via the
// edge's sourceHandle/targetHandle in layout.ts). No visible dots.
import { Handle, Position, type NodeProps } from '@xyflow/react';

const HIDDEN = { opacity: 0, width: 1, height: 1, minWidth: 1, border: 'none', background: 'transparent' } as const;
const SIDES = [
  ['t', Position.Top], ['b', Position.Bottom], ['l', Position.Left], ['r', Position.Right],
] as const;

export function StateNode({ data }: NodeProps) {
  const d = data as { label: string; role?: string; signals?: string[]; affordances?: string[] };
  return (
    <div style={{ border: '1px solid #475569', borderRadius: 8, background: '#f8fafc',
      padding: '8px 12px', width: 220, boxSizing: 'border-box', fontFamily: 'sans-serif' }}>
      {SIDES.map(([k, pos]) => (
        <Handle key={'s' + k} id={'s-' + k} type="source" position={pos} style={HIDDEN} />
      ))}
      {SIDES.map(([k, pos]) => (
        <Handle key={'t' + k} id={'t-' + k} type="target" position={pos} style={HIDDEN} />
      ))}
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
    </div>
  );
}
