/**
 * The knowledge-graph format and its rules. Pure on purpose (no Nest or
 * TypeORM imports): the `kb` command-line tool imports this file too.
 */

export interface Source {
  label: string;
  url: string;
}
export type NodeType = 'text' | 'fundamentals';
export interface NodeInput {
  id: string;
  title: string;
  text: string;
  type?: NodeType;
  asOf?: string;
  question?: string;
  sources?: Source[];
}
export interface GraphNode extends NodeInput {
  createdAt: string;
  updatedAt: string;
}
export interface Edge {
  from: string;
  to: string;
  label: string;
}
export interface GraphInput {
  nodes: NodeInput[];
  edges: Edge[];
}

export const ROOT_ID = 'summary';
export const MAX_NODES = 300;
export const MAX_EDGES = 600;

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_SOURCES = 10;

function badLength(value: unknown, min: number, max: number): boolean {
  return typeof value !== 'string' || value.length < min || value.length > max;
}

function validUrl(url: unknown): boolean {
  return typeof url === 'string' && url.length <= 500 && /^https?:\/\/\S+$/i.test(url);
}

/** Human-readable problems with the graph; empty when it is valid. */
export function validateGraph(g: GraphInput): string[] {
  const errors: string[] = [];

  if (g.nodes.length > MAX_NODES) errors.push(`too many nodes (${g.nodes.length}, max ${MAX_NODES})`);
  if (g.edges.length > MAX_EDGES) errors.push(`too many edges (${g.edges.length}, max ${MAX_EDGES})`);

  const ids = new Set<string>();
  let fundamentals = 0;
  for (const n of g.nodes) {
    if (typeof n.id !== 'string' || !ID_PATTERN.test(n.id)) {
      errors.push(`node "${String(n.id)}": invalid id (lower-case letters, digits and dashes, up to 40 characters)`);
    } else if (ids.has(n.id)) {
      errors.push(`duplicate node id "${n.id}"`);
    }
    ids.add(n.id);

    const where = `node ${n.id}`;
    const isFundamentals = n.type === 'fundamentals';
    if (n.type !== undefined && n.type !== 'text' && n.type !== 'fundamentals') {
      errors.push(`${where}: unknown type "${String(n.type)}"`);
    }
    if (isFundamentals) fundamentals++;
    if (badLength(n.title, 1, 80)) errors.push(`${where}: title must be 1 to 80 characters`);
    if (badLength(n.text, isFundamentals ? 0 : 1, 1500)) {
      errors.push(`${where}: text must be ${isFundamentals ? '0' : '1'} to 1500 characters`);
    }
    if (n.question !== undefined && badLength(n.question, 0, 300)) {
      errors.push(`${where}: question must be at most 300 characters`);
    }
    if (n.asOf !== undefined && badLength(n.asOf, 1, 40)) {
      errors.push(`${where}: asOf must be 1 to 40 characters`);
    }
    if (n.sources !== undefined) {
      if (!Array.isArray(n.sources) || n.sources.length > MAX_SOURCES) {
        errors.push(`${where}: sources must be a list of at most ${MAX_SOURCES}`);
      } else {
        for (const s of n.sources) {
          if (badLength(s?.label, 1, 80)) errors.push(`${where}: source label must be 1 to 80 characters`);
          if (!validUrl(s?.url)) errors.push(`${where}: source url must be an http(s) link of at most 500 characters`);
        }
      }
    }
  }
  if (!ids.has(ROOT_ID)) errors.push(`missing the "${ROOT_ID}" node`);
  if (fundamentals > 1) errors.push('at most one fundamentals node');

  const seen = new Set<string>();
  for (const e of g.edges) {
    const name = `edge ${e.from}→${e.to}`;
    let ok = true;
    for (const end of [e.from, e.to]) {
      if (!ids.has(end)) {
        errors.push(`${name}: unknown node "${end}"`);
        ok = false;
      }
    }
    if (badLength(e.label, 1, 40)) errors.push(`${name}: label must be 1 to 40 characters`);
    if (!ok) continue;
    if (e.from === e.to) {
      errors.push(`${name}: self-loop`);
      continue;
    }
    const key = `${e.from}\u0000${e.to}`;
    if (seen.has(key)) errors.push(`${name}: duplicate`);
    seen.add(key);
  }

  if (ids.has(ROOT_ID)) {
    const reachable = reachableFromRoot(g.nodes, g.edges);
    for (const id of ids) {
      if (!reachable.has(id)) errors.push(`node ${id}: not reachable from "${ROOT_ID}"`);
    }
  }
  return errors;
}

/** Node ids reachable from `summary` following edges from → to. */
export function reachableFromRoot(nodes: { id: string }[], edges: Edge[]): Set<string> {
  const known = new Set(nodes.map((n) => n.id));
  const out = new Map<string, string[]>();
  for (const e of edges) {
    const list = out.get(e.from) ?? [];
    list.push(e.to);
    out.set(e.from, list);
  }
  const reached = new Set<string>();
  if (!known.has(ROOT_ID)) return reached;
  const stack = [ROOT_ID];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (reached.has(id)) continue;
    reached.add(id);
    for (const next of out.get(id) ?? []) if (known.has(next) && !reached.has(next)) stack.push(next);
  }
  return reached;
}

function contentKey(n: NodeInput): string {
  return JSON.stringify([
    n.title,
    n.text,
    n.type ?? 'text',
    n.asOf ?? null,
    n.question ?? null,
    (n.sources ?? []).map((s) => [s.label, s.url]),
  ]);
}

/**
 * Server-owned timestamps: a node keeps `createdAt`, and `updatedAt` moves
 * only when its content changed or it is new. Any timestamps the caller sent
 * are ignored.
 */
export function stampNodes(next: NodeInput[], prev: GraphNode[], now: string): GraphNode[] {
  const before = new Map(prev.map((n) => [n.id, n]));
  return next.map((input) => {
    const { id, title, text, type, asOf, question, sources } = input;
    const node: NodeInput = { id, title, text };
    if (type !== undefined) node.type = type;
    if (asOf !== undefined) node.asOf = asOf;
    if (question !== undefined) node.question = question;
    if (sources !== undefined) node.sources = sources.map((s) => ({ label: s.label, url: s.url }));
    const old = before.get(id);
    if (!old) return { ...node, createdAt: now, updatedAt: now };
    const changed = contentKey(node) !== contentKey(old);
    return { ...node, createdAt: old.createdAt, updatedAt: changed ? now : old.updatedAt };
  });
}

/** A node is new when it changed after the graph was last viewed (never viewed: all are new). */
export function isNew(node: GraphNode, lastViewedAt: string | null): boolean {
  if (lastViewedAt === null) return true;
  return Date.parse(node.updatedAt) > Date.parse(lastViewedAt);
}
