import { useEffect, useMemo, useState } from 'react';
import { ReactFlow, Background, Controls, MiniMap, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { fetchInterior } from './api.js';
import { layoutGraph, type LayoutEdge } from './layout.js';
import { isForkEdge } from './forkEdge.js';
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

  useEffect(() => {
    // A 404 (unknown node) throws in fetchInterior — distinguish that "no
    // interior yet" case from a real API failure so the message isn't misleading.
    fetchInterior(id).then(async (iv) => {
      if (!iv.states.length) { setEmpty(true); return; }
      const ln = iv.states.map((s) => ({
        id: s.id,
        label: s.semanticName,
        // height estimate: top-level affordances + a slack count for reveal children.
        badges: (s.affordances?.length ?? 0)
          + (s.affordances ?? []).reduce((sum, a) => sum + (a.children?.length ?? 0), 0) / 2,
      }));
      const le: LayoutEdge[] = iv.edges.map((e, i) => ({
        id: `e${i}`,
        source: e.from,
        target: e.to,
        fork: isForkEdge(e),
        core: e.core === true,
        viaAffordance: e.viaAffordance,
        dangling: e.dangling === true,
        label: e.semanticStep,
      }));
      const laid = await layoutGraph(ln, le, 'interior');
      const meta = new Map(iv.states.map((s) => [s.id, s]));
      setNodes(laid.nodes.map((nd) => {
        const s = meta.get(nd.id);
        return s
          ? { ...nd, data: { ...nd.data, role: s.role, signals: s.availableSignals, affordances: s.affordances } }
          : nd;  // synthetic unexplored node — leave data as-is
      }));
      setEdges(laid.edges);
    }).catch((e) => {
      if (String(e).includes('404')) setEmpty(true);
      else setError(String(e));
    });
  }, [id]);

  // Hover highlight: when a node is hovered, fully show it + its neighbors + the
  // edges touching it, and dim everything else. No hover → everything full.
  const neighbors = useMemo(() => neighborSet(hovered, edges.map((e) => ({ source: e.source, target: e.target }))), [hovered, edges]);

  const shownNodes = useMemo(() => nodes.map((n) => ({
    ...n,
    style: { ...(n.style || {}), opacity: nodeOpacity(n.id, neighbors, DIM), transition: 'opacity 120ms' },
  })), [nodes, neighbors]);

  // FloatingEdge/SelfLoopEdge read their opacity from data.dimmed (not style), so
  // dimming is threaded through edge data here.
  const shownEdges = useMemo(() => edges.map((e) => {
    const active = edgeActive({ source: e.source, target: e.target }, hovered);
    return { ...e, data: { ...(e.data || {}), dimmed: !active } };
  }), [edges, hovered]);

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
            onNodeMouseEnter={(_, n) => setHovered(n.id)}
            onNodeMouseLeave={() => setHovered(null)}>
            <Background /><Controls /><MiniMap />
          </ReactFlow>}
    </div>
  );
}
