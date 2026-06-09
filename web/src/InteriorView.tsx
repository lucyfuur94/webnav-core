import { useEffect, useMemo, useState } from 'react';
import { ReactFlow, Background, Controls, MiniMap, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { fetchInterior } from './api.js';
import { layoutGraph } from './layout.js';
import { isForkEdge } from './forkEdge.js';
import { synthesizeRevealSubNodes, buildLayoutNodes, buildLayoutEdges } from './revealSubnodes.js';
import { StateNode } from './nodes/StateNode.js';
import { UnexploredNode } from './nodes/UnexploredNode.js';
import { OrthogonalEdge, SelfLoopEdge } from './edges/OrthogonalEdge.js';
import { neighborSet, nodeOpacity, edgeActive } from './highlight.js';

const nodeTypes = { state: StateNode, unexplored: UnexploredNode };
const edgeTypes = { orthogonal: OrthogonalEdge, selfloop: SelfLoopEdge };
const DIM = 0.18;   // opacity for nodes NOT adjacent to the hovered node

export function InteriorView({ id, onBack }: { id: string; onBack: () => void }) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  // id of the edge currently hovered (Issue C). When set, that edge is highlighted
  // and everything else (other edges + non-endpoint nodes) is dimmed.
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);

  useEffect(() => {
    // A 404 (unknown node) throws in fetchInterior — distinguish that "no
    // interior yet" case from a real API failure so the message isn't misleading.
    fetchInterior(id).then(async (iv) => {
      if (!iv.states.length) { setEmpty(true); return; }

      // ── Reveal sub-node synthesis (VIEWER-ONLY; see revealSubnodes.ts) ────────
      // The data model keeps an overlay (e.g. the burger menu) as a NESTED reveal
      // affordance with `children` — it has no URL/state of its own. The viewer
      // renders that overlay as a beside-it SUB-NODE holding the options, instead
      // of nesting them inside the parent. Backend (../src) is untouched.
      const { subStates, revealEdges, childOwner } = synthesizeRevealSubNodes(iv.states);
      const ln = buildLayoutNodes(iv.states, subStates);
      const le = buildLayoutEdges(iv.edges, revealEdges, childOwner, isForkEdge);

      const laid = await layoutGraph(ln, le, 'interior');
      const meta = new Map<string, { role: string; availableSignals: string[]; affordances: any[]; sub?: boolean }>(
        iv.states.map((s) => [s.id, { role: s.role, availableSignals: s.availableSignals, affordances: s.affordances }]),
      );
      for (const s of subStates) meta.set(s.id, { role: s.role, availableSignals: s.availableSignals, affordances: s.affordances, sub: true });
      setNodes(laid.nodes.map((nd) => {
        const s = meta.get(nd.id);
        return s
          ? { ...nd, data: { ...nd.data, role: s.role, signals: s.availableSignals, affordances: s.affordances, sub: s.sub === true } }
          : nd;  // synthetic unexplored node — leave data as-is
      }));
      setEdges(laid.edges);
    }).catch((e) => {
      if (String(e).includes('404')) setEmpty(true);
      else setError(String(e));
    });
  }, [id]);

  // The two endpoints of the hovered edge (for node dimming when an edge is hovered).
  const edgeEndpoints = useMemo(() => {
    if (!hoveredEdge) return null;
    const e = edges.find((x) => x.id === hoveredEdge);
    return e ? new Set<string>([e.source, e.target]) : null;
  }, [hoveredEdge, edges]);

  // Hover highlight: when a node is hovered, fully show it + its neighbors + the
  // edges touching it, and dim everything else. When an EDGE is hovered, show only
  // that edge + its two endpoint nodes. No hover → everything full.
  const neighbors = useMemo(() => neighborSet(hovered, edges.map((e) => ({ source: e.source, target: e.target }))), [hovered, edges]);

  const shownNodes = useMemo(() => nodes.map((n) => {
    const opacity = edgeEndpoints
      ? (edgeEndpoints.has(n.id) ? 1 : DIM)
      : nodeOpacity(n.id, neighbors, DIM);
    return { ...n, style: { ...(n.style || {}), opacity, transition: 'opacity 120ms' } };
  }), [nodes, neighbors, edgeEndpoints]);

  // OrthogonalEdge/SelfLoopEdge read opacity + the hovered flag from data (not
  // style), so dimming + edge-hover state is threaded through edge data here.
  const shownEdges = useMemo(() => edges.map((e) => {
    if (hoveredEdge) {
      const isHovered = e.id === hoveredEdge;
      return { ...e, data: { ...(e.data || {}), dimmed: !isHovered, hovered: isHovered } };
    }
    const active = edgeActive({ source: e.source, target: e.target }, hovered);
    return { ...e, data: { ...(e.data || {}), dimmed: !active, hovered: false } };
  }), [edges, hovered, hoveredEdge]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <button onClick={onBack} style={{ position: 'absolute', zIndex: 10, top: 12, left: 12,
        padding: '6px 10px', fontFamily: 'sans-serif', cursor: 'pointer' }}>← back to map</button>
      {error
        ? <div style={{ padding: 24, paddingTop: 56, fontFamily: 'sans-serif', color: '#334155' }}>Couldn't load the interior for <b>{id}</b>: {error}</div>
        : empty
        ? <div style={{ padding: 24, paddingTop: 56, fontFamily: 'sans-serif' }}>No interior recorded for <b>{id}</b> yet. Map it with a record session.</div>
        : <ReactFlow nodes={shownNodes} edges={shownEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
            fitView fitViewOptions={{ padding: 0.18 }} minZoom={0.05}
            onNodeMouseEnter={(_, n) => { setHovered(n.id); setHoveredEdge(null); }}
            onNodeMouseLeave={() => setHovered(null)}
            onEdgeMouseEnter={(_, e) => setHoveredEdge(e.id)}
            onEdgeMouseLeave={() => setHoveredEdge(null)}
            // Catch-all: edges' interaction bands overlap, so onEdgeMouseLeave can
            // miss when the cursor slides onto empty canvas. Clearing on pane move
            // guarantees the highlight releases as soon as you're off an edge.
            onPaneMouseMove={() => { if (hoveredEdge) setHoveredEdge(null); }}>
            <Background /><Controls /><MiniMap />
          </ReactFlow>}
    </div>
  );
}
