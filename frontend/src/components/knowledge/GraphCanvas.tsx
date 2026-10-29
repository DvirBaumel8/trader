import { useMemo, useState } from 'react';
import {
  Background,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { KnowledgeEdge, KnowledgeNode } from '../../api/knowledge';
import { layoutGraph, NODE_HEIGHT, NODE_WIDTH } from './layout';
import { NodeSheet, type Neighbour } from './NodeSheet';

type KgData = { title: string; isNew: boolean };

function KgNode({ id, data, selected }: NodeProps<Node<KgData>>) {
  return (
    <div
      data-testid={`kg-node-${id}`}
      className={`max-w-[160px] rounded-lg border bg-surface-1 px-2 py-1.5 text-center text-xs ${
        data.isNew ? 'border-accent ring-2 ring-accent' : 'border-border'
      } ${selected ? 'bg-accent/15' : ''}`}
      style={{ width: NODE_WIDTH, minHeight: NODE_HEIGHT }}
    >
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      {data.isNew && (
        <span className="absolute -top-2 right-1 rounded bg-accent px-1 text-[9px] font-semibold text-surface-0">
          new
        </span>
      )}
      <span className="line-clamp-2 break-words">{data.title}</span>
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
    </div>
  );
}

const nodeTypes = { kg: KgNode };

function Inner({
  nodes,
  edges,
  newIds,
}: {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  newIds: Set<string>;
}) {
  const { fitView, setCenter, getZoom } = useReactFlow();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const positions = useMemo(() => layoutGraph(nodes, edges), [nodes, edges]);

  const flowNodes: Node<KgData>[] = useMemo(
    () =>
      nodes.map((n) => ({
        id: n.id,
        type: 'kg',
        position: positions[n.id],
        selected: n.id === selectedId,
        data: { title: n.title, isNew: newIds.has(n.id) },
      })),
    [nodes, positions, newIds, selectedId],
  );
  const flowEdges: Edge[] = useMemo(
    () =>
      edges.map((e) => ({
        id: `${e.from}->${e.to}`,
        source: e.from,
        target: e.to,
        label: e.label,
        type: 'smoothstep',
        labelStyle: { fontSize: 10 },
      })),
    [edges],
  );

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const selected = selectedId ? byId.get(selectedId) : undefined;
  const neighbours: Neighbour[] = useMemo(() => {
    if (!selectedId) return [];
    const out: Neighbour[] = [];
    for (const e of edges) {
      const otherId = e.from === selectedId ? e.to : e.to === selectedId ? e.from : null;
      const other = otherId ? byId.get(otherId) : undefined;
      if (other) out.push({ node: other, label: e.label });
    }
    return out;
  }, [edges, byId, selectedId]);

  const selectAndCentre = (id: string) => {
    setSelectedId(id);
    const p = positions[id];
    if (p) setCenter(p.x + NODE_WIDTH / 2, p.y + NODE_HEIGHT / 2, { zoom: Math.max(getZoom(), 0.8), duration: 250 });
  };

  return (
    <div className="relative" style={{ height: 'calc(100dvh - 210px)', minHeight: 320, touchAction: 'none' }}>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.2}
        panOnDrag
        zoomOnPinch
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        deleteKeyCode={null}
        onNodeClick={(_, node) => setSelectedId(node.id)}
        onPaneClick={() => setSelectedId(null)}
        colorMode="dark"
      >
        <Background />
      </ReactFlow>
      <button
        type="button"
        data-testid="kg-fit"
        onClick={() => fitView({ duration: 250 })}
        className="absolute left-2 top-2 z-10 rounded-lg border border-border bg-surface-1 px-3 py-1.5 text-sm"
      >
        Fit
      </button>
      {selected && (
        <NodeSheet
          node={selected}
          neighbours={neighbours}
          onSelect={selectAndCentre}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

export function GraphCanvas(props: { nodes: KnowledgeNode[]; edges: KnowledgeEdge[]; newIds: Set<string> }) {
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  );
}
