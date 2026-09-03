/**
 * A deterministic stand-in for `YahooClient`, so no test reaches the network.
 *
 * A suite that calls the real API fails on a plane, fails in CI without
 * network, and — worse — asserts something subtly different every day as
 * prices move. It also made tests order-dependent: `instruments` is
 * deliberately not truncated between specs, so one spec validating NVDA
 * against the live API changed what a later spec observed.
 *
 * Prices here are fixed constants chosen to be obviously synthetic. Any symbol
 * not in the table returns null from `quote`, which is what makes
 * `ZZZZNOTREAL` still 404 — now for a deterministic reason rather than a
 * network one.
 */
export const STUB_PRICES: Record<string, number> = {
  NVDA: 200,
  AAPL: 150,
  SMCI: 40,
  ONDS: 8,
  MRNA: 150,
  BITX: 20,
  AVGO: 350,
  PLTR: 170,
  SPY: 500,
  QQQ: 400,
  TSLA: 300,
  GOOGL: 180,
  META: 600,
  BE: 210,
  BMNR: 25,
  MSTR: 125,
  NBIS: 200,
  IREN: 40,
  GEV: 900,
  TFONLY: 110,
};

export interface StubBar {
  date: string;
  close: number;
  adjClose: number;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
}

/** A flat series with strictly increasing dates, long enough for every indicator. */
export function stubBars(price: number, count = 260): StubBar[] {
  return Array.from({ length: count }, (_, i) => {
    const day = new Date(Date.UTC(2026, 0, 1) + i * 86_400_000);
    return {
      date: day.toISOString().slice(0, 10),
      close: price,
      adjClose: price,
      open: price,
      high: price * 1.01,
      low: price * 0.99,
      volume: 1_000_000,
    };
  });
}

/**
 * Any symbol resolves EXCEPT the repo's `ZZZZ...` unknown-ticker convention.
 * Enumerating every symbol the specs use would mean a new test that adds one
 * fails with a confusing 404 instead of doing what it says; the one behaviour
 * the specs genuinely depend on is that ZZZZNOTREAL is not a real ticker.
 * Symbols without a fixed price get DEFAULT_PRICE, which is fine because a
 * test that cares about the price names it in STUB_PRICES.
 */
const DEFAULT_PRICE = 100;

function quoteFor(symbol: string) {
  const upper = symbol.toUpperCase();
  if (upper.startsWith('ZZZZ')) return null;
  const price = STUB_PRICES[upper] ?? DEFAULT_PRICE;
  return {
    symbol: symbol.toUpperCase(),
    name: `${symbol.toUpperCase()} Inc`,
    price,
    currency: 'USD',
    session: 'REGULAR' as const,
    extended: false,
    regularPrice: price,
    peRatio: 25,
  };
}

/**
 * Drop-in replacement for YahooClient in `overrideProvider`.
 *
 * `withBars` is opt-in because bars are the exception: only the backfill spec
 * exercises them through the provider. Everywhere else, specs that need
 * history insert precise `daily_closes` rows themselves, and a stub
 * volunteering bars would collide with those inserts.
 */
export function yahooStub(options: { withBars?: boolean } = {}) {
  return {
    quote: async (symbol: string) => quoteFor(symbol),
    quoteMany: async (symbols: string[]) =>
      symbols.map(quoteFor).filter((q): q is NonNullable<typeof q> => q !== null),
    // Empty by DEFAULT, which is the important part. Several specs insert
    // their own `daily_closes` rows by hand to set up a precise scenario - a
    // high-water mark, or a trade with no history at all - and a stub that
    // volunteered bars for every symbol would collide with those inserts and
    // silently give "no bar history" a history. A spec that wants bars from
    // the provider passes its own stub.
    dailyBars: async (symbol: string) => {
      if (!options.withBars) return [] as StubBar[];
      const upper = symbol.toUpperCase();
      if (upper.startsWith('ZZZZ')) return [] as StubBar[];
      return stubBars(STUB_PRICES[upper] ?? DEFAULT_PRICE);
    },
  };
}
