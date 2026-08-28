export type SortKey = 'symbol' | 'marketValue' | 'unrealizedPct' | 'unrealizedPnl';
export type SortDir = 'asc' | 'desc';

export interface SortablePosition {
  symbol: string;
  marketValue: number | null;
  unrealizedPct: number | null;
  unrealizedPnl: number | null;
}

/**
 * Sorting is a pure function over a copy: a position that cannot be priced has
 * null metrics, and those always sink to the bottom regardless of direction —
 * an unpriceable holding at the top of a "best performers" list would be a lie.
 * Symbol is the tie-break so the order is always stable and reproducible.
 */
export function sortPositions<T extends SortablePosition>(
  positions: T[],
  key: SortKey,
  dir: SortDir,
): T[] {
  const factor = dir === 'asc' ? 1 : -1;

  return [...positions].sort((a, b) => {
    if (key === 'symbol') {
      return a.symbol.localeCompare(b.symbol) * factor;
    }

    const av = a[key];
    const bv = b[key];

    // Nulls last, in both directions.
    const aNull = av === null || av === undefined || Number.isNaN(av);
    const bNull = bv === null || bv === undefined || Number.isNaN(bv);
    if (aNull && bNull) return a.symbol.localeCompare(b.symbol);
    if (aNull) return 1;
    if (bNull) return -1;

    if (av === bv) return a.symbol.localeCompare(b.symbol);
    return (av < bv ? -1 : 1) * factor;
  });
}
