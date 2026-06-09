// A state rendered as a titled box (semanticName + role + a couple signals)
// followed by its affordance REPERTOIRE as a categorized vertical list, grouped
// by kind. Edges anchor to a SPECIFIC affordance row via a right-edge source
// <Handle id={'aff_'+affordance.id}> — only navigate rows (and explored reveal
// CHILDREN that navigate) get one, so an edge visibly leaves that row.
//
//  - navigate rows: emit a tiny visible source handle (so you can SEE the edge
//    originate at the row).
//  - reveal rows: collapsible (▸ collapsed / ▾ expanded, collapsed by default);
//    when expanded the children render indented, each in its own kind group with
//    its own handle if it navigates. The node grows taller when expanded.
//  - mutate / input rows: muted, NO handle (they never route).
//  - commit affordances: a red "commit" badge — never auto-fired (#2).
//
// One generic target handle per side + a single hidden centre target lets
// incoming floating edges land regardless of approach side. Width is fixed
// (~240px); height grows with content.
import { useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { Affordance } from '@server/mapstore/types.js';

const WIDTH = 240;

const KIND_ORDER: Affordance['kind'][] = ['navigate', 'reveal', 'mutate', 'input'];
const KIND_LABEL: Record<Affordance['kind'], string> = {
  navigate: 'navigate', reveal: 'reveal', mutate: 'mutate', input: 'input',
};
const KIND_COLOR: Record<Affordance['kind'], string> = {
  navigate: '#1d4ed8', reveal: '#7c3aed', mutate: '#b45309', input: '#0f766e',
};

const HIDDEN = { opacity: 0, width: 1, height: 1, minWidth: 1, border: 'none', background: 'transparent' } as const;

// A navigate affordance routes; a reveal CHILD that itself navigates also routes.
function routes(a: Affordance): boolean {
  return a.kind === 'navigate';
}

interface StateNodeData {
  label: string;
  role?: string;
  signals?: string[];
  affordances?: Affordance[];
}

function AffordanceRow({ aff, indent }: { aff: Affordance; indent: boolean }): JSX.Element {
  const routable = routes(aff);
  const muted = aff.kind === 'mutate' || aff.kind === 'input';
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 4px',
        paddingLeft: indent ? 16 : 4,
        fontSize: 11,
        color: muted ? '#94a3b8' : '#1e293b',
        fontStyle: muted ? 'italic' : 'normal',
      }}
    >
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {aff.label}
      </span>
      {aff.commit ? (
        <span style={{ fontSize: 8, background: '#fee2e2', color: '#b91c1c', border: '1px solid #fca5a5',
          borderRadius: 4, padding: '0 3px', fontWeight: 600, whiteSpace: 'nowrap' }}>
          commit · never auto-fired
        </span>
      ) : null}
      {aff.toState === null && routable ? (
        <span style={{ fontSize: 8, color: '#94a3b8' }}>?</span>
      ) : null}
      {routable ? (
        <>
          <span style={{ width: 6, height: 6, borderRadius: 6, background: KIND_COLOR.navigate, flexShrink: 0 }} />
          {/* Right-edge source handle for THIS row — floating edge anchors here. */}
          <Handle
            id={'aff_' + aff.id}
            type="source"
            position={Position.Right}
            style={{ right: 0, width: 7, height: 7, background: KIND_COLOR.navigate, border: '1px solid #fff' }}
          />
        </>
      ) : null}
    </div>
  );
}

function RevealRow({ aff }: { aff: Affordance }): JSX.Element {
  const [open, setOpen] = useState(false);
  const children = aff.children ?? [];
  return (
    <div style={{ position: 'relative' }}>
      <div
        onClick={() => setOpen((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 4px', fontSize: 11,
          color: '#1e293b', cursor: children.length ? 'pointer' : 'default', userSelect: 'none' }}
      >
        <span style={{ width: 10, color: '#7c3aed' }}>{children.length ? (open ? '▾' : '▸') : '·'}</span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {aff.label}
        </span>
        {aff.commit ? (
          <span style={{ fontSize: 8, background: '#fee2e2', color: '#b91c1c', border: '1px solid #fca5a5',
            borderRadius: 4, padding: '0 3px', fontWeight: 600 }}>commit</span>
        ) : null}
        {/* A reveal that itself navigates can route too. */}
        {routes(aff) ? (
          <>
            <span style={{ width: 6, height: 6, borderRadius: 6, background: KIND_COLOR.navigate, flexShrink: 0 }} />
            <Handle id={'aff_' + aff.id} type="source" position={Position.Right}
              style={{ right: 0, width: 7, height: 7, background: KIND_COLOR.navigate, border: '1px solid #fff' }} />
          </>
        ) : null}
      </div>
      {open && children.length ? (
        <div>
          {KIND_ORDER.map((kind) => {
            const group = children.filter((c) => c.kind === kind);
            if (!group.length) return null;
            return (
              <div key={kind}>
                <div style={{ fontSize: 8, letterSpacing: 0.5, textTransform: 'uppercase', color: KIND_COLOR[kind],
                  paddingLeft: 16, marginTop: 2 }}>{KIND_LABEL[kind]}</div>
                {group.map((c) => <AffordanceRow key={c.id} aff={c} indent />)}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function StateNode({ data }: NodeProps): JSX.Element {
  const d = data as unknown as StateNodeData;
  const affordances = d.affordances ?? [];

  return (
    <div style={{ border: '1px solid #475569', borderRadius: 8, background: '#f8fafc',
      width: WIDTH, boxSizing: 'border-box', fontFamily: 'sans-serif', overflow: 'hidden' }}>
      {/* One generic target handle per side + a hidden centre — incoming edges land
          regardless of the approach side; floating edges read the border anyway. */}
      <Handle id="t-t" type="target" position={Position.Top} style={HIDDEN} />
      <Handle id="t-b" type="target" position={Position.Bottom} style={HIDDEN} />
      <Handle id="t-l" type="target" position={Position.Left} style={HIDDEN} />
      <Handle id="t-r" type="target" position={Position.Right} style={HIDDEN} />

      {/* Title block */}
      <div style={{ padding: '8px 10px', borderBottom: affordances.length ? '1px solid #e2e8f0' : 'none' }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>{d.label}</div>
        {d.role ? <div style={{ fontSize: 10, color: '#64748b' }}>{d.role}</div> : null}
        {d.signals?.length ? (
          <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 2, overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {d.signals.slice(0, 2).join(' · ')}{d.signals.length > 2 ? ' …' : ''}
          </div>
        ) : null}
      </div>

      {/* Affordance repertoire, grouped by kind */}
      {affordances.length ? (
        <div style={{ padding: '4px 0' }}>
          {KIND_ORDER.map((kind) => {
            const group = affordances.filter((a) => a.kind === kind);
            if (!group.length) return null;
            return (
              <div key={kind}>
                <div style={{ fontSize: 8, letterSpacing: 0.5, textTransform: 'uppercase', color: KIND_COLOR[kind],
                  paddingLeft: 6, marginTop: 2 }}>{KIND_LABEL[kind]}</div>
                {group.map((a) =>
                  a.kind === 'reveal'
                    ? <RevealRow key={a.id} aff={a} />
                    : <AffordanceRow key={a.id} aff={a} indent={false} />,
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
