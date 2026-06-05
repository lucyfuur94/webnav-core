import { useEffect, useState } from 'react';
import { ReactFlow, Background, Controls, MiniMap, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { fetchInterior } from './api.js';
import { layoutGraph } from './layout.js';
import { isForkEdge } from './forkEdge.js';
import { StateNode } from './nodes/StateNode.js';

const nodeTypes = { state: StateNode };

export function InteriorView({ id, onBack }: { id: string; onBack: () => void }) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // A 404 (unknown node) throws in fetchInterior — distinguish that "no
    // interior yet" case from a real API failure so the message isn't misleading.
    fetchInterior(id).then(async (iv) => {
      if (!iv.states.length) { setEmpty(true); return; }
      const ln = iv.states.map((s) => ({ id: s.id, label: s.semanticName }));
      const le = iv.edges.map((e, i) => ({ id: `e${i}`, source: e.from, target: e.to, fork: isForkEdge(e) }));
      const laid = await layoutGraph(ln, le, 'interior');
      const meta = new Map(iv.states.map((s) => [s.id, s]));
      setNodes(laid.nodes.map((nd) => {
        const s = meta.get(nd.id);
        return { ...nd, data: { ...nd.data, role: s?.role, signals: s?.availableSignals } };
      }));
      setEdges(laid.edges);
    }).catch((e) => {
      // 404 → treat as "no interior yet"; any other failure → surface as an error.
      if (String(e).includes('404')) setEmpty(true);
      else setError(String(e));
    });
  }, [id]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <button onClick={onBack} style={{ position: 'absolute', zIndex: 10, top: 12, left: 12,
        padding: '6px 10px', fontFamily: 'sans-serif', cursor: 'pointer' }}>← back to map</button>
      {error
        ? <div style={{ padding: 24, paddingTop: 56, fontFamily: 'sans-serif', color: '#334155' }}>Couldn't load the interior for <b>{id}</b>: {error}</div>
        : empty
        ? <div style={{ padding: 24, paddingTop: 56, fontFamily: 'sans-serif' }}>No interior recorded for <b>{id}</b> yet. Map it with a record session.</div>
        : <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView>
            <Background /><Controls /><MiniMap />
          </ReactFlow>}
    </div>
  );
}
