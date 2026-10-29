import { expect, it } from 'vitest';
import { layoutGraph } from './layout';

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

it('puts summary at the top and children below their parent', () => {
  const pos = layoutGraph(nodes, edges);
  const ys = Object.values(pos).map((p) => p.y);
  expect(pos.summary.y).toBe(Math.min(...ys));
  expect(pos.a.y).toBeGreaterThan(pos.summary.y);
  expect(pos.a1.y).toBeGreaterThan(pos.a.y);
});

it('does not overlap siblings', () => {
  const pos = layoutGraph(nodes, edges);
  expect(Math.abs(pos.a1.x - pos.a2.x)).toBeGreaterThanOrEqual(160 + 24);
});
