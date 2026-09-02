import { describe, expect, it } from 'vitest';
import { sortStopTiers, type SortableStopTier } from './sortStopTiers';

function row(symbol: string, distance: number): SortableStopTier {
  return { symbol, distance };
}

const symbols = (list: SortableStopTier[]) => list.map((x) => x.symbol);

describe('sortStopTiers', () => {
  it('sorts nearest-to-trigger first, ascending on signed distance', () => {
    const rows = [row('FAR', 0.4), row('NEAR', 0.02), row('MID', 0.1)];
    expect(symbols(sortStopTiers(rows, 'asc'))).toEqual(['NEAR', 'MID', 'FAR']);
  });

  it('puts an already-passed stop (negative distance) ahead of any positive distance', () => {
    const rows = [row('ROOM', 0.02), row('PASSED', -0.01)];
    expect(symbols(sortStopTiers(rows, 'asc'))).toEqual(['PASSED', 'ROOM']);
  });

  it('reverses to furthest-first on desc', () => {
    const rows = [row('FAR', 0.4), row('NEAR', 0.02), row('PASSED', -0.01)];
    expect(symbols(sortStopTiers(rows, 'desc'))).toEqual([
      'FAR',
      'NEAR',
      'PASSED',
    ]);
  });

  it('handles a tiered position — two rows for the same symbol keep their own distances', () => {
    const rows = [
      row('BITX', 0.03),
      row('BITX', 0.01),
    ];
    expect(sortStopTiers(rows, 'asc').map((r) => r.distance)).toEqual([
      0.01, 0.03,
    ]);
  });

  it('breaks ties on symbol so the order is stable', () => {
    const rows = [row('ZZZ', 0.05), row('AAA', 0.05)];
    expect(symbols(sortStopTiers(rows, 'asc'))).toEqual(['AAA', 'ZZZ']);
  });

  it('does not mutate the input array', () => {
    const rows = [row('B', 0.2), row('A', 0.1)];
    const original = [...rows];
    sortStopTiers(rows, 'asc');
    expect(rows).toEqual(original);
  });

  it('handles an empty list', () => {
    expect(sortStopTiers([], 'asc')).toEqual([]);
  });
});
