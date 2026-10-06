import { describe, expect, it } from 'vitest';
import { sortStopGroups, type SortableStopGroup } from './sortStopTiers';

function row(
  symbol: string,
  distance: number,
  amountAtRisk = 0,
): SortableStopGroup {
  return { symbol, nearestDistance: distance, amountAtRisk };
}

const symbols = (list: SortableStopGroup[]) => list.map((x) => x.symbol);

describe('sortStopGroups', () => {
  it('sorts nearest-to-trigger first, ascending on signed distance', () => {
    const rows = [row('FAR', 0.4), row('NEAR', 0.02), row('MID', 0.1)];
    expect(symbols(sortStopGroups(rows, 'asc'))).toEqual(['NEAR', 'MID', 'FAR']);
  });

  it('puts an already-passed stop (negative distance) ahead of any positive distance', () => {
    const rows = [row('ROOM', 0.02), row('PASSED', -0.01)];
    expect(symbols(sortStopGroups(rows, 'asc'))).toEqual(['PASSED', 'ROOM']);
  });

  it('reverses to furthest-first on desc', () => {
    const rows = [row('FAR', 0.4), row('NEAR', 0.02), row('PASSED', -0.01)];
    expect(symbols(sortStopGroups(rows, 'desc'))).toEqual([
      'FAR',
      'NEAR',
      'PASSED',
    ]);
  });

  it('orders a group by its closest tier, not its combined distance', () => {
    // Here the row's distance IS the group's nearest tier: a wide combined
    // figure must not hide a tier that is about to fire.
    const rows = [row('BITX', 0.03), row('NVDA', 0.01)];
    expect(sortStopGroups(rows, 'asc').map((r) => r.nearestDistance)).toEqual([
      0.01, 0.03,
    ]);
  });

  it('breaks ties on symbol so the order is stable', () => {
    const rows = [row('ZZZ', 0.05), row('AAA', 0.05)];
    expect(symbols(sortStopGroups(rows, 'asc'))).toEqual(['AAA', 'ZZZ']);
  });

  it('does not mutate the input array', () => {
    const rows = [row('B', 0.2), row('A', 0.1)];
    const original = [...rows];
    sortStopGroups(rows, 'asc');
    expect(rows).toEqual(original);
  });

  it('handles an empty list', () => {
    expect(sortStopGroups([], 'asc')).toEqual([]);
  });

  describe("by risk", () => {
    // Every fixture below is built so the expected order differs from BOTH
    // distance orders. A risk fixture that happens to agree with distance
    // proves nothing - the first version of these tests passed against the
    // old distance-only implementation.
    it('puts the largest dollar figure first, whatever its distance', () => {
      const rows = [
        row('X', 0.1, 3000),
        row('Y', 0.02, 100),
        row('Z', 0.2, 2000),
      ];
      // distance asc would be Y, X, Z; distance desc would be Z, X, Y.
      expect(symbols(sortStopGroups(rows, 'risk'))).toEqual(['X', 'Z', 'Y']);
    });

    it('sorts an already-passed tier last, not first', () => {
      // Its figure is negative because triggering now would realise MORE than
      // the stop promised, so it is not what is putting money at risk. The row
      // carries its own `passed` label; this ordering is about dollars.
      const rows = [
        row('PASSED', -0.02, -150),
        row('LIVE', 0.1, 900),
        row('MID', 0.5, 100),
      ];
      // distance asc would be PASSED, LIVE, MID; desc would be MID, LIVE, PASSED.
      expect(symbols(sortStopGroups(rows, 'risk'))).toEqual([
        'LIVE',
        'MID',
        'PASSED',
      ]);
    });

    it('breaks ties on symbol, like the distance sorts', () => {
      const rows = [row('B', 0.2, 500), row('A', 0.1, 500)];
      // distance desc would be B, A.
      expect(symbols(sortStopGroups(rows, 'risk'))).toEqual(['A', 'B']);
    });

    it('does not mutate the input array', () => {
      const rows = [row('B', 0.2, 100), row('A', 0.1, 900)];
      const original = [...rows];
      sortStopGroups(rows, 'risk');
      expect(rows).toEqual(original);
    });
  });
});