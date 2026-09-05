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
