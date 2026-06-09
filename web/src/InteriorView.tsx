import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, applyNodeChanges,
  useNodesInitialized, useReactFlow,
  type Node, type Edge, type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { fetchInterior } from './api.js';
import { layoutGraph } from './layout.js';
import { isForkEdge } from './forkEdge.js';
import { synthesizeRevealSubNodes, buildLayoutNodes, buildLayoutEdges } from './revealSubnodes.js';
import { StateNode } from './nodes/StateNode.js';
import { UnexploredNode } from './nodes/UnexploredNode.js';
import { RoutedEdge, SelfLoopEdge, type ConnectorShape } from './edges/RoutedEdge.js';
import { neighborSet, nodeOpacity, edgeActive } from './highlight.js';
import type { NodeInteriorView } from './types.js';

const nodeTypes = { state: StateNode, unexplored: UnexploredNode };
const edgeTypes = { routed: RoutedEdge, selfloop: SelfLoopEdge };
const DIM = 0.18;   // opacity for nodes NOT adjacent to the hovered node

const SHAPES: ConnectorShape[] = ['step', 'curved', 'straight'];
const SHAPE_LABEL: Record<ConnectorShape, string> = {
  step: 'Step', curved: 'Curved', straight: 'Straight',
};

// Inner component — runs INSIDE a ReactFlowProvider so it can use useReactFlow /
// useNodesInitialized for the measured two-pass layout.
function InteriorViewInner({ id, onBack }: { id: string; onBack: () => void }) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  // id of the edge currently hovered. When set, that edge is highlighted and
  // everything else (other edges + non-endpoint nodes) is dimmed.
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  // Connector shape for ALL edges (Change 2): step (ELK-routed, around boxes),
  // curved (bezier, point-to-point), straight. Default 'step'.
  const [shape, setShape] = useState<ConnectorShape>('step');
  // Per-node expanded reveal overlays (Change 3). Keyed 'stateId::affId'. Empty =
  // every overlay collapsed (default). Toggling re-runs layout so the overlay
  // sub-node + its edges appear/disappear.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Keep the raw interior data so a reveal toggle can re-layout without re-fetching.
  const ivRef = useRef<NodeInteriorView | null>(null);
  // True after an ESTIMATED-size layout, until the measured re-layout has run.
  // Gates the measure-pass effect so it re-lays out exactly ONCE per data/expand.
  const measurePending = useRef(false);

  const nodesInitialized = useNodesInitialized();
  const { getNodes, fitView } = useReactFlow();

  // Let the user DRAG nodes around: React Flow emits position/selection changes;
  // apply them back to our base `nodes` state.
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );

  // Toggle an overlay open/closed for a given parent state. `affId` is the raw
  // reveal affordance id on that node; we scope the key by the node id so the same
  // affordance id on two nodes toggles independently.
  const onToggleReveal = useCallback((stateId: string, affId: string) => {
    setExpanded((prev) => {
      const key = stateId + '::' + affId;
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // Build (or rebuild) the laid-out graph from the raw interior + current expanded
  // set. Re-runs whenever the interior loads or an overlay is toggled.
  //
  // TWO-PASS (documented pattern): the first call has no `measured` map, so ELK
  // lays out with ESTIMATED node sizes (badges) — good enough to render. Once React
  // Flow has measured the rendered nodes, the measure-pass effect calls this again
  // with a `measured` map of the true {w,h}, so ELK re-runs with exact sizes and its
  // ports/edge-routes land precisely. `measurePending` gates the re-run to once.
  const buildGraph = useCallback(async (iv: NodeInteriorView, measured?: Map<string, { w: number; h: number }>) => {
    const isExpanded = (ownerId: string, affId: string) => expanded.has(ownerId + '::' + affId);

    // ── Reveal sub-node synthesis (VIEWER-ONLY; see revealSubnodes.ts) ──
    // Overlays are COLLAPSED by default; a sub-node + its edges are materialised
    // ONLY for an expanded reveal. Collapsed overlay child edges are dropped.
    const { subStates, revealEdges, childOwner, overlayChildIds } =
      synthesizeRevealSubNodes(iv.states, isExpanded);
    const ln = buildLayoutNodes(iv.states, subStates).map((n) => {
      const m = measured?.get(n.id);
      return m ? { ...n, w: m.w, h: m.h } : n;
    });
    const le = buildLayoutEdges(iv.edges, revealEdges, childOwner, isForkEdge, overlayChildIds);

    // On the estimated (first) pass, a measured re-layout is still owed.
    measurePending.current = !measured;
    const laid = await layoutGraph(ln, le, 'interior');
    const meta = new Map<string, { role: string; availableSignals: string[]; affordances: any[]; sub?: boolean }>(
      iv.states.map((s) => [s.id, { role: s.role, availableSignals: s.availableSignals, affordances: s.affordances }]),
    );
    for (const s of subStates) meta.set(s.id, { role: s.role, availableSignals: s.availableSignals, affordances: s.affordances, sub: true });

    setNodes(laid.nodes.map((nd) => {
      const s = meta.get(nd.id);
      if (!s) return nd;  // synthetic unexplored node — leave data as-is
      // expandedReveals for THIS node: the raw aff ids expanded on it.
      const nodeExpanded = new Set<string>();
      for (const key of expanded) {
        const sep = key.lastIndexOf('::');
        if (sep > 0 && key.slice(0, sep) === nd.id) nodeExpanded.add(key.slice(sep + 2));
      }
      return {
        ...nd,
        data: {
          ...nd.data, role: s.role, signals: s.availableSignals, affordances: s.affordances,
          sub: s.sub === true,
          expandedReveals: nodeExpanded,
          onToggleReveal: (affId: string) => onToggleReveal(nd.id, affId),
        },
      };
    }));
    setEdges(laid.edges);
  }, [expanded, onToggleReveal]);

  useEffect(() => {
    // A 404 (unknown node) throws in fetchInterior — distinguish "no interior yet"
    // from a real API failure.
    fetchInterior(id).then(async (iv) => {
      if (!iv.states.length) { setEmpty(true); return; }
      ivRef.current = iv;
      await buildGraph(iv);
    }).catch((e) => {
      if (String(e).includes('404')) setEmpty(true);
      else setError(String(e));
    });
    // buildGraph is intentionally NOT a dep here — the toggle effect handles rebuilds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Rebuild the graph when an overlay is expanded/collapsed (raw data is cached).
  useEffect(() => {
    if (ivRef.current) void buildGraph(ivRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  // MEASURE PASS (documented two-pass): once React Flow has measured the rendered
  // nodes, read their true sizes and re-run the layout ONCE with them so ELK's
  // ports + edge routes land on the real borders. `measurePending` ensures this
  // fires only after an estimated pass (not after the measured re-layout itself,
  // which would loop).
  useEffect(() => {
    if (!nodesInitialized || !measurePending.current || !ivRef.current) return;
    measurePending.current = false;   // consume — the re-layout below is the measured one
    const measured = new Map<string, { w: number; h: number }>();
    for (const n of getNodes()) {
      const w = n.measured?.width, h = n.measured?.height;
      if (w && h) measured.set(n.id, { w, h });
    }
    if (measured.size) {
      void buildGraph(ivRef.current, measured).then(() => fitView({ padding: 0.18 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodesInitialized, nodes]);

  // The two endpoints of the hovered edge (for node dimming when an edge is hovered).
  const edgeEndpoints = useMemo(() => {
    if (!hoveredEdge) return null;
    const e = edges.find((x) => x.id === hoveredEdge);
    return e ? new Set<string>([e.source, e.target]) : null;
  }, [hoveredEdge, edges]);

  const neighbors = useMemo(() => neighborSet(hovered, edges.map((e) => ({ source: e.source, target: e.target }))), [hovered, edges]);

  const shownNodes = useMemo(() => nodes.map((n) => {
    const opacity = edgeEndpoints
      ? (edgeEndpoints.has(n.id) ? 1 : DIM)
      : nodeOpacity(n.id, neighbors, DIM);
    return { ...n, style: { ...(n.style || {}), opacity, transition: 'opacity 120ms' } };
  }), [nodes, neighbors, edgeEndpoints]);

  // Edges read opacity + the hovered flag + the connector SHAPE from data.
  const shownEdges = useMemo(() => edges.map((e) => {
    const base = { ...(e.data || {}), shape };
    if (hoveredEdge) {
      const isHovered = e.id === hoveredEdge;
      return { ...e, data: { ...base, dimmed: !isHovered, hovered: isHovered } };
    }
    const active = edgeActive({ source: e.source, target: e.target }, hovered);
    return { ...e, data: { ...base, dimmed: !active, hovered: false } };
  }), [edges, hovered, hoveredEdge, shape]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <button onClick={onBack} style={{ position: 'absolute', zIndex: 10, top: 12, left: 12,
        padding: '6px 10px', fontFamily: 'sans-serif', cursor: 'pointer' }}>← back to map</button>

      {/* Connector-shape toggle (Change 2): segmented control, top-right. */}
      {!error && !empty ? (
        <div style={{ position: 'absolute', zIndex: 10, top: 12, right: 12, display: 'flex',
          alignItems: 'center', gap: 6, fontFamily: 'sans-serif' }}>
          <span style={{ fontSize: 11, color: '#64748b' }}>connector</span>
          <div role="group" aria-label="connector shape" style={{ display: 'inline-flex',
            border: '1px solid #cbd5e1', borderRadius: 8, overflow: 'hidden', background: '#fff',
            boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }}>
            {SHAPES.map((s, i) => {
              const active = s === shape;
              return (
                <button
                  key={s}
                  aria-pressed={active}
                  onClick={() => setShape(s)}
                  style={{
                    padding: '5px 12px', fontSize: 12, cursor: 'pointer', border: 'none',
                    borderLeft: i === 0 ? 'none' : '1px solid #e2e8f0',
                    background: active ? '#1d4ed8' : 'transparent',
                    color: active ? '#fff' : '#334155',
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  {SHAPE_LABEL[s]}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {error
        ? <div style={{ padding: 24, paddingTop: 56, fontFamily: 'sans-serif', color: '#334155' }}>Couldn't load the interior for <b>{id}</b>: {error}</div>
        : empty
        ? <div style={{ padding: 24, paddingTop: 56, fontFamily: 'sans-serif' }}>No interior recorded for <b>{id}</b> yet. Map it with a record session.</div>
        : <ReactFlow nodes={shownNodes} edges={shownEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
            fitView fitViewOptions={{ padding: 0.18 }} minZoom={0.05}
            onNodesChange={onNodesChange}
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

// Public component: wraps the inner view in a ReactFlowProvider so it can use
// useReactFlow / useNodesInitialized for the measured two-pass layout.
export function InteriorView(props: { id: string; onBack: () => void }): JSX.Element {
  return (
    <ReactFlowProvider>
      <InteriorViewInner {...props} />
    </ReactFlowProvider>
  );
}
