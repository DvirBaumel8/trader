import type { QuarterEstimate } from '../src/market-data/alpha-vantage.client.js';

/** `quarterEstimates` per symbol; `'fail'` throws like a quota reply. Unlisted symbols have none. */
export const STUB_ESTIMATES: Record<string, QuarterEstimate[] | 'fail'> = {};

/** A deterministic stand-in for `AlphaVantageClient`, so no test or browser run reaches the network. */
export function alphaVantageStub() {
  return {
    quarterEstimates: async (symbol: string): Promise<QuarterEstimate[]> => {
      const e = STUB_ESTIMATES[symbol.toUpperCase()];
      if (e === 'fail') throw new Error('stubbed Alpha Vantage failure');
      return e ?? [];
    },
  };
}
