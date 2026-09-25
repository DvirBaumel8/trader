import { describe, expect, it, vi } from 'vitest';
import { YahooClient } from './yahoo.client.js';

function clientReturning(quotes: unknown[]): YahooClient {
  // The adapter only ever calls .chart() here; the rest of the Yahoo surface
  // is irrelevant to bar mapping.
  const fake = { chart: async () => ({ quotes }) };
  return new YahooClient(fake as never);
}

function clientQuoting(raw: unknown): YahooClient {
  const fake = { quote: async () => raw };
  return new YahooClient(fake as never);
}

describe('dailyBars OHLC mapping', () => {
  it('keeps open, high and low when Yahoo returns them', async () => {
    const client = clientReturning([
      {
        date: '2026-08-28T00:00:00.000Z',
        open: 10,
        high: 12,
        low: 9,
        close: 11,
        adjclose: 11,
        volume: 1_234_567,
      },
    ]);
    const [bar] = await client.dailyBars('AAPL', new Date('2026-08-01'));
    expect(bar).toEqual({
      date: '2026-08-28',
      open: 10,
      high: 12,
      low: 9,
      close: 11,
      adjClose: 11,
      volume: 1_234_567,
    });
  });

  it('stores a bar with no volume rather than dropping it', async () => {
    const client = clientReturning([
      { date: '2026-08-28T00:00:00.000Z', open: 10, high: 12, low: 9, close: 11 },
    ]);
    const [bar] = await client.dailyBars('AAPL', new Date('2026-08-01'));
    expect(bar.close).toBe(11);
    expect(bar.volume).toBeNull();
  });

  it('stores a bar missing high and low rather than dropping it', async () => {
    const client = clientReturning([
      { date: '2026-08-28T00:00:00.000Z', open: 10, close: 11, adjclose: 11 },
    ]);
    const [bar] = await client.dailyBars('AAPL', new Date('2026-08-01'));
    expect(bar.close).toBe(11);
    expect(bar.high).toBeNull();
    expect(bar.low).toBeNull();
    expect(bar.open).toBe(10);
  });

  it('still drops a bar with no usable close', async () => {
    const client = clientReturning([
      { date: '2026-08-28T00:00:00.000Z', open: 10, high: 12, low: 9 },
    ]);
    expect(await client.dailyBars('AAPL', new Date('2026-08-01'))).toEqual([]);
  });
});

describe('bar ordering', () => {
  it('returns bars chronologically even when the provider does not', async () => {
    // Nothing contracts Yahoo to return these in order, and everything
    // downstream assumes it: the chart draws them in array order and
    // computePriceAction reads the LAST element as today. Out of order, the
    // app would name the wrong session and misreport the day's change without
    // any error to notice.
    const client = clientReturning([
      { date: '2026-09-04T00:00:00.000Z', close: 30, adjclose: 30 },
      { date: '2026-09-01T00:00:00.000Z', close: 10, adjclose: 10 },
      { date: '2026-09-02T00:00:00.000Z', close: 20, adjclose: 20 },
    ]);

    const bars = await client.dailyBars('AAPL', new Date('2026-08-01'));
    expect(bars.map((b) => b.date)).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-04',
    ]);
    // The one that matters: "today" is the newest session, not whichever the
    // provider happened to list last.
    expect(bars.at(-1)?.close).toBe(30);
  });
});

describe('chart fallback when the quote endpoint is blocked', () => {
  // Yahoo's quote endpoint needs a "crumb" token; its chart endpoint does not.
  // From a datacenter IP the crumb request is answered with 429, so in
  // production every quote failed while chart calls kept working. Falling back
  // to chart keeps prices alive there.
  const crumbBlocked = () => {
    throw new Error('Failed to get crumb, status 429, statusText: Too Many Requests');
  };

  it('prices a symbol from chart meta when the quote endpoint fails', async () => {
    const client = new YahooClient({
      quote: async () => crumbBlocked(),
      chart: async () => ({
        meta: {
          symbol: 'APP',
          shortName: 'Applovin Corporation',
          currency: 'USD',
          regularMarketPrice: 320.56,
        },
      }),
    } as never);

    const q = await client.quote('APP');

    expect(q?.symbol).toBe('APP');
    expect(q?.price).toBe(320.56);
    expect(q?.name).toBe('Applovin Corporation');
  });

  it('reports the fallback price as a regular-session price, never an extended print', async () => {
    // Chart meta carries no marketState and no pre/post price, so there is no
    // extended print to label. Claiming one would break the rule that an
    // extended price is always labelled as such.
    const client = new YahooClient({
      quote: async () => crumbBlocked(),
      chart: async () => ({
        meta: { symbol: 'APP', regularMarketPrice: 320.56 },
      }),
    } as never);

    const q = await client.quote('APP');

    expect(q?.extended).toBe(false);
    expect(q?.peRatio).toBeNull();
  });

  it('returns null rather than a made-up price when chart has none either', async () => {
    const client = new YahooClient({
      quote: async () => crumbBlocked(),
      chart: async () => ({ meta: { symbol: 'ZZZZ' } }),
    } as never);

    expect(await client.quote('ZZZZ')).toBeNull();
  });

  it('does not call chart at all when the quote endpoint works', async () => {
    // The fallback costs an extra request per symbol, so it must only run
    // when the primary path has actually failed.
    let chartCalls = 0;
    const client = new YahooClient({
      quote: async () => ({
        symbol: 'AAPL',
        marketState: 'REGULAR',
        regularMarketPrice: 214,
        trailingPE: 37.4,
      }),
      chart: async () => {
        chartCalls++;
        return { meta: {} };
      },
    } as never);

    const q = await client.quote('AAPL');

    expect(q?.price).toBe(214);
    expect(chartCalls).toBe(0);
  });

  it('prices every symbol from chart when the batch quote is blocked', async () => {
    const prices: Record<string, number> = { APP: 320.56, NVDA: 178.2 };
    const client = new YahooClient({
      quote: async () => crumbBlocked(),
      chart: async (symbol: string) => ({
        meta: { symbol, regularMarketPrice: prices[symbol] },
      }),
    } as never);

    const quotes = await client.quoteMany(['APP', 'NVDA']);

    expect(quotes.map((q) => [q.symbol, q.price])).toEqual([
      ['APP', 320.56],
      ['NVDA', 178.2],
    ]);
  });

  it('rethrows when the fallback can price nothing, so the caller serves its stale cache', async () => {
    // Swallowing a total outage into an empty result would strip the cached
    // prices MarketDataService falls back on, turning "stale" into "blank".
    const client = new YahooClient({
      quote: async () => crumbBlocked(),
      chart: async () => {
        throw new Error('chart failed too');
      },
    } as never);

    await expect(client.quoteMany(['APP', 'NVDA'])).rejects.toThrow(/crumb/);
  });

  it('still returns the symbols it could price when one of them fails', async () => {
    // One dead symbol must not blank the whole portfolio.
    const client = new YahooClient({
      quote: async () => crumbBlocked(),
      chart: async (symbol: string) => {
        if (symbol === 'BROKEN') throw new Error('chart failed too');
        return { meta: { symbol, regularMarketPrice: 100 } };
      },
    } as never);

    const quotes = await client.quoteMany(['BROKEN', 'NVDA']);

    expect(quotes.map((q) => q.symbol)).toEqual(['NVDA']);
  });
});

describe('next earnings date', () => {
  it('reads the first calendar event returned by Yahoo', async () => {
    const client = new YahooClient({
      quoteSummary: async () => ({
        calendarEvents: {
          earnings: {
            earningsDate: [
              new Date('2026-09-25T12:00:00Z'),
              new Date('2026-10-02T12:00:00Z'),
            ],
          },
        },
      }),
    } as never);

    expect(await client.nextEarningsDate('NVDA')).toBe('2026-09-25');
  });
});

describe('quote P/E mapping', () => {
  it('exposes a trailing P/E when Yahoo reports one', async () => {
    const client = clientQuoting({
      symbol: 'AAPL',
      marketState: 'REGULAR',
      regularMarketPrice: 214,
      trailingPE: 37.4,
    });
    const q = await client.quote('AAPL');
    expect(q?.peRatio).toBe(37.4);
  });

  it('nulls the P/E rather than showing 0 when Yahoo has none', async () => {
    const client = clientQuoting({
      symbol: 'IONQ',
      marketState: 'REGULAR',
      regularMarketPrice: 45,
      // No trailingPE at all — an unprofitable growth name.
    });
    const q = await client.quote('IONQ');
    expect(q?.peRatio).toBeNull();
  });

  it('nulls a non-positive P/E rather than passing it through as real', async () => {
    const client = clientQuoting({
      symbol: 'RIVN',
      marketState: 'REGULAR',
      regularMarketPrice: 14,
      trailingPE: -8.7,
    });
    const q = await client.quote('RIVN');
    expect(q?.peRatio).toBeNull();
  });
});

describe('quote previousClose mapping', () => {
  it('carries yesterday\'s close, for the move since then', async () => {
    const client = clientQuoting({
      symbol: 'AAPL',
      marketState: 'REGULAR',
      regularMarketPrice: 214,
      regularMarketPreviousClose: 210,
    });
    const q = await client.quote('AAPL');
    expect(q?.previousClose).toBe(210);
  });

  it('nulls previousClose rather than 0 when Yahoo has none', async () => {
    const client = clientQuoting({
      symbol: 'IONQ',
      marketState: 'REGULAR',
      regularMarketPrice: 45,
    });
    const q = await client.quote('IONQ');
    expect(q?.previousClose).toBeNull();
  });

  it('still carries a previous close through the chart fallback', async () => {
    // Unlike marketState and P/E, chart meta DOES carry a previous close —
    // the daily chart needs it too — so this survives the crumb block that
    // takes pre/post prices and P/E dark in production.
    const client = new YahooClient({
      quote: async () => {
        throw new Error('Failed to get crumb, status 429, statusText: Too Many Requests');
      },
      chart: async () => ({
        meta: {
          symbol: 'APP',
          regularMarketPrice: 320.56,
          previousClose: 315.2,
        },
      }),
    } as never);

    const q = await client.quote('APP');
    expect(q?.previousClose).toBe(315.2);
  });

  /**
   * A 7-day daily chart's `chartPreviousClose` is the close BEFORE its first
   * bar — about a week back — not yesterday's. Production prices every quote
   * through this fallback, so using it turned "Day" into a weekly change
   * (probed 2026-09-25: TSLA chartPreviousClose 366.20, real previous close
   * 377.94). The previous session's close is the second-to-last daily bar.
   */
  it("takes the previous close from the bar before the last one, never chartPreviousClose", async () => {
    const client = new YahooClient({
      quote: async () => {
        throw new Error('Failed to get crumb, status 429, statusText: Too Many Requests');
      },
      chart: async () => ({
        meta: { symbol: 'TSLA', regularMarketPrice: 381.2, chartPreviousClose: 366.2 },
        quotes: [
          { date: new Date('2026-09-22T13:30:00Z'), close: 378.9 },
          { date: new Date('2026-09-23T13:30:00Z'), close: 380.12 },
          { date: new Date('2026-09-24T13:30:00Z'), close: 377.94 },
          { date: new Date('2026-09-25T13:30:00Z'), close: 381.2 },
        ],
      }),
    } as never);

    const q = await client.quote('TSLA');
    expect(q?.previousClose).toBe(377.94);
  });

  it('skips a bar with no close when finding the previous session', async () => {
    const client = new YahooClient({
      quote: async () => {
        throw new Error('Failed to get crumb, status 429, statusText: Too Many Requests');
      },
      chart: async () => ({
        meta: { symbol: 'TSLA', regularMarketPrice: 381.2 },
        quotes: [
          { date: new Date('2026-09-23T13:30:00Z'), close: 377.94 },
          { date: new Date('2026-09-24T13:30:00Z'), close: null },
          { date: new Date('2026-09-25T13:30:00Z'), close: 381.2 },
        ],
      }),
    } as never);

    expect((await client.quote('TSLA'))?.previousClose).toBe(377.94);
  });

  /** Unknown beats wrong: one bar gives no previous session to measure from. */
  it('nulls the previous close when the chart has fewer than two closes', async () => {
    const client = new YahooClient({
      quote: async () => {
        throw new Error('Failed to get crumb, status 429, statusText: Too Many Requests');
      },
      chart: async () => ({
        meta: { symbol: 'NEW', regularMarketPrice: 10, chartPreviousClose: 9 },
        quotes: [{ date: new Date('2026-09-25T13:30:00Z'), close: 10 }],
      }),
    } as never);

    expect((await client.quote('NEW'))?.previousClose).toBeNull();
  });
});

/**
 * The constructor's @Optional() `yf` parameter IS the test seam — read the
 * comment on it in yahoo.client.ts. Pass a fake there; never cast into the
 * private field.
 *
 * `as never` only because the real library type is enormous and this fake
 * implements the one method under test.
 */
const clientWith = (quoteSummary: unknown) =>
  new YahooClient({ quoteSummary } as never);

describe('YahooClient.consensus', () => {
  it('maps the provider payload to our own shape', async () => {
    const client = clientWith(
      vi.fn().mockResolvedValue({
        financialData: {
          recommendationMean: 1.28,
          recommendationKey: 'strong_buy',
          numberOfAnalystOpinions: 57,
          targetMeanPrice: 327.65,
          targetHighPrice: 515,
          targetLowPrice: 180,
          revenueGrowth: 1.059,
          earningsGrowth: 1.278,
          profitMargins: 0.63663,
          returnOnEquity: 1.17211,
        },
        recommendationTrend: {
          trend: [
            { period: '0m', strongBuy: 9, buy: 48, hold: 2, sell: 1, strongSell: 0 },
          ],
        },
      }),
    );

    const c = await client.consensus('NVDA');

    expect(c.status).toBe('ok');
    if (c.status !== 'ok') throw new Error('unreachable');
    expect(c.data.recommendationMean).toBeCloseTo(1.28, 2);
    expect(c.data.analystCount).toBe(57);
    expect(c.data.targetMean).toBeCloseTo(327.65, 2);
    expect(c.data.trend[0].buy).toBe(48);
  });

  /**
   * ETFs and thin names genuinely have no coverage — a resolved answer,
   * never a zero: a zero recommendationMean would read as "strong buy" on a
   * 1..5 scale, which is the worst possible way to be wrong.
   */
  it('reports no-coverage when nothing covers the ticker', async () => {
    const client = clientWith(vi.fn().mockResolvedValue({ financialData: {} }));
    expect(await client.consensus('SPY')).toEqual({ status: 'no-coverage' });
  });

  /**
   * A provider outage must not fail the ranking, but it also must not read
   * as "no coverage" — that is a different fact about the ticker than a
   * failed call, and conflating them is exactly the bug this state exists
   * to prevent.
   */
  it('reports unavailable, not no-coverage, when the provider fails', async () => {
    const client = clientWith(
      vi.fn().mockRejectedValue(new Error('network down')),
    );
    expect(await client.consensus('NVDA')).toEqual({ status: 'unavailable' });
  });
});
