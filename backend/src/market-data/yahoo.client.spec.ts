import { describe, expect, it } from 'vitest';
import { YahooClient } from './yahoo.client.js';

function clientReturning(quotes: unknown[]): YahooClient {
  // The adapter only ever calls .chart() here; the rest of the Yahoo surface
  // is irrelevant to bar mapping.
  const fake = { chart: async () => ({ quotes }) };
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
    });
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
