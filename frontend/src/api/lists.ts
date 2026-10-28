import { useQuery } from '@tanstack/react-query';
import { api } from './client';

export interface HoldingRow {
  symbol: string;
  name: string | null;
}
export interface WatchRow {
  symbol: string;
  name: string | null;
}

export const HOLDINGS_KEY = ['holdings'] as const;
export const WATCHLIST_KEY = ['watchlist'] as const;

export function useHoldings() {
  return useQuery({ queryKey: HOLDINGS_KEY, queryFn: () => api<HoldingRow[]>('/holdings') });
}

export function useWatchlist() {
  return useQuery({ queryKey: WATCHLIST_KEY, queryFn: () => api<WatchRow[]>('/watchlist') });
}

const enc = (s: string) => encodeURIComponent(s.trim().toUpperCase());

export interface AddHoldingsResult {
  added: string[];
  already: string[];
  notFound: string[];
}
export interface AddWatchesResult extends AddHoldingsResult {
  full: string[];
}

export const addHoldings = (symbols: string[]) =>
  api<AddHoldingsResult>('/holdings', { method: 'POST', body: JSON.stringify({ symbols }) });
export const removeHolding = (symbol: string) => api(`/holdings/${enc(symbol)}`, { method: 'DELETE' });
export const addWatches = (symbols: string[]) =>
  api<AddWatchesResult>('/watchlist', { method: 'POST', body: JSON.stringify({ symbols }) });
export const removeWatch = (symbol: string) => api(`/watchlist/${enc(symbol)}`, { method: 'DELETE' });
