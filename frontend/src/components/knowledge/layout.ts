import dagre from '@dagrejs/dagre';

export const NODE_WIDTH = 160;
export const NODE_HEIGHT = 44;

/** Left-to-right layout. Returns the top-left corner of every node. */
export function layoutGraph(
  nodes: { id: string }[],
  edges: { from: string; to: string }[],
): Record<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', ranksep: 90, nodesep: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const e of edges) g.setEdge(e.from, e.to);
  dagre.layout(g);
  const out: Record<string, { x: number; y: number }> = {};
  for (const n of nodes) {
    const p = g.node(n.id);
    out[n.id] = { x: p.x - NODE_WIDTH / 2, y: p.y - NODE_HEIGHT / 2 };
  }
  return out;
}

/**
 * Where an edge's label is right-aligned: just before the child. Edges into
 * the same node take their own line (alternating below/above, label height
 * is ~13px), so labels never coincide.
 */
export function edgeLabelAnchor(tx: number, ty: number, slot: number): { x: number; y: number } {
  const dy = (slot % 2 ? 1 : -1) * 16 * Math.ceil(slot / 2);
  return { x: tx - 6, y: ty + dy };
}
