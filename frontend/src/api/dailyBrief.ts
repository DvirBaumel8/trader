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

export type MarketSession = 'PRE' | 'REGULAR' | 'POST' | 'OVERNIGHT' | 'CLOSED';

export interface BriefMood {
  indices: { symbol: string; trend: 'uptrend' | 'downtrend' | 'mixed' | null; changePct: number | null; stale: boolean; extended: boolean; session: MarketSession | null }[];
  vix: { level: number; change: number | null; stale: boolean } | null;
  leader: { symbol: string; name: string; changePct: number } | null;
  laggard: { symbol: string; name: string; changePct: number } | null;
}

export interface BriefEvent { title: string; detail: string; eventAt: string }
export interface BriefLine { kind: string; symbol: string; title: string; detail: string }

export interface BriefMover {
  symbol: string; changePct: number; atrMultiple: number; dollarChange: number | null;
  extended: boolean; stale: boolean; session: MarketSession | null;
  reasons: { code: string; label: string }[];
  headline: { title: string; source: string; url: string; at: string } | null;
  thesis: string | null;
}

export interface BriefResponse {
  generatedAt: string;
  refreshAfterSeconds: number;
  session: MarketSession;
  marketDataAvailable: boolean;
  mood: BriefMood;
  events: BriefEvent[];
  movers: BriefMover[];
  watchTriggers: BriefLine[];
  queue: BriefLine[];
  /** Null whenever there is nothing to show — no AI configured, or the call failed. Silent by design. */
  narrative: string | null;
  /** When the narrative was written; earlier than generatedAt when the server reused it. */
  narrativeAt: string | null;
}
