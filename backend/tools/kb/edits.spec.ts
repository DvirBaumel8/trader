import { describe, expect, it } from 'vitest';
import { validateGraph } from '../../src/knowledge/graph.js';
import type { GraphInput } from '../../src/knowledge/graph.js';
import { addNode, editNode, link, moveNode, removeNode, start, unlink } from './edits.js';

function ok(g: GraphInput): GraphInput {
  expect(validateGraph(g)).toEqual([]);
  return g;
}

function base(): GraphInput {
  let g = start({ title: 'Acme', text: 'A made-up company.' });
  g = addNode(g, { under: 'summary', id: 'a', label: 'has', title: 'A', text: 'Alpha' });
  g = addNode(g, { under: 'summary', id: 'b', label: 'has', title: 'B', text: 'Beta' });
  g = addNode(g, { under: 'a', id: 'a1', label: 'part', title: 'A1', text: 'Alpha one' });
  g = addNode(g, { under: 'a1', id: 'a2', label: 'part', title: 'A2', text: 'Alpha two' });
  return ok(g);
}

const ids = (g: GraphInput) => g.nodes.map((n) => n.id).sort();

describe('start', () => {
  it('makes a summary-only graph', () => {
    const g = ok(start({ title: 'T', text: 'x', sources: [{ label: 'l', url: 'https://example.com' }] }));
    expect(ids(g)).toEqual(['summary']);
    expect(g.edges).toEqual([]);
    expect(g.nodes[0].sources).toHaveLength(1);
  });
  it('rejects empty text', () => {
    expect(() => start({ title: 'T', text: '' })).toThrow();
  });
});

describe('addNode', () => {
  it('adds a node and an edge from its parent without mutating the input', () => {
    const g0 = base();
    const n = JSON.stringify(g0);
    const g = ok(addNode(g0, { under: 'b', id: 'c', label: 'x', title: 'C', text: 'Gamma', asOf: 'Q1', question: 'Why?' }));
    expect(JSON.stringify(g0)).toBe(n);
    expect(g.edges).toContainEqual({ from: 'b', to: 'c', label: 'x' });
    expect(g.nodes.find((x) => x.id === 'c')).toMatchObject({ asOf: 'Q1', question: 'Why?' });
  });
  it('refuses an unknown parent', () => {
    expect(() => addNode(base(), { under: 'nope', id: 'c', label: 'x', title: 'C', text: 't' })).toThrow(/nope/);
  });
  it('refuses a duplicate id', () => {
    expect(() => addNode(base(), { under: 'summary', id: 'a', label: 'x', title: 'C', text: 't' })).toThrow(/a/);
  });
  it('allows empty text for a fundamentals node', () => {
    ok(addNode(base(), { under: 'summary', id: 'fundamentals', label: 'x', title: 'F', text: '', type: 'fundamentals' }));
  });
  it('refuses a bad id', () => {
    expect(() => addNode(base(), { under: 'summary', id: 'Bad Id', label: 'x', title: 'C', text: 't' })).toThrow();
  });
});

describe('editNode', () => {
  it('patches fields and replaces sources', () => {
    let g = editNode(base(), 'a', { sources: [{ label: 'one', url: 'https://example.com/1' }] });
    g = ok(editNode(g, 'a', { title: 'New', sources: [{ label: 'two', url: 'https://example.com/2' }] }));
    const a = g.nodes.find((n) => n.id === 'a')!;
    expect(a.title).toBe('New');
    expect(a.text).toBe('Alpha');
    expect(a.sources).toEqual([{ label: 'two', url: 'https://example.com/2' }]);
  });
  it('clears asOf with an empty string', () => {
    let g = editNode(base(), 'a', { asOf: 'Q2' });
    g = ok(editNode(g, 'a', { asOf: '' }));
    expect(g.nodes.find((n) => n.id === 'a')!.asOf).toBeUndefined();
  });
  it('refuses unknown nodes and invalid results', () => {
    expect(() => editNode(base(), 'zzz', { title: 'x' })).toThrow(/zzz/);
    expect(() => editNode(base(), 'a', { text: '' })).toThrow();
  });
});

describe('link / unlink', () => {
  it('adds and removes an extra edge', () => {
    const g = ok(link(base(), 'b', 'a2', 'also'));
    expect(g.edges).toContainEqual({ from: 'b', to: 'a2', label: 'also' });
    const g2 = ok(unlink(g, 'b', 'a2'));
    expect(g2.edges.find((e) => e.from === 'b' && e.to === 'a2')).toBeUndefined();
  });
  it('refuses duplicates, self loops and unknown ends', () => {
    expect(() => link(base(), 'summary', 'a', 'x')).toThrow();
    expect(() => link(base(), 'a', 'a', 'x')).toThrow();
    expect(() => link(base(), 'a', 'nope', 'x')).toThrow();
  });
  it('unlink refuses when it would orphan nodes, or when the edge is missing', () => {
    expect(() => unlink(base(), 'summary', 'b')).toThrow(/reachable/);
    expect(() => unlink(base(), 'b', 'a')).toThrow(/no edge/i);
  });
});

describe('moveNode', () => {
  it('replaces incoming edges and keeps the old label by default', () => {
    const g = ok(link(base(), 'b', 'a1', 'extra'));
    const moved = ok(moveNode(g, 'a1', { under: 'b' }));
    const incoming = moved.edges.filter((e) => e.to === 'a1');
    expect(incoming).toEqual([{ from: 'b', to: 'a1', label: 'part' }]);
    expect(ids(moved)).toEqual(ids(g));
  });
  it('uses a new label when given', () => {
    const moved = ok(moveNode(base(), 'a1', { under: 'b', label: 'new' }));
    expect(moved.edges.find((e) => e.to === 'a1')).toEqual({ from: 'b', to: 'a1', label: 'new' });
  });
  it('refuses the summary, itself, and its own descendants', () => {
    expect(() => moveNode(base(), 'summary', { under: 'a' })).toThrow();
    expect(() => moveNode(base(), 'a', { under: 'a' })).toThrow();
    expect(() => moveNode(base(), 'a', { under: 'a2' })).toThrow(/descendant/);
  });
  it('refuses unknown nodes', () => {
    expect(() => moveNode(base(), 'zzz', { under: 'a' })).toThrow();
    expect(() => moveNode(base(), 'a', { under: 'zzz' })).toThrow();
  });
});

describe('removeNode', () => {
  it('removes a leaf and its edges', () => {
    const g = ok(removeNode(base(), 'a2', false));
    expect(ids(g)).toEqual(['a', 'a1', 'b', 'summary']);
    expect(g.edges.every((e) => e.to !== 'a2' && e.from !== 'a2')).toBe(true);
  });
  it('refuses to leave orphans without withChildren', () => {
    expect(() => removeNode(base(), 'a', false)).toThrow(/with-children|reachable/);
  });
  it('removes the subtree with withChildren', () => {
    const g = ok(removeNode(base(), 'a', true));
    expect(ids(g)).toEqual(['b', 'summary']);
  });
  it('keeps a child that is also linked from elsewhere', () => {
    const g0 = link(base(), 'b', 'a1', 'also');
    const g = ok(removeNode(g0, 'a', true));
    expect(ids(g)).toEqual(['a1', 'a2', 'b', 'summary']);
  });
  it('allows removal without withChildren when children stay reachable', () => {
    const g = ok(removeNode(link(base(), 'b', 'a1', 'also'), 'a', false));
    expect(ids(g)).toEqual(['a1', 'a2', 'b', 'summary']);
  });
  it('refuses the summary and unknown nodes', () => {
    expect(() => removeNode(base(), 'summary', true)).toThrow();
    expect(() => removeNode(base(), 'zzz', false)).toThrow();
  });
});
