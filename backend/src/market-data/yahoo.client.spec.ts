import { describe, expect, it } from 'vitest';
import { YahooClient } from './yahoo.client.js';

function clientWith(fake: Record<string, unknown>): YahooClient {
  return new YahooClient(fake as never);
}

describe('YahooClient.lookup', () => {
  it('returns the upper-cased symbol and the long name', async () => {
    const client = clientWith({
      quote: async () => ({ symbol: 'nvda', longName: 'NVIDIA Corporation', shortName: 'NVIDIA' }),
    });
    expect(await client.lookup('nvda')).toEqual({ symbol: 'NVDA', name: 'NVIDIA Corporation' });
  });

  it('falls back to the short name, then to null', async () => {
    const short = clientWith({ quote: async () => ({ symbol: 'AAPL', shortName: 'Apple' }) });
    expect(await short.lookup('AAPL')).toEqual({ symbol: 'AAPL', name: 'Apple' });
    const none = clientWith({ quote: async () => ({ symbol: 'AAPL' }) });
    expect(await none.lookup('AAPL')).toEqual({ symbol: 'AAPL', name: null });
  });

  it('returns null when Yahoo has no such symbol', async () => {
    expect(await clientWith({ quote: async () => undefined }).lookup('ZZZZ')).toBeNull();
    expect(await clientWith({ quote: async () => ({}) }).lookup('ZZZZ')).toBeNull();
  });

  it('throws on provider failure', async () => {
    const client = clientWith({
      quote: async () => {
        throw new Error('429');
      },
    });
    await expect(client.lookup('NVDA')).rejects.toThrow('429');
  });
});

describe('YahooClient.nextEarnings', () => {
  const summary = (earnings: unknown) => ({ quoteSummary: async () => ({ calendarEvents: { earnings } }) });

  it('returns the first earnings date and the estimate flag', async () => {
    const d = new Date('2026-11-19T21:00:00Z');
    const client = clientWith(summary({ earningsDate: [d, new Date('2026-11-23T00:00:00Z')], isEarningsDateEstimate: true }));
    expect(await client.nextEarnings('NVDA')).toEqual({ at: d, estimated: true });
  });

  it('treats a missing estimate flag as confirmed', async () => {
    const d = new Date('2026-11-19T21:00:00Z');
    const client = clientWith(summary({ earningsDate: [d] }));
    expect(await client.nextEarnings('NVDA')).toEqual({ at: d, estimated: false });
  });

  it('returns null when there is no upcoming date', async () => {
    expect(await clientWith(summary({ earningsDate: [] })).nextEarnings('X')).toBeNull();
    expect(await clientWith({ quoteSummary: async () => ({}) }).nextEarnings('X')).toBeNull();
  });

  it('returns null for ETFs ("No fundamentals data found")', async () => {
    const client = clientWith({
      quoteSummary: async () => {
        throw new Error('No fundamentals data found for symbol: QQQ');
      },
    });
    expect(await client.nextEarnings('QQQ')).toBeNull();
  });

  it('throws on other provider failures', async () => {
    const client = clientWith({
      quoteSummary: async () => {
        throw new Error('network down');
      },
    });
    await expect(client.nextEarnings('NVDA')).rejects.toThrow('network down');
  });
});
