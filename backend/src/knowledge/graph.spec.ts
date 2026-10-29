import { describe, expect, it } from 'vitest';
import {
  isNew,
  reachableFromRoot,
  stampNodes,
  validateGraph,
  type Edge,
  type GraphNode,
  type NodeInput,
} from './graph.js';

const node = (id: string, extra: Partial<NodeInput> = {}): NodeInput => ({
  id,
  title: `Title ${id}`,
  text: `Text of ${id}`,
  ...extra,
});
const edge = (from: string, to: string, label = 'link'): Edge => ({ from, to, label });
const base = () => ({ nodes: [node('summary'), node('a')], edges: [edge('summary', 'a')] });

describe('validateGraph', () => {
  it('accepts a summary-only graph', () => {
    expect(validateGraph({ nodes: [node('summary')], edges: [] })).toEqual([]);
  });

  it('accepts a small connected graph', () => {
    expect(validateGraph(base())).toEqual([]);
  });

  it('requires the summary node', () => {
    const errors = validateGraph({ nodes: [node('a')], edges: [] });
    expect(errors).toContain('missing the "summary" node');
  });

  it('rejects duplicate ids', () => {
    const g = { nodes: [node('summary'), node('a'), node('a')], edges: [edge('summary', 'a')] };
    expect(validateGraph(g)).toContain('duplicate node id "a"');
  });

  it('rejects a bad id pattern', () => {
    for (const id of ['Bad', '-x', 'a b', '', 'x'.repeat(41)]) {
      const g = { nodes: [node('summary'), node(id)], edges: [edge('summary', id)] };
      expect(validateGraph(g).join('|')).toContain('invalid id');
    }
  });

  it('enforces text field lengths', () => {
    const cases: [Partial<NodeInput>, string][] = [
      [{ title: '' }, 'title'],
      [{ title: 'x'.repeat(81) }, 'title'],
      [{ text: '' }, 'text'],
      [{ text: 'x'.repeat(1501) }, 'text'],
      [{ question: 'x'.repeat(301) }, 'question'],
      [{ asOf: '' }, 'asOf'],
      [{ asOf: 'x'.repeat(41) }, 'asOf'],
    ];
    for (const [extra, field] of cases) {
      const g = { nodes: [node('summary'), node('a', extra)], edges: [edge('summary', 'a')] };
      expect(validateGraph(g).join('|'), field).toContain(`node a: ${field}`);
    }
  });

  it('accepts the maximum lengths', () => {
    const g = {
      nodes: [
        node('summary'),
        node('a', { title: 'x'.repeat(80), text: 'x'.repeat(1500), question: 'x'.repeat(300), asOf: 'x'.repeat(40) }),
      ],
      edges: [edge('summary', 'a')],
    };
    expect(validateGraph(g)).toEqual([]);
  });

  it('checks sources: count, label, url scheme and length', () => {
    const ok = { label: 'SEC', url: 'https://sec.gov/x' };
    const bad = (sources: unknown) => ({
      nodes: [node('summary'), node('a', { sources: sources as never })],
      edges: [edge('summary', 'a')],
    });
    expect(validateGraph(bad([ok, { label: 'h', url: 'http://example.com' }]))).toEqual([]);
    expect(validateGraph(bad(Array(11).fill(ok))).join('|')).toContain('node a: sources');
    expect(validateGraph(bad([{ label: '', url: ok.url }])).join('|')).toContain('node a: source label');
    expect(validateGraph(bad([{ label: 'x'.repeat(81), url: ok.url }])).join('|')).toContain('node a: source label');
    expect(validateGraph(bad([{ label: 'x', url: 'javascript:alert(1)' }])).join('|')).toContain('node a: source url');
    expect(validateGraph(bad([{ label: 'x', url: 'ftp://x.com' }])).join('|')).toContain('node a: source url');
    expect(validateGraph(bad([{ label: 'x', url: 'https://x.com/' + 'a'.repeat(500) }])).join('|')).toContain('node a: source url');
  });

  it('rejects an unknown type', () => {
    const g = { nodes: [node('summary'), node('a', { type: 'chart' as never })], edges: [edge('summary', 'a')] };
    expect(validateGraph(g).join('|')).toContain('node a: unknown type');
  });

  it('allows empty text only on a fundamentals node', () => {
    const ok = { nodes: [node('summary'), node('f', { type: 'fundamentals', text: '' })], edges: [edge('summary', 'f')] };
    expect(validateGraph(ok)).toEqual([]);
    const bad = { nodes: [node('summary'), node('a', { text: '' })], edges: [edge('summary', 'a')] };
    expect(validateGraph(bad).join('|')).toContain('node a: text');
  });

  it('rejects two fundamentals nodes', () => {
    const g = {
      nodes: [node('summary'), node('f1', { type: 'fundamentals' }), node('f2', { type: 'fundamentals' })],
      edges: [edge('summary', 'f1'), edge('summary', 'f2')],
    };
    expect(validateGraph(g)).toContain('at most one fundamentals node');
  });

  it('names an unknown edge end', () => {
    const g = { nodes: [node('summary'), node('revenue')], edges: [edge('summary', 'revenue'), edge('revenue', 'gaming')] };
    expect(validateGraph(g)).toContain('edge revenue→gaming: unknown node "gaming"');
    const g2 = { nodes: [node('summary')], edges: [edge('ghost', 'summary')] };
    expect(validateGraph(g2)).toContain('edge ghost→summary: unknown node "ghost"');
  });

  it('rejects self-loops, duplicate edges, and bad edge labels', () => {
    const g = { ...base(), edges: [edge('summary', 'a'), edge('a', 'a')] };
    expect(validateGraph(g)).toContain('edge a→a: self-loop');
    const d = { ...base(), edges: [edge('summary', 'a'), edge('summary', 'a', 'again')] };
    expect(validateGraph(d)).toContain('edge summary→a: duplicate');
    for (const label of ['', 'x'.repeat(41)]) {
      const l = { ...base(), edges: [edge('summary', 'a', label)] };
      expect(validateGraph(l).join('|')).toContain('edge summary→a: label');
    }
  });

  it('rejects a node unreachable from summary', () => {
    const g = { nodes: [node('summary'), node('a')], edges: [edge('a', 'summary')] };
    expect(validateGraph(g)).toContain('node a: not reachable from "summary"');
  });

  it('enforces 300 nodes and 600 edges', () => {
    const ids = Array.from({ length: 300 }, (_, i) => `n${i}`);
    const nodes = [node('summary'), ...ids.slice(0, 299).map((id) => node(id))];
    const edges = nodes.slice(1).map((n) => edge('summary', n.id));
    expect(validateGraph({ nodes, edges })).toEqual([]);
    const over = { nodes: [...nodes, node('n299')], edges: [...edges, edge('summary', 'n299')] };
    expect(validateGraph(over)).toContain('too many nodes (301, max 300)');
    // 600 edges ok, 601 not
    const mk = (count: number): Edge[] => {
      const out: Edge[] = [];
      for (let i = 0; i < 300 && out.length < count; i++) {
        for (let j = 0; j < 300 && out.length < count; j++) {
          if (i !== j) out.push(edge(i === 0 ? 'summary' : `n${i - 1}`, j === 0 ? 'summary' : `n${j - 1}`));
        }
      }
      return out;
    };
    expect(validateGraph({ nodes, edges: mk(600) }).join('|')).not.toContain('too many edges');
    expect(validateGraph({ nodes, edges: mk(601) })).toContain('too many edges (601, max 600)');
  });
});

describe('reachableFromRoot', () => {
  it('follows edges in their direction only', () => {
    const set = reachableFromRoot([{ id: 'summary' }, { id: 'a' }, { id: 'b' }], [edge('summary', 'a'), edge('b', 'summary')]);
    expect([...set].sort()).toEqual(['a', 'summary']);
  });
});

describe('stampNodes', () => {
  const T0 = '2026-10-01T00:00:00.000Z';
  const T1 = '2026-10-02T00:00:00.000Z';
  const prev: GraphNode[] = [
    { ...node('summary'), createdAt: T0, updatedAt: T0 },
    { ...node('a'), createdAt: T0, updatedAt: T0 },
  ];

  it('stamps a new node with now for both', () => {
    const out = stampNodes([node('summary'), node('a'), node('b')], prev, T1);
    expect(out[2]).toMatchObject({ createdAt: T1, updatedAt: T1 });
  });

  it('keeps timestamps of unchanged nodes', () => {
    const out = stampNodes([node('summary'), node('a')], prev, T1);
    expect(out.map((n) => [n.createdAt, n.updatedAt])).toEqual([[T0, T0], [T0, T0]]);
  });

  it('bumps updatedAt only on a content change, and keeps createdAt', () => {
    const cases: Partial<NodeInput>[] = [
      { title: 'New' },
      { text: 'New' },
      { type: 'fundamentals' },
      { asOf: 'Q1' },
      { question: 'Why?' },
      { sources: [{ label: 'x', url: 'https://x.com' }] },
    ];
    for (const change of cases) {
      const out = stampNodes([node('summary'), node('a', change)], prev, T1);
      expect(out[0].updatedAt).toBe(T0);
      expect(out[1]).toMatchObject({ createdAt: T0, updatedAt: T1 });
    }
  });

  it('treats type text and omitted type as the same, and ignores caller timestamps', () => {
    const p: GraphNode[] = [{ ...node('summary'), createdAt: T0, updatedAt: T0 }];
    const input = [{ ...node('summary'), type: 'text' as const, createdAt: 'x', updatedAt: 'y' } as NodeInput];
    const out = stampNodes(input, p, T1);
    expect(out[0].updatedAt).toBe(T0);
    expect((out[0] as unknown as Record<string, unknown>).createdAt).toBe(T0);
  });
});

describe('isNew', () => {
  const n: GraphNode = { ...node('a'), createdAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' };
  it('is new when never viewed', () => expect(isNew(n, null)).toBe(true));
  it('is new when updated after the last view', () => expect(isNew(n, '2026-10-01T00:00:00.000Z')).toBe(true));
  it('is not new when viewed after the update', () => expect(isNew(n, '2026-10-03T00:00:00.000Z')).toBe(false));
  it('is not new at the same instant', () => expect(isNew(n, n.updatedAt)).toBe(false));
});
