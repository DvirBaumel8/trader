import { Injectable, Optional } from '@nestjs/common';
import YahooFinance from 'yahoo-finance2';
import { selectPrice, type MarketSession } from './select-price.js';
import { parseEarningsDate } from './earnings.js';

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

export interface RawConsensus {
  /** 1 = strong buy … 5 = sell. Null when no analyst covers it. */
  recommendationMean: number | null;
  /** e.g. 'strong_buy', 'buy', 'hold'. */
  recommendationKey: string | null;
  analystCount: number | null;
  targetMean: number | null;
  targetHigh: number | null;
  targetLow: number | null;
  /** Fractions, like every other percent in this codebase. 1.059 = +105.9%. */
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  profitMargin: number | null;
  returnOnEquity: number | null;
  /** Most recent month first: how many analysts sit in each bucket. */
  trend: {
    period: string;
    strongBuy: number;
    buy: number;
    hold: number;
    sell: number;
    strongSell: number;
  }[];
}

/**
 * Three states, not two — collapsing "nobody covers this name" and "the
 * provider call failed" into one `null` used to make a Yahoo outage read as
 * a fact about the stock (invariant 7, inverted: a failure wearing a fact's
 * face). `ok` and `no-coverage` are both a resolved answer about the
 * ticker; `unavailable` is the one state that says nothing was learned.
 */
export type ConsensusResult =
  | { status: 'ok'; data: RawConsensus }
  | { status: 'no-coverage' }
  | { status: 'unavailable' };

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

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
    try {
      // An unknown ticker resolves to undefined here rather than throwing.
      const raw = (await this.yf.quote(symbol)) as QuoteLike | undefined;
      return toRawQuote(raw);
    } catch (err) {
      return this.quoteFromChart(symbol, err);
    }
  }

  async nextEarningsDate(symbol: string): Promise<string | null> {
    const result = await this.yf.quoteSummary(symbol, {
      modules: ['calendarEvents'],
    });
    const dates = (
      result?.calendarEvents as
        | { earnings?: { earningsDate?: unknown } }
        | undefined
    )?.earnings?.earningsDate;
    const first = Array.isArray(dates) ? dates[0] : null;
    return parseEarningsDate(first);
  }

  /**
   * Yahoo's quote endpoint requires a "crumb" token; its chart endpoint does
   * not. A datacenter IP gets 429 on the crumb request — shared address, shared
   * reputation — which took every price in production dark while chart calls
   * kept working. Chart meta carries the price and the name but no
   * marketState, no pre/post print and no trailing P/E, so a fallback quote is
   * deliberately a regular-session one with a null P/E: less than the real
   * quote, but true. Rethrows the original failure when chart cannot price it
   * either, so the caller still serves its cached price rather than a blank.
   */
  private async quoteFromChart(
    symbol: string,
    original: unknown,
  ): Promise<RawQuote | null> {
    let meta: QuoteLike & { regularMarketPrice?: number };
    try {
      const result = await this.yf.chart(symbol, {
        period1: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        interval: '1d',
      });
      meta = (result?.meta ?? {}) as QuoteLike;
    } catch {
      throw original;
    }
    return toRawQuote({
      symbol: meta.symbol ?? symbol,
      shortName: meta.shortName,
      longName: meta.longName,
      currency: meta.currency,
      regularMarketPrice: meta.regularMarketPrice,
    });
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

  /**
   * What the street thinks: analyst consensus, price targets, growth and
   * margins.
   *
   * Bought in rather than computed. The app does not try to out-analyse
   * fifty-seven analysts, and this is free from the provider already in use —
   * no new vendor, no API key, and invariant 6 intact because the import
   * stays in this file.
   *
   * `no-coverage`, never a zero or a default, when nothing covers the
   * ticker. On a 1..5 scale where 1 is "strong buy", a zero would read as
   * the strongest possible recommendation — the worst available way to be
   * wrong. ETFs and thin names legitimately have no coverage — that is a
   * resolved answer, distinct from `unavailable`, which means the provider
   * call itself failed and nothing was learned either way.
   */
  async consensus(symbol: string): Promise<ConsensusResult> {
    try {
      const r = await this.yf.quoteSummary(symbol, {
        modules: ['financialData', 'recommendationTrend'],
      });
      const f = (r?.financialData ?? {}) as Record<string, unknown>;
      const mean = num(f.recommendationMean);
      const analysts = num(f.numberOfAnalystOpinions);
      // No mean and no analysts means no coverage, not a quiet zero.
      if (mean === null && analysts === null) return { status: 'no-coverage' };
      const trendRows = (r?.recommendationTrend?.trend ?? []) as Record<
        string,
        number
      >[];
      return {
        status: 'ok',
        data: {
          recommendationMean: mean,
          recommendationKey:
            typeof f.recommendationKey === 'string' ? f.recommendationKey : null,
          analystCount: analysts,
          targetMean: num(f.targetMeanPrice),
          targetHigh: num(f.targetHighPrice),
          targetLow: num(f.targetLowPrice),
          revenueGrowth: num(f.revenueGrowth),
          earningsGrowth: num(f.earningsGrowth),
          profitMargin: num(f.profitMargins),
          returnOnEquity: num(f.returnOnEquity),
          trend: trendRows.map((t) => ({
            period: String(t.period ?? ''),
            strongBuy: Number(t.strongBuy ?? 0),
            buy: Number(t.buy ?? 0),
            hold: Number(t.hold ?? 0),
            sell: Number(t.sell ?? 0),
            strongSell: Number(t.strongSell ?? 0),
          })),
        },
      };
    } catch {
      // Silent, like `quote`: this class has no logger, and a missing view is
      // a state the ranking handles rather than an error it reports.
      return { status: 'unavailable' };
    }
  }

  async quoteMany(symbols: string[]): Promise<RawQuote[]> {
    if (symbols.length === 0) return [];
    try {
      const raw = (await this.yf.quote(symbols)) as QuoteLike[] | undefined;
      if (!Array.isArray(raw)) return [];
      return raw.map(toRawQuote).filter((q): q is RawQuote => q !== null);
    } catch (err) {
      // One chart call per symbol — the batch endpoint is a quote endpoint and
      // is blocked with the rest. A symbol that fails on its own is dropped
      // rather than blanking the whole portfolio.
      const settled = await Promise.allSettled(
        symbols.map((s) => this.quoteFromChart(s, err)),
      );
      const quotes = settled
        .filter(
          (r): r is PromiseFulfilledResult<RawQuote | null> =>
            r.status === 'fulfilled',
        )
        .map((r) => r.value)
        .filter((q): q is RawQuote => q !== null);
      if (quotes.length === 0) throw err;
      return quotes;
    }
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
