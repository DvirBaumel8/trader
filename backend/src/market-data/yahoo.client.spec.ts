import { describe, expect, it } from 'vitest';
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
