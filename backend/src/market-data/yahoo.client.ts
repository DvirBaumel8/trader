import { Injectable, Optional } from '@nestjs/common';
import YahooFinance from 'yahoo-finance2';
import { selectPrice, type MarketSession } from './select-price.js';

export interface RawQuote {
  symbol: string;
  name: string | null;
  price: number;
  currency: string | null;
  session: MarketSession;
  /** True when `price` is an extended-hours print rather than the close. */
  extended: boolean;
  /** The regular-session price, kept so the UI can show the move since close. */
  regularPrice: number | null;
  /**
   * Trailing P/E, the conventional reading of "P/E". Null — never 0 — when
   * Yahoo has none (no trailing earnings figure) or reports a non-positive
   * value: a company with negative or zero trailing earnings has no
   * meaningful multiple, so a raw negative number would read as real but
   * mean nothing. Common for ETFs to have one and for unprofitable
   * growth names not to — both cases the owner explicitly trades.
   */
  peRatio: number | null;
}

export interface RawBar {
  date: string; // YYYY-MM-DD
  close: number;
  adjClose: number;
  /** Intraday range. Null when Yahoo omits it for that bar. */
  open: number | null;
  high: number | null;
  low: number | null;
  /** Shares traded that day. Null when Yahoo omits it for that bar. */
  volume: number | null;
}

/** The shape we actually read off a Yahoo quote, regardless of its full type. */
interface QuoteLike {
  symbol?: string;
  shortName?: string;
  longName?: string;
  regularMarketPrice?: number;
  preMarketPrice?: number;
  postMarketPrice?: number;
  marketState?: string;
  currency?: string;
  trailingPE?: number;
}

/**
 * The only file permitted to import yahoo-finance2. Everything else depends on
 * this interface, so swapping the data provider touches exactly one file.
 */
@Injectable()
export class YahooClient {
  private readonly yf: InstanceType<typeof YahooFinance>;

  // `yf` is optional and unregistered with Nest on purpose: yahoo-finance2 is
  // not a Nest provider, so an undecorated required parameter would fail to
  // resolve at bootstrap. @Optional() lets Nest pass `undefined`, which falls
  // through to the real client below; tests pass a fake directly, bypassing
  // Nest entirely.
  constructor(@Optional() yf?: InstanceType<typeof YahooFinance>) {
    this.yf = yf ?? new YahooFinance({ suppressNotices: ['yahooSurvey'] });
  }

  async quote(symbol: string): Promise<RawQuote | null> {
    // An unknown ticker resolves to undefined here rather than throwing.
    const raw = (await this.yf.quote(symbol)) as QuoteLike | undefined;
    return toRawQuote(raw);
  }

  /**
   * The highest and lowest price traded since `from`, INCLUDING pre-market
   * and after-hours.
   *
   * Daily bars carry the regular session only, so a trailing stop resolved
   * from them ignores extended prints entirely: BITX peaked around $19.55
   * outside regular hours on 2026-09-03, the daily high was $19.21, and the
   * app's trail sat $0.30 below the broker's as a result.
   *
   * Hourly rather than minute bars: minute data is capped at a few days,
   * hourly reaches back far enough for a position held for months, and an
   * hour's high is still a real traded price. The cost of the coarser
   * interval is that a spike inside an hour is captured by that hour's high
   * anyway — highs do not average out.
   */
  async extremesIncludingExtended(
    symbol: string,
    from: Date,
  ): Promise<{ high: number | null; low: number | null }> {
    const result = await this.yf.chart(symbol, {
      period1: from,
      period2: new Date(),
      interval: '1h',
      includePrePost: true,
    });
    const quotes = (result?.quotes ?? []) as {
      high?: number | null;
      low?: number | null;
    }[];

    let high: number | null = null;
    let low: number | null = null;
    for (const q of quotes) {
      if (typeof q.high === 'number' && Number.isFinite(q.high)) {
        high = high === null ? q.high : Math.max(high, q.high);
      }
      if (typeof q.low === 'number' && Number.isFinite(q.low)) {
        low = low === null ? q.low : Math.min(low, q.low);
      }
    }
    return { high, low };
  }

  /**
   * Daily bars from `from` to today. Yahoo's chart endpoint takes ONE symbol
   * per call — arrays are rejected — so callers loop.
   */
  async dailyBars(symbol: string, from: Date): Promise<RawBar[]> {
    const result = await this.yf.chart(symbol, {
      period1: from,
      period2: new Date(),
      interval: '1d',
    });
    const quotes = (result?.quotes ?? []) as {
      date: Date | string;
      open?: number | null;
      high?: number | null;
      low?: number | null;
      close?: number | null;
      adjclose?: number | null;
      volume?: number | null;
    }[];

    const finite = (n: number | null | undefined): number | null =>
      typeof n === 'number' && Number.isFinite(n) ? n : null;

    return quotes
      .map((q) => {
        const close = q.close;
        if (typeof close !== 'number' || !Number.isFinite(close)) return null;
        return {
          date: new Date(q.date).toISOString().slice(0, 10),
          close,
          // A bar without an adjusted close falls back to the raw one rather
          // than being dropped; the difference only matters across dividends.
          adjClose:
            typeof q.adjclose === 'number' && Number.isFinite(q.adjclose)
              ? q.adjclose
              : close,
          // A bar missing part of its range is still worth its close: the
          // chart skips that candle, the benchmark is unaffected.
          open: finite(q.open),
          high: finite(q.high),
          low: finite(q.low),
          volume: finite(q.volume),
        };
      })
      .filter((b): b is RawBar => b !== null)
      // Chronological, once, here. The provider is not contracted to return
      // bars in order, and every consumer downstream assumes it is: the
      // trade chart draws them in array order, and computePriceAction takes
      // the LAST element as today — so an out-of-order payload would name the
      // wrong session and misreport the day's change, silently. indicators.ts
      // already sorted defensively on its own, which is the tell that the
      // assumption was undefended rather than guaranteed. Sorting at the one
      // place bars enter the app is cheaper than each consumer remembering.
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  async quoteMany(symbols: string[]): Promise<RawQuote[]> {
    if (symbols.length === 0) return [];
    const raw = (await this.yf.quote(symbols)) as QuoteLike[] | undefined;
    if (!Array.isArray(raw)) return [];
    return raw.map(toRawQuote).filter((q): q is RawQuote => q !== null);
  }
}

function toRawQuote(raw: QuoteLike | undefined): RawQuote | null {
  if (!raw || !raw.symbol) return null;
  const selected = selectPrice(raw);
  if (!selected) return null;
  return {
    symbol: raw.symbol,
    name: raw.shortName ?? raw.longName ?? null,
    price: selected.price,
    currency: raw.currency ?? null,
    session: selected.session,
    extended: selected.extended,
    regularPrice: raw.regularMarketPrice ?? null,
    peRatio:
      typeof raw.trailingPE === 'number' &&
      Number.isFinite(raw.trailingPE) &&
      raw.trailingPE > 0
        ? raw.trailingPE
        : null,
  };
}
