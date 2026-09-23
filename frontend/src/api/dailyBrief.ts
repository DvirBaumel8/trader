import { api } from './client';

/**
 * One definition of the daily brief fetch, shared so AppShell's eager
 * prefetch and Brief's own query land in the same cache entry — the same
 * reason `useSettings` exists for the settings fetch.
 */
export const DAILY_BRIEF_QUERY_KEY = ['daily-brief'];

export function fetchDailyBrief<T = unknown>(): Promise<T> {
  return api<T>('/watchlist/daily-brief');
}
