import { describe, expect, it } from 'vitest';
import { sortWatchRows } from './sortWatchRows';

const r = (symbol: string, todayChangePercent: number | null, distanceToTarget: number | null) => ({
  symbol,
  todayChangePercent,
  distanceToTarget,
});
const syms = (rows: { symbol: string }[]) => rows.map((x) => x.symbol);

describe('sortWatchRows', () => {
  const rows = [r('B', 0.01, -0.2), r('A', null, 0.05), r('C', -0.03, null)];

  it('keeps the list order when no sort was picked', () => {
    expect(syms(sortWatchRows(rows, null))).toEqual(['B', 'A', 'C']);
  });

  it('sorts by symbol', () => {
    expect(syms(sortWatchRows(rows, { key: 'symbol', dir: 'asc' }))).toEqual(['A', 'B', 'C']);
  });

  it("sorts by today's move, sinking an unknown move in both directions", () => {
    expect(syms(sortWatchRows(rows, { key: 'day', dir: 'desc' }))).toEqual(['B', 'C', 'A']);
    expect(syms(sortWatchRows(rows, { key: 'day', dir: 'asc' }))).toEqual(['C', 'B', 'A']);
  });

  /**
   * Distance is signed by direction (a dip target is negative), but "closest
   * to my price" means the smallest move either way.
   */
  it('sorts by how far the price still has to travel, either direction', () => {
    expect(syms(sortWatchRows(rows, { key: 'target', dir: 'asc' }))).toEqual(['A', 'B', 'C']);
    expect(syms(sortWatchRows(rows, { key: 'target', dir: 'desc' }))).toEqual(['B', 'A', 'C']);
  });

  it('ignores a saved sort it does not know, keeping the list order', () => {
    expect(syms(sortWatchRows(rows, { key: 'price', dir: 'asc' }))).toEqual(['B', 'A', 'C']);
  });
});
