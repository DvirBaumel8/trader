/**
 * 'asc'/'desc' order by distance to trigger; 'risk' orders by the dollars a
 * tier puts at risk. Stored in localStorage, so the two distance values keep
 * their original names — a saved preference must not be invalidated by
 * adding a third mode.
 */
export type StopSortDir = 'asc' | 'desc' | 'risk';

export interface SortableStopTier {
  symbol: string;
  /**
   * Signed fraction of the current price — positive is room, negative means
   * the level has already been passed. See `stopTiers` on the portfolio
   * response (backend/src/portfolio/stop-distance.ts).
   */
  distance: number;
  /**
   * Dollars given back if this tier fires. Signed: negative exactly when the
   * level has already been passed. See `amountAtRisk` on
   * backend/src/portfolio/stop-distance.ts.
   */
  amountAtRisk: number;
}

/**
 * "Nearest first" is ascending on the signed distance: an already-passed
 * stop (negative) is more urgent than one with a little room (a small
 * positive), and ascending order puts it first automatically — the sign
 * itself encodes urgency, so no separate "passed" bucket is needed here.
 * Symbol is the tie-break so the order is always stable.
 */
export function sortStopTiers<T extends SortableStopTier>(
  rows: T[],
  dir: StopSortDir,
): T[] {
  if (dir === 'risk') {
    // Largest dollars first. Distance answers "how soon"; this answers "how
    // much", and they disagree constantly — a wide cushion on a large
    // position can risk more than a tight one on a small position, which is
    // invisible when the page is ordered by percentage alone.
    //
    // An already-passed tier has a NEGATIVE figure and therefore sorts last,
    // which is deliberate: triggering it now would realise more than the stop
    // promised, so it is not what is putting money at risk. Its own `passed`
    // label is what marks it as needing attention.
    return [...rows].sort((a, b) => {
      if (a.amountAtRisk === b.amountAtRisk) {
        return a.symbol.localeCompare(b.symbol);
      }
      return a.amountAtRisk < b.amountAtRisk ? 1 : -1;
    });
  }

  const factor = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (a.distance === b.distance) return a.symbol.localeCompare(b.symbol);
    return (a.distance < b.distance ? -1 : 1) * factor;
  });
}
