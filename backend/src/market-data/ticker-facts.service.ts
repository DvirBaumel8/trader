import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { YahooClient, type RawQuote, type RawBar } from './yahoo.client.js';
import { FundamentalsService } from './fundamentals.service.js';
import { MarketDataService, type Quote } from './market-data.service.js';
import { HistoryService } from './history.service.js';
import { NewsService, type NewsHeadline } from './news.service.js';
import { DailyClose } from './daily-close.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { computeIndicators, type IndicatorSet } from './indicators.js';
import { computePriceAction, type PriceAction } from './price-action.js';

/** How much history to ask for: enough for a 200-day average with room to spare. */
const LOOKBACK_DAYS = 500;

export interface TickerFacts {
  symbol: string;
  name: string | null;
  price: number;
  /** True when the quote could not be refreshed — an opinion about a price is only as good as the price. */
  stale: boolean;
  session: string | null;
  extended: boolean;
  peRatio: number | null;
  indicators: IndicatorSet;
  /** How it has actually traded today and this week. Null with no bars. */
  priceAction: PriceAction | null;
  /** Recent company-specific headlines, newest first. Empty, never missing, when there is none. */
  news: NewsHeadline[];
}

/**
 * Everything the app can say about a ticker on its own, with no model
 * involved — the foundation the trade-idea opinion is built on, and useful by
 * itself.
 *
 * Deliberately writes NOTHING: `instruments` and `daily_closes` mean "things
 * the owner holds", and filling them with every name he merely looked at
 * would quietly change what those tables mean. Both fast paths below are
 * pure reads for exactly that reason — they reuse a row that already exists
 * for some other reason (held, watched, or freshly polled), never create one.
 */
@Injectable()
export class TickerFactsService {
  constructor(
    private readonly yahoo: YahooClient,
    private readonly fundamentals: FundamentalsService,
    private readonly marketData: MarketDataService,
    private readonly history: HistoryService,
    @InjectRepository(Instrument)
    private readonly instruments: Repository<Instrument>,
    @InjectRepository(DailyClose)
    private readonly closes: Repository<DailyClose>,
    private readonly news: NewsService,
  ) {}

  async get(symbol: string): Promise<TickerFacts> {
    const upper = symbol.trim().toUpperCase();

    // The quote, the history and recent news need nothing from each other —
    // only the symbol — so they are asked for at once rather than one after
    // another. Quote and bars are still judged in the order they used to
    // run, so an unknown ticker is still a 404 and not whichever failure
    // happened to settle first. The cost is one wasted history/news fetch
    // for a symbol that turns out not to exist, which is a typo's worth of
    // traffic against a round trip saved on every real one.
    const from = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const [quoteResult, barsResult, newsResult] = await Promise.allSettled([
      this.resolveQuote(upper),
      this.resolveBars(upper, from),
      this.news.recentHeadlines(upper),
    ]);

    let quote: RawQuote | Quote | null;
    if (quoteResult.status === 'rejected') {
      // The provider being down is not the same as the ticker not existing,
      // and must not read as "no such symbol". No partial answer is offered:
      // an opinion resting on half the facts is worse than none.
      throw new ServiceUnavailableException(
        'Market data is unavailable right now, so this ticker cannot be checked.',
      );
    } else {
      quote = quoteResult.value;
    }
    if (!quote) throw new NotFoundException(`Unknown ticker: ${upper}`);

    let bars;
    if (barsResult.status === 'rejected') {
      // The quote can succeed while history fails — this is a real,
      // possible split, not a hypothetical. It would be tempting to return
      // quote-only facts with null indicators in that case, but that is a
      // partial answer wearing the same shape as a complete one, and the
      // caller has no field to tell the two apart. So a bars-only outage
      // takes down the whole request, same as a quote outage: no partial
      // answer is ever returned.
      throw new ServiceUnavailableException(
        'Price history is unavailable right now, so this ticker cannot be checked.',
      );
    } else {
      bars = barsResult.value;
    }

    // Unlike the quote and the bars, news is enrichment, not a fact the idea
    // depends on: a Finnhub hiccup must never take down a trade idea the
    // price provider answered perfectly well. NewsService itself never
    // throws, so this only matters if that contract is ever broken upstream.
    const news = newsResult.status === 'fulfilled' ? newsResult.value : [];

    return {
      symbol: quote.symbol,
      name: quote.name,
      price: quote.price,
      // Always false, and deliberately so. `resolveQuote` only ever returns
      // a quote that is either freshly fetched or peeked while still within
      // the shared cache's TTL — never a degraded stale fallback — so there
      // is never anything stale to flag here.
      stale: false,
      session: quote.session ?? null,
      extended: quote.extended,
      // The quote's own P/E when it has one. It does not in production: the
      // price comes from Yahoo's chart endpoint there, which carries no
      // fundamentals, so the multiple is computed from a separate provider's
      // trailing EPS instead.
      peRatio: quote.peRatio ?? (await this.fundamentals.peRatio(upper, quote.price)),
      indicators: computeIndicators(bars, quote.price),
      // From the bars already fetched above — no extra provider call.
      priceAction: computePriceAction(bars),
      news,
    };
  }

  /**
   * A fresh quote already sitting in the shared cache (the portfolio poll,
   * the watchlist, a refresh button) is reused instead of asking Yahoo
   * again — already carrying `MarketDataService`'s own extended-hours
   * augmentation, so nothing more is needed here.
   *
   * A miss still goes straight to `this.yahoo.quote` rather than
   * `MarketDataService.getQuote`, preserving the exact throw-on-failure
   * behavior `get` depends on to tell "the provider is down" apart from "the
   * ticker does not exist" (`getQuote` deliberately swallows a provider
   * failure into a stale-or-null return, which this cannot afford). But the
   * raw quote that comes back is run through the SAME `augmentWithExtended`
   * `getQuote` itself applies — without this, a symbol nothing else has
   * warmed in the quote cache would silently reason from a stale
   * regular-session close during pre/post-market, exactly the bug found
   * live on IONQ's after-hours news jump.
   */
  private async resolveQuote(symbol: string): Promise<RawQuote | Quote | null> {
    const cached = this.marketData.peekFreshQuote(symbol);
    if (cached) return cached;
    const raw = await this.yahoo.quote(symbol);
    if (!raw) return null;
    return this.marketData.augmentWithExtended(raw);
  }

  /**
   * Reuses this instrument's own `daily_closes` rows when it is already
   * tracked (held or watched) — the common case, since a trade idea or
   * symbol pattern is usually asked about a name already on screen
   * elsewhere — rather than re-fetching 500 days of history from Yahoo.
   *
   * Topped up first via `HistoryService.ensureFresh()` (debounced globally,
   * so a repeat call here is nearly free) so a reused row is never mistaken
   * for today: `computePriceAction` trusts the bars' own last entry AS
   * today, so a row that is actually a few days stale would misreport what
   * "today" did.
   *
   * Falls back to a direct fetch — never persisted — for a symbol with no
   * tracked instrument, or one that is tracked but not primed with bars yet.
   */
  private async resolveBars(symbol: string, from: Date): Promise<RawBar[]> {
    const instrument = await this.instruments.findOne({ where: { symbol } });
    if (instrument) {
      await this.history.ensureFresh();
      const fromDay = from.toISOString().slice(0, 10);
      const rows = (
        await this.closes.find({ where: { instrumentId: instrument.id } })
      ).filter((r) => r.date >= fromDay);
      if (rows.length > 0) {
        return rows
          .map((r) => ({
            date: r.date,
            close: r.close,
            adjClose: r.adjClose,
            open: r.open,
            high: r.high,
            low: r.low,
            volume: r.volume,
          }))
          .sort((a, b) => a.date.localeCompare(b.date));
      }
    }
    return this.yahoo.dailyBars(symbol, from);
  }
}
