import { useQuery } from '@tanstack/react-query';
import { api } from './client';

export type EarningsSource = 'holding' | 'watchlist';
export type EarningsTiming = 'before_open' | 'during' | 'after_close' | 'unknown';

export interface EarningsEntry {
  symbol: string;
  source: EarningsSource;
  timing: EarningsTiming;
  estimated: boolean;
}
export interface EarningsDay {
  date: string;
  entries: EarningsEntry[];
}
export interface EarningsUpcoming {
  symbol: string;
  source: EarningsSource;
  date: string | null;
  daysUntil: number | null;
  estimated: boolean;
}
export interface EarningsWeek {
  weekStart: string;
  weekEnd: string;
  today: string;
  days: EarningsDay[];
  upcoming: EarningsUpcoming[];
}

export const EARNINGS_KEY = ['earnings', 'week'] as const;

export function useEarningsWeek() {
  return useQuery({ queryKey: EARNINGS_KEY, queryFn: () => api<EarningsWeek>('/earnings/week') });
}
