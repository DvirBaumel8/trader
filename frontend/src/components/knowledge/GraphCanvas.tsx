import { useMemo, useRef, useState } from 'react';
import {
  Background,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getViewportForBounds,
  useReactFlow,
  type ReactFlowInstance,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { KnowledgeEdge, KnowledgeNode } from '../../api/knowledge';
import { edgeLabelAnchor, layoutGraph, NODE_HEIGHT, NODE_WIDTH } from './layout';
import { NodeSheet, type Neighbour } from './NodeSheet';

type KgData = { title: string; isNew: boolean };

function KgNode({ id, data, selected }: NodeProps<Node<KgData>>) {
  return (
    <div
      data-testid={`kg-node-${id}`}
      className={`flex max-w-[160px] items-center justify-center rounded-lg border bg-surface-1 px-2 py-1.5 text-center text-[13px] leading-tight ${
        data.isNew ? 'border-accent ring-2 ring-accent' : 'border-border'
      } ${selected ? 'bg-accent/15' : ''}`}
      style={{ width: NODE_WIDTH, minHeight: NODE_HEIGHT }}
    >
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      {data.isNew && (
        <span className="absolute -top-2 right-1 rounded bg-accent px-1 text-[9px] font-semibold text-surface-0">
          new
        </span>
      )}
      <span className="line-clamp-2 break-words">{data.title}</span>
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  );
}

/** Bezier edge whose label sits just before the child, on its own line per incoming edge. */
function KgEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, label, data }: EdgeProps) {
  const slot = (data as { slot?: number } | undefined)?.slot ?? 0;
  const anchor = edgeLabelAnchor(targetX, targetY, slot);
  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  return (
    <>
      <BaseEdge id={id} path={path} />
      {label && (
        <EdgeLabelRenderer>
          <div
            data-testid="kg-edge-label"
            className="nodrag nopan pointer-events-none absolute block max-w-[80px] truncate rounded bg-surface-0 px-1 text-[10px] text-text"
            style={{ transform: `translate(-100%, -50%) translate(${anchor.x}px, ${anchor.y}px)` }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { kg: KgNode };
const edgeTypes = { kg: KgEdge };

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
  const boxRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
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
    () => {
      const seen = new Map<string, number>();
      return edges.map((e) => {
        const slot = seen.get(e.to) ?? 0;
        seen.set(e.to, slot + 1);
        return { id: `${e.from}->${e.to}`, source: e.from, target: e.to, label: e.label, type: 'kg', data: { slot } };
      });
    },
    [edges],
  );

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const selected = selectedId ? byId.get(selectedId) : undefined;
  const neighbours: Neighbour[] = useMemo(() => {
    if (!selectedId) return [];
    const out: Neighbour[] = [];
    for (const e of edges) {
      const otherId: string | null = e.from === selectedId ? e.to : e.to === selectedId ? e.from : null;
      if (!otherId || otherId === selectedId) continue;
      const other = byId.get(otherId);
      if (!other) continue;
      const existing = out.find((n) => n.node.id === otherId);
      if (!existing) out.push({ node: other, label: e.label });
      else if (!existing.label.split(' / ').includes(e.label)) existing.label += ` / ${e.label}`;
    }
    return out;
  }, [edges, byId, selectedId]);

  const FIT = { padding: 0.15, maxZoom: 1.2 };

  /** Fit if that stays readable (zoom >= 0.6); otherwise open on the summary. */
  const initialView = (rf: ReactFlowInstance<Node<KgData>, Edge>) => {
    const box = boxRef.current;
    if (!box) return;
    const w = box.clientWidth;
    const h = box.clientHeight;
    const ps = Object.values(positions);
    const minX = Math.min(...ps.map((p) => p.x));
    const minY = Math.min(...ps.map((p) => p.y));
    const bounds = {
      x: minX,
      y: minY,
      width: Math.max(...ps.map((p) => p.x)) + NODE_WIDTH - minX,
      height: Math.max(...ps.map((p) => p.y)) + NODE_HEIGHT - minY,
    };
    const vp = getViewportForBounds(bounds, w, h, 0.1, FIT.maxZoom, FIT.padding);
    if (vp.zoom >= 0.6) {
      rf.setViewport(vp);
      return;
    }
    const z = 0.9;
    const sp = positions['summary'] ?? ps[0];
    rf.setViewport({ x: 16 - sp.x * z, y: h / 2 - (sp.y + NODE_HEIGHT / 2) * z, zoom: z });
  };

  const selectAndCentre = (id: string) => {
    setSelectedId(id);
    const p = positions[id];
    if (!p) return;
    const zoom = Math.max(getZoom(), 0.8);
    // Centre in the part of the canvas the open sheet leaves uncovered.
    const box = boxRef.current?.getBoundingClientRect();
    const sheet = sheetRef.current?.getBoundingClientRect();
    const covered = box && sheet ? Math.max(0, box.bottom - sheet.top) : 0;
    setCenter(p.x + NODE_WIDTH / 2, p.y + NODE_HEIGHT / 2 + covered / 2 / zoom, { zoom, duration: 250 });
  };

  return (
    <div ref={boxRef} className="relative" style={{ height: 'calc(100dvh - 210px)', minHeight: 320, touchAction: 'none' }}>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={initialView}
        minZoom={0.1}
        panOnDrag
        zoomOnPinch
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        deleteKeyCode={null}
        onNodeClick={(_, node) => setSelectedId(node.id)}
        onPaneClick={() => setSelectedId(null)}
        colorMode="dark"
        style={{ background: 'var(--color-surface-0)', '--xy-background-color': 'var(--color-surface-0)' } as React.CSSProperties}
      >
        <Background color="var(--color-border)" />
      </ReactFlow>
      <button
        type="button"
        data-testid="kg-fit"
        onClick={() => fitView({ ...FIT, duration: 250 })}
        className="absolute left-2 top-2 z-10 rounded-lg border border-border bg-surface-1 px-3 py-1.5 text-sm"
      >
        Fit
      </button>
      {selected && (
        <NodeSheet
          key={selected.id}
          sheetRef={sheetRef}
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
