import type { Move } from '../api/moves';

export type SortKey = 'ticker' | 'atr' | 'today';
export type SortDir = 'asc' | 'desc';
export interface SortState {
  key: SortKey;
  dir: SortDir;
}

/** Tap cycle: first direction, then the other, then back to My order (null). */
export function nextSort(current: SortState | null, key: SortKey): SortState | null {
  const first: SortDir = key === 'ticker' ? 'asc' : 'desc';
  if (!current || current.key !== key) return { key, dir: first };
  if (current.dir === first) return { key, dir: first === 'asc' ? 'desc' : 'asc' };
  return null;
}

/** Display-only ordering. Missing values go last in both directions; ties by symbol. */
export function sortRows<T extends { symbol: string }>(
  rows: T[],
  sort: SortState | null,
  moves: Move[] | undefined,
): T[] {
  if (!sort) return rows;
  const sign = sort.dir === 'asc' ? 1 : -1;
  const value = (sym: string): number | null => {
    const m = moves?.find((x) => x.symbol === sym);
    return (sort.key === 'atr' ? m?.atrPercent : m?.movePercent) ?? null;
  };
  return [...rows].sort((a, b) => {
    if (sort.key !== 'ticker') {
      const va = value(a.symbol);
      const vb = value(b.symbol);
      if (va === null && vb !== null) return 1;
      if (vb === null && va !== null) return -1;
      if (va !== null && vb !== null && va !== vb) return sign * (va - vb);
    } else if (a.symbol !== b.symbol) {
      return sign * (a.symbol < b.symbol ? -1 : 1);
    }
    return a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0;
  });
}
