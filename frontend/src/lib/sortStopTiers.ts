export type StopSortDir = 'asc' | 'desc';

export interface SortableStopTier {
  symbol: string;
  /**
   * Signed fraction of the current price — positive is room, negative means
   * the level has already been passed. See `stopTiers` on the portfolio
   * response (backend/src/portfolio/stop-distance.ts).
   */
  distance: number;
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
  const factor = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (a.distance === b.distance) return a.symbol.localeCompare(b.symbol);
    return (a.distance < b.distance ? -1 : 1) * factor;
  });
}
