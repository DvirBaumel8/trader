import { expect, it } from 'vitest';
import { edgeLabelAnchor, layoutGraph } from './layout';

const nodes = ['summary', 'a', 'b', 'a1', 'a2'].map((id) => ({ id }));
const edges = [
  { from: 'summary', to: 'a' },
  { from: 'summary', to: 'b' },
  { from: 'a', to: 'a1' },
  { from: 'a', to: 'a2' },
];

it('positions every node', () => {
  const pos = layoutGraph(nodes, edges);
  expect(Object.keys(pos).sort()).toEqual(['a', 'a1', 'a2', 'b', 'summary']);
  for (const p of Object.values(pos)) {
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
  }
});

it('puts summary at the left and children to the right of their parent', () => {
  const pos = layoutGraph(nodes, edges);
  const xs = Object.values(pos).map((p) => p.x);
  expect(pos.summary.x).toBe(Math.min(...xs));
  expect(pos.a.x).toBeGreaterThan(pos.summary.x);
  expect(pos.a1.x).toBeGreaterThan(pos.a.x);
});

it('stacks siblings vertically without overlap', () => {
  const pos = layoutGraph(nodes, edges);
  expect(pos.a1.x).toBe(pos.a2.x);
  expect(Math.abs(pos.a1.y - pos.a2.y)).toBeGreaterThanOrEqual(44 + 24);
});

it('gives labels of edges into the same node their own line', () => {
  const ys = [0, 1, 2, 3].map((slot) => edgeLabelAnchor(250, 100, slot).y);
  expect(ys[0]).toBe(100);
  expect(new Set(ys).size).toBe(4);
  const sorted = [...ys].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(16);
});
