import { describe, expect, it, vi } from 'vitest';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { TickerFactsService } from './ticker-facts.service.js';
import type { YahooClient } from './yahoo.client.js';
import type { FundamentalsService } from './fundamentals.service.js';
import type { MarketDataService, Quote } from './market-data.service.js';
import type { HistoryService } from './history.service.js';
import type { Repository } from 'typeorm';
import type { Instrument } from '../instruments/instrument.entity.js';
import type { DailyClose } from './daily-close.entity.js';
import type { NewsService, NewsHeadline } from './news.service.js';

const QUOTE = {
  symbol: 'NVDA',
  name: 'NVIDIA',
  price: 200,
  currency: 'USD',
  session: 'REGULAR' as const,
  extended: false,
  regularPrice: 200,
  previousClose: 198,
  peRatio: 25,
};

const BARS = Array.from({ length: 60 }, (_, i) => ({
  date: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
  close: 200,
  adjClose: 200,
  open: 200,
  high: 202,
  low: 198,
  volume: 1_000_000,
}));

const STORED_INSTRUMENT = { id: 'i1', symbol: 'NVDA' } as Instrument;

/** A `DailyClose` row shaped from the same fixture, as it would sit in the DB. */
const STORED_ROWS = BARS.map((b) => ({ instrumentId: 'i1', ...b })) as DailyClose[];

function makeService(opts: {
  quote?: () => unknown;
  dailyBars?: () => unknown;
  peekFreshQuote?: () => Quote | null;
  findInstrument?: () => Instrument | null;
  storedRows?: () => DailyClose[];
  recentHeadlines?: () => Promise<NewsHeadline[]>;
} = {}) {
  const yahoo = {
    quote: vi.fn().mockImplementation(opts.quote ?? (async () => QUOTE)),
    dailyBars: vi.fn().mockImplementation(opts.dailyBars ?? (async () => BARS)),
  } as unknown as YahooClient;
  const fundamentals = {
    peRatio: vi.fn().mockResolvedValue(null),
  } as unknown as FundamentalsService;
  // Empty by default: most tests exercise the direct-fetch path, the same
  // one that ran before this file had a cache to reuse at all.
  const marketData = {
    peekFreshQuote: vi.fn().mockImplementation(opts.peekFreshQuote ?? (() => null)),
  } as unknown as MarketDataService;
  const history = {
    ensureFresh: vi.fn().mockResolvedValue(undefined),
  } as unknown as HistoryService;
  const instruments = {
    findOne: vi
      .fn()
      .mockImplementation(async () => (opts.findInstrument ?? (() => null))()),
  } as unknown as Repository<Instrument>;
  const closes = {
    find: vi
      .fn()
      .mockImplementation(async () => (opts.storedRows ?? (() => []))()),
  } as unknown as Repository<DailyClose>;
  const news = {
    recentHeadlines: vi
      .fn()
      .mockImplementation(opts.recentHeadlines ?? (async () => [])),
  } as unknown as NewsService;
  return {
    service: new TickerFactsService(
      yahoo,
      fundamentals,
      marketData,
      history,
      instruments,
      closes,
      news,
    ),
    yahoo,
    marketData,
    history,
    instruments,
    closes,
    news,
  };
}

describe('TickerFactsService.get', () => {
  it('asks for the quote and the history at once, not one after the other', async () => {
    // They need nothing from each other, and the request used to wait
    // through both round trips in series before the model was even called.
    const order: string[] = [];
    const { service } = makeService({
      quote: async () => {
        order.push('quote:start');
        await new Promise((r) => setTimeout(r, 10));
        order.push('quote:end');
        return QUOTE;
      },
      dailyBars: async () => {
        order.push('bars:start');
        return BARS;
      },
    });

    await service.get('NVDA');

    // Bars begin before the quote has come back — impossible if serial.
    expect(order.indexOf('bars:start')).toBeLessThan(order.indexOf('quote:end'));
  });

  it('404s a ticker the provider does not recognise', async () => {
    const { service } = makeService({ quote: async () => null });
    await expect(service.get('ZZZZNOTREAL')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('503s when the quote fails, rather than reading as "no such symbol"', async () => {
    const { service } = makeService({
      quote: async () => {
        throw new Error('provider down');
      },
    });
    await expect(service.get('NVDA')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('503s when only the history fails, rather than answering on half the facts', async () => {
    const { service } = makeService({
      dailyBars: async () => {
        throw new Error('history down');
      },
    });
    await expect(service.get('NVDA')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('reports an unknown ticker as unknown even when the history also fails', async () => {
    // Both settle as failures now that they run together; which one the
    // caller is told about must not depend on that race.
    const { service } = makeService({
      quote: async () => null,
      dailyBars: async () => {
        throw new Error('history down');
      },
    });
    await expect(service.get('ZZZZNOTREAL')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('TickerFactsService.get — reusing what the rest of the app already fetched', () => {
  it('uses a fresh cached quote instead of asking the provider again', async () => {
    const cached = { ...QUOTE, stale: false, session: 'REGULAR' as const } as Quote;
    const { service, yahoo } = makeService({ peekFreshQuote: () => cached });

    const facts = await service.get('NVDA');

    expect(facts.price).toBe(200);
    expect(yahoo.quote).not.toHaveBeenCalled();
  });

  it('asks the provider directly when nothing fresh is cached', async () => {
    const { service, yahoo } = makeService({ peekFreshQuote: () => null });
    await service.get('NVDA');
    expect(yahoo.quote).toHaveBeenCalledWith('NVDA');
  });

  it('still 503s on a provider failure even though the cache was checked first', async () => {
    // The cache miss must fall through to the SAME failure handling as
    // before — a caller cannot afford peekFreshQuote's null to be confused
    // with "the ticker does not exist".
    const { service } = makeService({
      peekFreshQuote: () => null,
      quote: async () => {
        throw new Error('provider down');
      },
    });
    await expect(service.get('NVDA')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('reuses stored daily bars for an instrument already tracked, without asking the provider', async () => {
    const { service, yahoo } = makeService({
      findInstrument: () => STORED_INSTRUMENT,
      storedRows: () => STORED_ROWS,
    });

    await service.get('NVDA');

    expect(yahoo.dailyBars).not.toHaveBeenCalled();
  });

  it('tops up stored history before reusing it, so a reused bar is never mistaken for today', async () => {
    const { service, history } = makeService({
      findInstrument: () => STORED_INSTRUMENT,
      storedRows: () => STORED_ROWS,
    });

    await service.get('NVDA');

    expect(history.ensureFresh).toHaveBeenCalled();
  });

  it('falls back to the provider for a symbol with no tracked instrument', async () => {
    const { service, yahoo, instruments } = makeService({
      findInstrument: () => null,
    });

    await service.get('NVDA');

    expect(instruments.findOne).toHaveBeenCalled();
    expect(yahoo.dailyBars).toHaveBeenCalledWith('NVDA', expect.any(Date));
  });

  it('falls back to the provider when the instrument is tracked but has no stored bars yet', async () => {
    const { service, yahoo } = makeService({
      findInstrument: () => STORED_INSTRUMENT,
      storedRows: () => [],
    });

    await service.get('NVDA');

    expect(yahoo.dailyBars).toHaveBeenCalled();
  });

  /**
   * The invariant this whole class exists to protect: a name merely looked
   * at must never start meaning "the owner holds or watches this". The fake
   * repositories below expose ONLY read methods (`findOne`/`find`) — no
   * `save`, `create` or `upsert` at all — so a request for an untracked
   * symbol succeeding here is only possible if the fallback path never
   * tries to write one into existence; a stray write call would throw
   * ("... is not a function") and fail the test.
   */
  it('never creates an instrument or writes a daily_closes row for an untracked symbol', async () => {
    const { service } = makeService({ findInstrument: () => null });
    await expect(service.get('NVDA')).resolves.toMatchObject({ symbol: 'NVDA' });
  });
});

describe('TickerFactsService.get — recent news', () => {
  const HEADLINE: NewsHeadline = {
    headline: 'NVO partners with Anthropic to accelerate medicine development',
    summary: 'A multi-year partnership.',
    source: 'Reuters',
    publishedOn: '2026-09-16',
    url: 'https://example.com/1',
  };

  it('carries recent headlines through onto the facts', async () => {
    const { service } = makeService({
      recentHeadlines: async () => [HEADLINE],
    });

    const facts = await service.get('NVDA');

    expect(facts.news).toEqual([HEADLINE]);
  });

  it('is an empty list, not a failure, when there is no recent news', async () => {
    const { service } = makeService({ recentHeadlines: async () => [] });
    const facts = await service.get('NVDA');
    expect(facts.news).toEqual([]);
  });

  /**
   * News is enrichment on a trade idea, not a fact it depends on — unlike
   * the quote and the bars, a news outage must never take the whole idea
   * down. NewsService itself never throws (see its own doc comment), but
   * this pins the degrade-to-empty behavior at this layer too, in case that
   * contract is ever broken upstream.
   */
  it('degrades to an empty list rather than failing the whole request when news fails', async () => {
    const { service } = makeService({
      recentHeadlines: async () => {
        throw new Error('finnhub down');
      },
    });

    const facts = await service.get('NVDA');

    expect(facts.news).toEqual([]);
    expect(facts.symbol).toBe('NVDA');
  });

  it('fetches news alongside the quote and the bars, not after them', async () => {
    const order: string[] = [];
    const { service } = makeService({
      quote: async () => {
        order.push('quote:start');
        await new Promise((r) => setTimeout(r, 10));
        order.push('quote:end');
        return QUOTE;
      },
      recentHeadlines: async () => {
        order.push('news:start');
        return [];
      },
    });

    await service.get('NVDA');

    expect(order.indexOf('news:start')).toBeLessThan(order.indexOf('quote:end'));
  });

  it('asks the news service for the symbol it was given', async () => {
    const { service, news } = makeService();
    await service.get('nvda');
    expect(news.recentHeadlines).toHaveBeenCalledWith('NVDA');
  });
});
