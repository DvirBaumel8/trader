import { useQuery } from '@tanstack/react-query';
import { api } from './client';

export interface Move {
  symbol: string;
  atrPercent: number | null;
  movePercent: number | null;
  live: boolean;
  asOf: string | null;
}

/** The endpoint takes 1..60 symbols per call. */
const CHUNK = 60;
const LIVE_REFRESH_MS = 60_000;

async function fetchMoves(symbols: string[]): Promise<Move[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < symbols.length; i += CHUNK) chunks.push(symbols.slice(i, i + CHUNK));
  const parts = await Promise.all(chunks.map((c) => api<Move[]>(`/market/moves?symbols=${c.join(',')}`)));
  return parts.flat();
}

/**
 * ATR% and today's move for a list of symbols. Fetches only while `enabled`,
 * and polls once a minute only while some returned move is live.
 */
export function useMoves(symbols: string[], enabled: boolean) {
  const key = symbols.join(',');
  return useQuery({
    queryKey: ['moves', key],
    queryFn: () => fetchMoves(symbols),
    enabled: enabled && symbols.length > 0,
    refetchInterval: (query) => (query.state.data?.some((m) => m.live) ? LIVE_REFRESH_MS : false),
  });
}
