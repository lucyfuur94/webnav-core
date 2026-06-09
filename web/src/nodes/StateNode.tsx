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
// A single TARGET handle on the node TOP (id="in") is where all incoming edges
// land — React Flow routes the smoothstep edge into it. Width is fixed (~240px);
// height grows with content.
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

// The incoming TARGET handles: invisible 1px anchor points (the arrowhead marks
// where edges land, so a visible dot would just sit redundantly under the arrow).
// THREE of them at distinct sides — top / left / bottom — so that the two
// directions of a reciprocal pair (a→b and b→a) and forward-vs-back edges land on
// DIFFERENT handles and getSmoothStepPath routes them apart instead of on top of
// each other. layout.ts picks which handle each edge targets, by geometry.
const IN_PORT = {
  width: 1, height: 1, minWidth: 1, minHeight: 1,
  background: 'transparent', border: 'none', opacity: 0,
} as const;

// The affordance PORT MARKER: a pink rectangle on the row's right edge showing
// "this row is an edge exit". It is now DECORATIVE (a plain span, not a Handle) —
// edges leave the node's single bottom-centre source handle ('src'), because ELK
// routes from a node-level SOUTH port (per-row anchoring would need a measured
// two-pass; deferred). The marker still tells you which rows are navigations.
const PORT_MARK: React.CSSProperties = {
  position: 'absolute', right: -1, width: 12, height: 9, borderRadius: 2,
  background: '#ec4899', border: '1px solid #be185d',
};

// A navigate affordance routes; a reveal CHILD that itself navigates also routes.
function routes(a: Affordance): boolean {
  return a.kind === 'navigate';
}

// A reveal that EXPOSES options is rendered as an edge to a beside-it SUB-NODE
// (synthesised by the viewer), so its row gets a source PORT here and its children
// live in that sub-node — NOT inline. A childless reveal (or one that itself
// navigates) still just routes from its own row.
function opensSubNode(a: Affordance): boolean {
  return a.kind === 'reveal' && Array.isArray(a.children) && a.children.length > 0;
}

interface StateNodeData {
  label: string;
  role?: string;
  signals?: string[];
  affordances?: Affordance[];
  // synthetic reveal SUB-NODE (an overlay's options): styled lighter/dashed.
  sub?: boolean;
  // set of reveal-affordance ids (scoped to THIS node, e.g. 'nodeId::affId') that
  // are currently EXPANDED — when expanded the overlay sub-node is materialised by
  // the viewer and this row shows ▾; collapsed (default) shows ▸ + a count chip.
  expandedReveals?: Set<string>;
  // toggle an overlay open/closed (re-runs layout in the viewer). Receives the
  // reveal affordance's id (raw aff.id) on THIS node.
  onToggleReveal?: (affId: string) => void;
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
        /* Decorative pink marker: "this row is an edge exit". The actual edge
           leaves the node's bottom-centre 'src' handle (see node footer). */
        <span style={PORT_MARK} />
      ) : null}
    </div>
  );
}

// A reveal-with-children row. Its options live in a beside-it synthetic SUB-NODE
// the viewer materialises ONLY WHEN EXPANDED (Change 3: collapsed by default to cut
// clutter). Collapsed → a clickable chip "▸ <label> (N)" with NO source port and NO
// sub-node/edges. Expanded → "▾ <label>" + a pink source PORT the purple "opens
// overlay" edge leaves from (the viewer adds the sub-node). A childless reveal (or
// one that itself navigates) falls back to a plain AffordanceRow via routes().
function RevealRow({ aff, expanded, onToggle }: {
  aff: Affordance; expanded: boolean; onToggle?: (affId: string) => void;
}): JSX.Element {
  const opensOverlay = opensSubNode(aff);
  const childCount = aff.children?.length ?? 0;
  // Only an overlay-opening reveal is collapsible; otherwise it just routes.
  const collapsible = opensOverlay;

  return (
    <div style={{ position: 'relative' }}>
      <div
        onClick={collapsible ? (ev) => { ev.stopPropagation(); onToggle?.(aff.id); } : undefined}
        title={collapsible ? (expanded ? 'collapse overlay' : 'expand overlay') : undefined}
        style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 4px', fontSize: 11,
          color: '#1e293b', userSelect: 'none',
          cursor: collapsible ? 'pointer' : 'default',
          background: collapsible && !expanded ? '#f5f3ff' : undefined,
          borderRadius: collapsible ? 4 : undefined }}
      >
        <span style={{ width: 12, color: '#7c3aed', fontSize: 10 }}>
          {collapsible ? (expanded ? '▾' : '▸') : '·'}
        </span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {aff.label}
        </span>
        {collapsible && !expanded && childCount ? (
          <span style={{ fontSize: 9, color: '#7c3aed', background: '#ede9fe', border: '1px solid #ddd6fe',
            borderRadius: 8, padding: '0 5px', fontWeight: 600 }}>{childCount}</span>
        ) : null}
        {aff.commit ? (
          <span style={{ fontSize: 8, background: '#fee2e2', color: '#b91c1c', border: '1px solid #fca5a5',
            borderRadius: 4, padding: '0 3px', fontWeight: 600 }}>commit</span>
        ) : null}
        {/* A source PORT only when this row actually emits an edge: an EXPANDED
            overlay (→ its sub-node) or a reveal that itself navigates. A collapsed
            overlay emits nothing, so no port. */}
        {(opensOverlay && expanded) || (!opensOverlay && routes(aff)) ? (
          <span style={PORT_MARK} />
        ) : null}
      </div>
    </div>
  );
}

export function StateNode({ data }: NodeProps): JSX.Element {
  const d = data as unknown as StateNodeData;
  const affordances = d.affordances ?? [];
  const sub = d.sub === true;
  const expandedReveals = d.expandedReveals ?? new Set<string>();

  // Uniform node border (no special "core spine" highlight): sub-node = dashed
  // purple (an overlay, semantically distinct); everything else = the same slate.
  const border = sub ? '1.5px dashed #7c3aed' : '1px solid #475569';

  return (
    <div style={{
      border,
      borderRadius: 8,
      background: sub ? '#faf5ff' : '#f8fafc',
      width: sub ? WIDTH - 24 : WIDTH,
      boxSizing: 'border-box', fontFamily: 'sans-serif', overflow: 'hidden' }}>
      {/* TARGET handles: 'in-top' (top-centre) is where layout.ts points incoming
          edges (mirrors ELK's NORTH port). The left/bottom handles remain so RF
          never errors on a stray targetHandle, but the routed edges all use in-top. */}
      <Handle id="in-top" type="target" position={Position.Top} style={IN_PORT} />
      <Handle id="in-left" type="target" position={Position.Left} style={IN_PORT} />
      <Handle id="in-bottom" type="target" position={Position.Bottom} style={IN_PORT} />
      {/* SOURCE handle: bottom-centre (mirrors ELK's SOUTH port). ALL outgoing edges
          leave here — curved/straight modes anchor their bezier/line to it; 'step'
          uses ELK's routed points (which also start at this port). */}
      <Handle id="src" type="source" position={Position.Bottom} style={IN_PORT} />

      {/* Title block */}
      <div style={{ padding: '8px 10px', borderBottom: affordances.length ? '1px solid #e2e8f0' : 'none' }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
          {sub ? (
            <span style={{ fontSize: 8, background: '#ede9fe', color: '#6d28d9', border: '1px solid #c4b5fd',
              borderRadius: 4, padding: '0 4px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              overlay
            </span>
          ) : null}
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span>
        </div>
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
                    ? <RevealRow key={a.id} aff={a} expanded={expandedReveals.has(a.id)} onToggle={d.onToggleReveal} />
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
