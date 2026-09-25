export const SORT_KEYS = [
  'symbol',
  'marketValue',
  'unrealizedPct',
  'unrealizedPnl',
  'daysUntilEarnings',
  'dayPnl',
] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = 'asc' | 'desc';

export interface SortablePosition {
  symbol: string;
  marketValue: number | null;
  unrealizedPct: number | null;
  unrealizedPnl: number | null;
  /** Null for a ticker with no upcoming earnings date (an ETF, say) — always sinks to the end, see below. */
  daysUntilEarnings: number | null;
  /** Null without a previous close. Sinks like any other unpriced metric. */
  dayPnl: number | null;
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

/**
 * A saved sort comes from localStorage, which outlives the code that wrote
 * it. Anything this version cannot sort by falls back whole, rather than
 * keeping a valid direction on an invalid key.
 */
export function sanitizeSort(
  s: { key: unknown; dir: unknown },
  fallback: { key: SortKey; dir: SortDir },
): { key: SortKey; dir: SortDir } {
  const keyOk = (SORT_KEYS as readonly unknown[]).includes(s.key);
  const dirOk = s.dir === 'asc' || s.dir === 'desc';
  return keyOk && dirOk ? { key: s.key as SortKey, dir: s.dir as SortDir } : fallback;
}
