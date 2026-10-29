/** Prints a knowledge graph as an indented tree for the terminal. */
import { ROOT_ID } from '../../src/knowledge/graph.js';
import type { GraphInput, NodeInput } from '../../src/knowledge/graph.js';

const INDENT = '    ';
const WIDTH = 88;

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + word.length > width) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    lines.push(line);
  }
  return lines;
}

function describe(n: NodeInput): string {
  return `${n.title} [${n.id}]${n.asOf ? ` (${n.asOf})` : ''}`;
}

export function renderTree(g: GraphInput, opts: { full: boolean }): string {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const out: string[] = [];
  const visited = new Set<string>();
  const extra: string[] = [];

  const body = (n: NodeInput, depth: number): void => {
    if (!opts.full) return;
    const pad = INDENT.repeat(depth) + '   ';
    if (n.question) out.push(`${pad}Q: ${n.question}`);
    for (const line of wrap(n.text, WIDTH - pad.length)) if (line) out.push(pad + line);
    for (const s of n.sources ?? []) out.push(`${pad}- ${s.label}: ${s.url}`);
  };

  const walk = (id: string, depth: number): void => {
    for (const e of g.edges) {
      if (e.from !== id) continue;
      const child = byId.get(e.to);
      if (!child) continue;
      if (visited.has(e.to)) {
        extra.push(`↪ ${e.from} → ${e.to} (${e.label})`);
        continue;
      }
      visited.add(e.to);
      out.push(`${INDENT.repeat(depth)}── ${e.label} → ${describe(child)}`);
      body(child, depth + 1);
      walk(e.to, depth + 1);
    }
  };

  const root = byId.get(ROOT_ID);
  if (root) {
    visited.add(ROOT_ID);
    out.push(describe(root));
    body(root, 0);
    walk(ROOT_ID, 0);
  }
  return [...out, ...extra].join('\n');
}
