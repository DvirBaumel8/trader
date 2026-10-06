/**
 * 'asc'/'desc' order by distance to trigger; 'risk' orders by the dollars a
 * symbol's stops put at risk. Stored in localStorage, so the two distance values keep
 * their original names — a saved preference must not be invalidated by
 * adding a third mode.
 */
export type StopSortDir = 'asc' | 'desc' | 'risk';

export interface SortableStopGroup {
  symbol: string;
  /**
   * The group's CLOSEST tier, as a signed fraction of the current price —
   * positive is room, negative means a level has already been passed. Not the
   * combined distance: a wide average must never hide the tier that is about
   * to fire. See `stopGroups` on the portfolio response
   * (backend/src/portfolio/stop-distance.ts).
   */
  nearestDistance: number;
  /**
   * Dollars given back if every tier fires: the sum across tiers. Signed per
   * tier, so a passed tier subtracts. See `amountAtRisk` on
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
export function sortStopGroups<T extends SortableStopGroup>(
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
    if (a.nearestDistance === b.nearestDistance) return a.symbol.localeCompare(b.symbol);
    return (a.nearestDistance < b.nearestDistance ? -1 : 1) * factor;
  });
}
