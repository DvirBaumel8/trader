export interface WatchSort {
  key: string;
  dir: 'asc' | 'desc';
}

export interface SortableWatchRow {
  symbol: string;
  todayChangePercent: number | null;
  distanceToTarget: number | null;
}

/**
 * Distance is signed by direction (a dip target is negative); "closest to my
 * price" is the smallest move either way, so it sorts on the magnitude.
 */
const METRIC: Record<string, (r: SortableWatchRow) => number | null> = {
  day: (r) => r.todayChangePercent,
  target: (r) => (r.distanceToTarget === null ? null : Math.abs(r.distanceToTarget)),
};

/**
 * Display order for the watchlist table. No sort (or one saved by an older
 * version) keeps the list's own order. Unknown values sink to the bottom in
 * both directions, and symbol breaks ties, like `sortPositions`.
 */
export function sortWatchRows<T extends SortableWatchRow>(rows: T[], sort: WatchSort | null): T[] {
  if (!sort || (sort.key !== 'symbol' && !(sort.key in METRIC))) return rows;
  const factor = sort.dir === 'asc' ? 1 : -1;
  if (sort.key === 'symbol') {
    return [...rows].sort((a, b) => a.symbol.localeCompare(b.symbol) * factor);
  }
  const metric = METRIC[sort.key];
  return [...rows].sort((a, b) => {
    const av = metric(a);
    const bv = metric(b);
    if (av === null && bv === null) return a.symbol.localeCompare(b.symbol);
    if (av === null) return 1;
    if (bv === null) return -1;
    if (av === bv) return a.symbol.localeCompare(b.symbol);
    return (av < bv ? -1 : 1) * factor;
  });
}
