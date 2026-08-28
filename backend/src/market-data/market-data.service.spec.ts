import { MarketDataService } from './market-data.service.js';
import type { YahooClient, RawQuote } from './yahoo.client.js';

function fakeClient(quotes: RawQuote[], onCall: () => void = () => {}) {
  return {
    quote: async (s: string) => {
      onCall();
      return quotes.find((q) => q.symbol === s) ?? null;
    },
    quoteMany: async (symbols: string[]) => {
      onCall();
      return quotes.filter((q) => symbols.includes(q.symbol));
    },
  } as unknown as YahooClient;
}

const NVDA: RawQuote = {
  symbol: 'NVDA',
  name: 'NVIDIA',
  price: 168.2,
  currency: 'USD',
};

describe('MarketDataService', () => {
  it('returns a fresh quote from the provider', async () => {
    const svc = new MarketDataService(fakeClient([NVDA]));
    const q = await svc.getQuote('NVDA');
    expect(q).toMatchObject({
      symbol: 'NVDA',
      name: 'NVIDIA',
      price: 168.2,
      stale: false,
    });
    expect(q?.fetchedAt).toBeInstanceOf(Date);
  });

  it('uppercases the symbol before lookup', async () => {
    const svc = new MarketDataService(fakeClient([NVDA]));
    const q = await svc.getQuote('nvda');
    expect(q?.price).toBe(168.2);
  });

  it('serves a cached quote without calling the provider again', async () => {
    let calls = 0;
    const svc = new MarketDataService(fakeClient([NVDA], () => calls++));
    await svc.getQuote('NVDA');
    await svc.getQuote('NVDA');
    expect(calls).toBe(1);
  });

  it('returns null for an unknown symbol', async () => {
    const svc = new MarketDataService(fakeClient([]));
    expect(await svc.getQuote('NOTREAL')).toBeNull();
  });

  it('falls back to the cached price and marks it stale when the provider fails', async () => {
    let shouldFail = false;
    const client = {
      quote: async (s: string) => {
        if (shouldFail) throw new Error('network down');
        return s === 'NVDA' ? NVDA : null;
      },
      quoteMany: async () => [],
    } as unknown as YahooClient;

    const svc = new MarketDataService(client, 0); // ttl 0 => always refetch
    await svc.getQuote('NVDA');
    shouldFail = true;
    const q = await svc.getQuote('NVDA');
    expect(q).toMatchObject({ price: 168.2, stale: true });
    expect(q?.fetchedAt).toBeInstanceOf(Date);
  });

  it('returns null when the provider fails and nothing is cached', async () => {
    const client = {
      quote: async () => {
        throw new Error('network down');
      },
      quoteMany: async () => [],
    } as unknown as YahooClient;
    const svc = new MarketDataService(client);
    expect(await svc.getQuote('NVDA')).toBeNull();
  });

  it('fetches many symbols in one provider call', async () => {
    let calls = 0;
    const svc = new MarketDataService(
      fakeClient(
        [NVDA, { symbol: 'AAPL', name: 'Apple', price: 214, currency: 'USD' }],
        () => calls++,
      ),
    );
    const map = await svc.getQuotes(['NVDA', 'AAPL']);
    expect(calls).toBe(1);
    expect(map.get('NVDA')?.price).toBe(168.2);
    expect(map.get('AAPL')?.price).toBe(214);
  });

  it('bypasses the cache when a refresh is forced', async () => {
    let calls = 0;
    const svc = new MarketDataService(fakeClient([NVDA], () => calls++));
    await svc.getQuote('NVDA');
    await svc.getQuote('NVDA'); // cached
    expect(calls).toBe(1);
    await svc.getQuote('NVDA', true); // forced
    expect(calls).toBe(2);
  });

  it('bypasses the cache for a forced batch refresh', async () => {
    let calls = 0;
    const svc = new MarketDataService(fakeClient([NVDA], () => calls++));
    await svc.getQuotes(['NVDA']);
    await svc.getQuotes(['NVDA']); // cached
    expect(calls).toBe(1);
    await svc.getQuotes(['NVDA'], true); // forced
    expect(calls).toBe(2);
  });

  it('deduplicates symbols and ignores case in a batch', async () => {
    let calls = 0;
    const svc = new MarketDataService(fakeClient([NVDA], () => calls++));
    const map = await svc.getQuotes(['NVDA', 'nvda', 'NVDA']);
    expect(calls).toBe(1);
    expect(map.size).toBe(1);
  });

  it('omits symbols the provider does not know from a batch', async () => {
    const svc = new MarketDataService(fakeClient([NVDA]));
    const map = await svc.getQuotes(['NVDA', 'ZZZZNOTREAL']);
    expect(map.has('NVDA')).toBe(true);
    expect(map.has('ZZZZNOTREAL')).toBe(false);
  });
});
