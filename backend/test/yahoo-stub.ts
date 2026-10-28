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
  };
}
