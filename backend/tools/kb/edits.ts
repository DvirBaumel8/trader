/**
 * Pure graph edits for the `kb` tool. Each returns a new graph or throws an
 * Error whose message is shown to the user. Nothing here touches the network.
 */
import { ROOT_ID, reachableFromRoot, validateGraph } from '../../src/knowledge/graph.js';
import type { Edge, GraphInput, NodeInput, Source } from '../../src/knowledge/graph.js';

function checked(g: GraphInput): GraphInput {
  const errors = validateGraph(g);
  if (errors.length > 0) throw new Error(errors.join('\n'));
  return g;
}

function copy(g: GraphInput): GraphInput {
  return structuredClone({ nodes: g.nodes, edges: g.edges });
}

function need(g: GraphInput, id: string): NodeInput {
  const node = g.nodes.find((n) => n.id === id);
  if (!node) throw new Error(`unknown node "${id}"`);
  return node;
}

function descendants(g: GraphInput, id: string): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const e of g.edges) {
      if (e.from === cur && !out.has(e.to)) {
        out.add(e.to);
        stack.push(e.to);
      }
    }
  }
  return out;
}

export function start(input: { title: string; text: string; sources?: Source[] }): GraphInput {
  const node: NodeInput = { id: ROOT_ID, title: input.title, text: input.text };
  if (input.sources && input.sources.length > 0) node.sources = input.sources;
  return checked({ nodes: [node], edges: [] });
}

export function addNode(
  g: GraphInput,
  a: {
    under: string;
    id: string;
    label: string;
    title: string;
    text: string;
    type?: NodeInput['type'];
    asOf?: string;
    question?: string;
    sources?: Source[];
  },
): GraphInput {
  need(g, a.under);
  if (g.nodes.some((n) => n.id === a.id)) throw new Error(`node "${a.id}" already exists`);
  const next = copy(g);
  const node: NodeInput = { id: a.id, title: a.title, text: a.text };
  if (a.type !== undefined) node.type = a.type;
  if (a.asOf !== undefined && a.asOf !== '') node.asOf = a.asOf;
  if (a.question !== undefined) node.question = a.question;
  if (a.sources !== undefined && a.sources.length > 0) node.sources = a.sources;
  next.nodes.push(node);
  next.edges.push({ from: a.under, to: a.id, label: a.label });
  return checked(next);
}

export function editNode(g: GraphInput, id: string, patch: Partial<Omit<NodeInput, 'id'>>): GraphInput {
  need(g, id);
  const next = copy(g);
  const node = next.nodes.find((n) => n.id === id)!;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if ((key === 'asOf' || key === 'question') && value === '') {
      delete node[key];
    } else {
      (node as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return checked(next);
}

export function link(g: GraphInput, from: string, to: string, label: string): GraphInput {
  const next = copy(g);
  next.edges.push({ from, to, label });
  return checked(next);
}

export function unlink(g: GraphInput, from: string, to: string): GraphInput {
  if (!g.edges.some((e) => e.from === from && e.to === to)) throw new Error(`no edge ${from} → ${to}`);
  const next = copy(g);
  next.edges = next.edges.filter((e) => !(e.from === from && e.to === to));
  return checked(next);
}

export function moveNode(g: GraphInput, id: string, to: { under: string; label?: string }): GraphInput {
  if (id === ROOT_ID) throw new Error(`"${ROOT_ID}" cannot be moved`);
  need(g, id);
  need(g, to.under);
  if (to.under === id) throw new Error('a node cannot be moved under itself');
  if (descendants(g, id).has(to.under)) throw new Error(`cannot move "${id}" under its own descendant "${to.under}"`);
  const next = copy(g);
  const label = to.label ?? next.edges.find((e) => e.to === id)?.label;
  if (label === undefined) throw new Error(`"${id}" has no incoming edge; pass --label`);
  next.edges = next.edges.filter((e) => e.to !== id);
  next.edges.push({ from: to.under, to: id, label });
  return checked(next);
}

export function removeNode(g: GraphInput, id: string, withChildren: boolean): GraphInput {
  if (id === ROOT_ID) throw new Error(`"${ROOT_ID}" cannot be removed (use delete to remove the whole graph)`);
  need(g, id);
  const drop = new Set([id]);
  const rest = (): GraphInput => ({
    nodes: g.nodes.filter((n) => !drop.has(n.id)),
    edges: g.edges.filter((e: Edge) => !drop.has(e.from) && !drop.has(e.to)),
  });
  let next = rest();
  const reached = reachableFromRoot(next.nodes, next.edges);
  const orphans = next.nodes.filter((n) => !reached.has(n.id)).map((n) => n.id);
  if (orphans.length > 0) {
    if (!withChildren) {
      throw new Error(
        `removing "${id}" would leave ${orphans.join(', ')} unconnected; use --with-children to remove them too`,
      );
    }
    for (const o of orphans) drop.add(o);
    next = rest();
  }
  return checked(next);
}
