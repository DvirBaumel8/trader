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
  session: 'REGULAR',
  extended: false,
  regularPrice: 168.2,
  previousClose: 165.0,
  peRatio: null,
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

  describe('peekFreshQuote', () => {
    // A caller that wants to skip a redundant round trip when a fresh quote
    // already exists elsewhere, but must ask the provider itself (and keep
    // its own failure handling) on a miss — never a network call from here.
    it('returns a cached quote still within TTL, without calling the provider', async () => {
      let calls = 0;
      const svc = new MarketDataService(fakeClient([NVDA], () => calls++));
      await svc.getQuote('NVDA');

      const peeked = svc.peekFreshQuote('NVDA');

      expect(peeked?.price).toBe(168.2);
      expect(calls).toBe(1);
    });

    it('is case-insensitive, like every other lookup here', async () => {
      const svc = new MarketDataService(fakeClient([NVDA]));
      await svc.getQuote('NVDA');
      expect(svc.peekFreshQuote('nvda')?.price).toBe(168.2);
    });

    it('returns null for a symbol never quoted', () => {
      const svc = new MarketDataService(fakeClient([NVDA]));
      expect(svc.peekFreshQuote('NVDA')).toBeNull();
    });

    it('returns null once the cached quote has aged past the TTL', async () => {
      const svc = new MarketDataService(fakeClient([NVDA]), 0); // ttl 0
      await svc.getQuote('NVDA');
      expect(svc.peekFreshQuote('NVDA')).toBeNull();
    });
  });

  it('fetches many symbols in one provider call', async () => {
    let calls = 0;
    const svc = new MarketDataService(
      fakeClient(
        [
          NVDA,
          {
            symbol: 'AAPL',
            name: 'Apple',
            price: 214,
            currency: 'USD',
            session: 'REGULAR',
            extended: false,
            regularPrice: 214,
            previousClose: 210,
            peRatio: null,
          },
        ],
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

  it('carries the trading session, extended flag and previous close through', async () => {
    const afterHours: RawQuote = {
      symbol: 'NVDA',
      name: 'NVIDIA',
      price: 217.73,
      currency: 'USD',
      session: 'POST',
      extended: true,
      regularPrice: 217.55,
      previousClose: 212.1,
      peRatio: null,
    };
    const svc = new MarketDataService(fakeClient([afterHours]));
    const q = await svc.getQuote('NVDA');
    expect(q).toMatchObject({
      price: 217.73,
      session: 'POST',
      extended: true,
      regularPrice: 217.55,
      previousClose: 212.1,
    });
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

  describe('a second opinion from Twelve Data', () => {
    const noExtendedPrint: RawQuote = {
      symbol: 'NVDA',
      name: 'NVIDIA',
      price: 217.55,
      currency: 'USD',
      session: 'POST',
      extended: false,
      regularPrice: 217.55,
      previousClose: 212.1,
      peRatio: null,
    };

    function fakeTwelveData(price: number | null, timestamp: Date = new Date()) {
      const calls: string[] = [];
      return {
        client: {
          isConfigured: () => true,
          extendedPrice: async (symbol: string) => {
            calls.push(symbol);
            return price === null ? null : { price, timestamp };
          },
        } as unknown as import('./twelvedata.client.js').TwelveDataClient,
        calls,
      };
    }

    it('asks Twelve Data when Yahoo had no extended print for a PRE/POST/OVERNIGHT session', async () => {
      const { client, calls } = fakeTwelveData(218.4);
      const svc = new MarketDataService(
        fakeClient([noExtendedPrint]),
        undefined,
        client,
      );

      const q = await svc.getQuote('NVDA');

      expect(calls).toEqual(['NVDA']);
      expect(q).toMatchObject({ price: 218.4, extended: true, session: 'POST' });
    });

    it('keeps Yahoo\'s own price when Twelve Data has nothing either', async () => {
      const { client } = fakeTwelveData(null);
      const svc = new MarketDataService(
        fakeClient([noExtendedPrint]),
        undefined,
        client,
      );

      const q = await svc.getQuote('NVDA');

      expect(q).toMatchObject({ price: 217.55, extended: false });
    });

    it('never asks Twelve Data when Yahoo already gave a real extended print', async () => {
      const withExtended: RawQuote = { ...noExtendedPrint, extended: true, price: 219.0 };
      const { client, calls } = fakeTwelveData(999);
      const svc = new MarketDataService(
        fakeClient([withExtended]),
        undefined,
        client,
      );

      const q = await svc.getQuote('NVDA');

      expect(calls).toEqual([]);
      expect(q?.price).toBe(219.0);
    });

    it('never asks Twelve Data during a regular session', async () => {
      const { client, calls } = fakeTwelveData(999);
      const svc = new MarketDataService(fakeClient([NVDA]), undefined, client);

      await svc.getQuote('NVDA');

      expect(calls).toEqual([]);
    });

    it('asks Twelve Data on a plain CLOSED session too — a weekend has no fresher print either', async () => {
      // The exact case this was missing: a quote with no extended print at
      // all and session CLOSED (weekend, or a provider explicitly saying so)
      // is indistinguishable from OVERNIGHT for pricing purposes — both mean
      // "no live session, show the last known trade" (see select-price.ts).
      const closedNoExtended: RawQuote = { ...noExtendedPrint, session: 'CLOSED' };
      const { client, calls } = fakeTwelveData(218.4);
      const svc = new MarketDataService(
        fakeClient([closedNoExtended]),
        undefined,
        client,
      );

      const q = await svc.getQuote('NVDA');

      expect(calls).toEqual(['NVDA']);
      expect(q).toMatchObject({ price: 218.4, extended: true });
    });

    it('rejects a Twelve Data print carried over from a prior session', async () => {
      // The exact NBIS/MSTR bug found live: Twelve Data returned a print with
      // no error, but its own timestamp gave away that it was days stale.
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const { client, calls } = fakeTwelveData(218.4, threeDaysAgo);
      const svc = new MarketDataService(
        fakeClient([noExtendedPrint]),
        undefined,
        client,
      );

      const q = await svc.getQuote('NVDA');

      expect(calls).toEqual(['NVDA']);
      expect(q).toMatchObject({ price: 217.55, extended: false });
    });

    it('still trusts a stale-looking print when the market is CLOSED', async () => {
      // A weekend genuinely has nothing fresher than Friday's print.
      const closedNoExtended: RawQuote = { ...noExtendedPrint, session: 'CLOSED' };
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const { client } = fakeTwelveData(218.4, threeDaysAgo);
      const svc = new MarketDataService(
        fakeClient([closedNoExtended]),
        undefined,
        client,
      );

      const q = await svc.getQuote('NVDA');

      expect(q).toMatchObject({ price: 218.4, extended: true });
    });

    it('applies the same second opinion in a batch call', async () => {
      const { client, calls } = fakeTwelveData(218.4);
      const svc = new MarketDataService(
        fakeClient([noExtendedPrint]),
        undefined,
        client,
      );

      const map = await svc.getQuotes(['NVDA']);

      expect(calls).toEqual(['NVDA']);
      expect(map.get('NVDA')).toMatchObject({ price: 218.4, extended: true });
    });

    it('skips Twelve Data entirely when the caller passes augment: false', async () => {
      // The watchlist's own call — a shared 8-requests-a-minute budget must
      // not go to a decorative price when account value and Stops need it.
      const { client, calls } = fakeTwelveData(218.4);
      const svc = new MarketDataService(
        fakeClient([noExtendedPrint]),
        undefined,
        client,
      );

      const map = await svc.getQuotes(['NVDA'], false, false);

      expect(calls).toEqual([]);
      expect(map.get('NVDA')).toMatchObject({ price: 217.55, extended: false });
    });
  });
});
