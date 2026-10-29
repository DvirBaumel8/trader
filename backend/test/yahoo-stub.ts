import type { RawFundamentals } from '../src/market-data/yahoo.client.js';

/**
 * A deterministic stand-in for `YahooClient`, so no test reaches the network.
 *
 * `lookup` resolves every symbol EXCEPT the repo's `ZZZZ...` unknown-ticker
 * convention: enumerating every symbol the specs use would mean a new test
 * that adds one fails with a confusing 404 instead of doing what it says.
 *
 * `nextEarnings` is driven by the exported, mutable `STUB_EARNINGS`; a spec
 * sets entries and resets them afterwards. Unlisted symbols have no date.
 */
export const STUB_EARNINGS: Record<string, { at: string; estimated: boolean } | null> = {};

/** `dailyBars` per symbol (oldest first); unlisted symbols have none. */
export const STUB_BARS: Record<
  string,
  { date: string; open: number | null; high: number | null; low: number | null; close: number }[]
> = {};

/** `quote` per symbol; unlisted symbols have none (null). */
export const STUB_QUOTES: Record<string, { price: number; previousClose: number } | null> = {};

/**
 * `fundamentals` per symbol; `'fail'` makes the provider throw. Unlisted
 * symbols are not companies (an ETF-shaped answer), so a new spec that forgets
 * to list one gets the 404 path rather than the network.
 */
export const STUB_FUNDAMENTALS: Record<string, RawFundamentals | 'fail'> = {};

/** How many times `fundamentals` was asked, per symbol; a spec resets it. */
export const STUB_FUNDAMENTALS_CALLS: Record<string, number> = {};

export function yahooStub() {
  return {
    lookup: async (symbol: string) => {
      const upper = symbol.toUpperCase();
      if (upper.startsWith('ZZZZ')) return null;
      return { symbol: upper, name: `${upper} Inc` };
    },
    nextEarnings: async (symbol: string) => {
      const e = STUB_EARNINGS[symbol.toUpperCase()];
      return e ? { at: new Date(e.at), estimated: e.estimated } : null;
    },
    dailyBars: async (symbol: string, _from?: Date) => STUB_BARS[symbol.toUpperCase()] ?? [],
    quote: async (symbol: string) => STUB_QUOTES[symbol.toUpperCase()] ?? null,
    fundamentals: async (symbol: string): Promise<RawFundamentals> => {
      const upper = symbol.toUpperCase();
      STUB_FUNDAMENTALS_CALLS[upper] = (STUB_FUNDAMENTALS_CALLS[upper] ?? 0) + 1;
      const f = STUB_FUNDAMENTALS[upper];
      if (f === 'fail') throw new Error('stubbed Yahoo failure');
      return f ?? { quoteType: 'ETF', currency: 'USD', epsQuarters: [], cash: null, debt: null, series: [] };
    },
  };
}
