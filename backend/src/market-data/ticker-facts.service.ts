import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { YahooClient } from './yahoo.client.js';
import { FundamentalsService } from './fundamentals.service.js';
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
}

/**
 * Everything the app can say about a ticker on its own, with no model
 * involved — the foundation the trade-idea opinion is built on, and useful by
 * itself.
 *
 * Deliberately writes NOTHING: `instruments` and `daily_closes` mean "things
 * the owner holds", and filling them with every name he merely looked at
 * would quietly change what those tables mean.
 */
@Injectable()
export class TickerFactsService {
  constructor(
    private readonly yahoo: YahooClient,
    private readonly fundamentals: FundamentalsService,
  ) {}

  async get(symbol: string): Promise<TickerFacts> {
    const upper = symbol.trim().toUpperCase();

    let quote: Awaited<ReturnType<YahooClient['quote']>>;
    try {
      quote = await this.yahoo.quote(upper);
    } catch {
      // The provider being down is not the same as the ticker not existing,
      // and must not read as "no such symbol". No partial answer is offered:
      // an opinion resting on half the facts is worse than none.
      throw new ServiceUnavailableException(
        'Market data is unavailable right now, so this ticker cannot be checked.',
      );
    }
    if (!quote) throw new NotFoundException(`Unknown ticker: ${upper}`);

    const from = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    let bars;
    try {
      bars = await this.yahoo.dailyBars(upper, from);
    } catch {
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
    }

    return {
      symbol: quote.symbol,
      name: quote.name,
      price: quote.price,
      // Always false, and deliberately so. The staleness rule elsewhere in
      // this app means "the provider failed, so serve the CACHED quote and
      // flag it" - but there is no cache for a ticker the owner does not
      // hold, so there is nothing stale to serve. A provider failure here
      // produces no facts at all (see the catch below), which is the honest
      // outcome. The field is kept so the shape does not change if this ever
      // reads through the quote cache.
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
    };
  }
}
