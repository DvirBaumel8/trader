import { useQuery } from '@tanstack/react-query';
import { api } from './client';

export type Direction = 'LONG' | 'SHORT';
export interface HoldingRow {
  symbol: string;
  name: string | null;
  direction: Direction;
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

export const setHolding = (symbol: string, direction: Direction) =>
  api(`/holdings/${enc(symbol)}`, { method: 'PUT', body: JSON.stringify({ direction }) });
export const removeHolding = (symbol: string) => api(`/holdings/${enc(symbol)}`, { method: 'DELETE' });
export const addWatch = (symbol: string) =>
  api('/watchlist', { method: 'POST', body: JSON.stringify({ symbol: symbol.trim() }) });
export const removeWatch = (symbol: string) => api(`/watchlist/${enc(symbol)}`, { method: 'DELETE' });
