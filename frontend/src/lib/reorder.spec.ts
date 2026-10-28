import { expect, it } from 'vitest';
import { moveSymbol } from './reorder';

const rows = ['A', 'B', 'C'].map((symbol) => ({ symbol }));

it('moves a row to the position of the one it was dropped on', () => {
  expect(moveSymbol(rows, 'A', 'C').map((r) => r.symbol)).toEqual(['B', 'C', 'A']);
  expect(moveSymbol(rows, 'C', 'A').map((r) => r.symbol)).toEqual(['C', 'A', 'B']);
});

it('returns the same array for a no-op or unknown symbol', () => {
  expect(moveSymbol(rows, 'B', 'B')).toBe(rows);
  expect(moveSymbol(rows, 'B', 'X')).toBe(rows);
});
