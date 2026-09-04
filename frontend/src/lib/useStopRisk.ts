import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { StopRow } from './stopRow';

export interface StopRisk {
  amount: number | null;
  coveredQuantity: number;
  fullyCovered: boolean;
  overCovered: boolean;
  invalidLevels: number;
}

interface StopRiskRequest {
  avgEntry: number;
  quantity: number;
  direction: 'LONG' | 'SHORT';
  levels: Array<{
    kind: 'FIXED' | 'TRAILING';
    price?: number;
    trailPercent?: number;
    quantity: number;
  }>;
}

const num = (s: string): number | null => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};

/**
 * Turns half-typed rows into a request, or null when there is not yet enough
 * to price. Parsing input text is a display concern and stays here; what the
 * numbers MEAN is the backend's.
 */
function toRequest(
  entryPrice: string,
  positionQuantity: string,
  rows: StopRow[],
  side: 'BUY' | 'SELL',
): StopRiskRequest | null {
  const avgEntry = num(entryPrice);
  if (avgEntry === null || avgEntry <= 0) return null;

  type Level = StopRiskRequest['levels'][number];
  const levels: Level[] = rows.flatMap((row): Level[] => {
    const quantity = Math.abs(num(row.quantity) ?? 0);
    if (quantity <= 0) return [];
    if (row.kind === 'FIXED') {
      const price = num(row.price);
      return price !== null && price > 0
        ? [{ kind: 'FIXED' as const, price, quantity }]
        : [];
    }
    const trailPercent = num(row.trailPercent);
    return trailPercent !== null && trailPercent > 0
      ? [{ kind: 'TRAILING' as const, trailPercent, quantity }]
      : [];
  });

  if (levels.length === 0) return null;

  return {
    avgEntry,
    quantity: Math.abs(num(positionQuantity) ?? 0),
    direction: side === 'BUY' ? 'LONG' : 'SHORT',
    levels,
  };
}

/**
 * Waits for a pause in typing before asking. Without it every keystroke is a
 * request, and the figure flickers through the values of a half-typed number
 * — "9", "95", "950" — which is worse than showing nothing.
 */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

const DEBOUNCE_MS = 250;

/**
 * The dollars a stop plan puts at risk, computed by the backend.
 *
 * The frontend held its own copy of this arithmetic until 2026-09-04. It
 * drifted twice — treating a profit-locking tier as no coverage, and
 * reporting $1,200 at risk on a plan actually worth $750 — because nothing
 * held two implementations of one rule together. Displaying the number is
 * this layer's job; working it out is not.
 *
 * Returns null while there is nothing complete enough to price.
 */
export function useStopRisk(
  entryPrice: string,
  positionQuantity: string,
  rows: StopRow[],
  side: 'BUY' | 'SELL',
): StopRisk | null {
  const request = toRequest(entryPrice, positionQuantity, rows, side);
  // Debounce the serialised request, not the rows: an edit that does not
  // change the priced plan (adding an empty tier, say) should not re-ask.
  const key = useDebounced(request === null ? null : JSON.stringify(request), DEBOUNCE_MS);

  const { data } = useQuery({
    queryKey: ['stop-risk', key],
    queryFn: () =>
      api<StopRisk>('/portfolio/stop-risk', { method: 'POST', body: key! }),
    enabled: key !== null,
    // The plan is priced from its own contents, so an answer never goes out
    // of date on its own.
    staleTime: Infinity,
    // Hold the previous figure while the next one loads, rather than
    // blanking the line on every edit.
    placeholderData: keepPreviousData,
  });

  return key === null ? null : (data ?? null);
}
