import { Injectable, Optional } from '@nestjs/common';
import YahooFinance from 'yahoo-finance2';
import { etDate } from '../earnings/week.js';

export interface TickerInfo {
  symbol: string;
  name: string | null;
}

export interface NextEarnings {
  at: Date;
  /** True when Yahoo marks the date as an estimate rather than confirmed. */
  estimated: boolean;
}

/** One regular-session daily bar; `date` is the ET calendar date of the session. */
export interface DailyBar {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
}

/** Regular-session price and the previous regular-session close. Never pre/post-market. */
export interface RegularQuote {
  price: number;
  previousClose: number;
}

interface QuoteLike {
  regularMarketPrice?: unknown;
  regularMarketPreviousClose?: unknown;
  symbol?: string;
  shortName?: string;
  longName?: string;
}

interface CalendarSummaryLike {
  calendarEvents?: {
    earnings?: {
      earningsDate?: unknown[];
      isEarningsDateEstimate?: boolean;
    };
  };
}

/**
 * The only file permitted to import yahoo-finance2. Everything else depends on
 * this interface, so swapping the data provider touches exactly one file.
 *
 * The larger client (quotes, bars, consensus) is parked in the backend's
 * lib folder as yahoo.client.full.ts.
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

  /** null when Yahoo has no such symbol. Throws on provider failure. */
  async lookup(symbol: string): Promise<TickerInfo | null> {
    // An unknown ticker resolves to undefined here rather than throwing.
    const q = (await this.yf.quote(symbol)) as QuoteLike | undefined;
    if (!q || typeof q.symbol !== 'string' || q.symbol === '') return null;
    return { symbol: q.symbol.toUpperCase(), name: q.longName ?? q.shortName ?? null };
  }

  /**
   * null when Yahoo has no upcoming earnings date. ETFs have no fundamentals,
   * and Yahoo answers with a "No fundamentals data found" error; that is the
   * same "no date" answer. Any other failure throws.
   */
  async nextEarnings(symbol: string): Promise<NextEarnings | null> {
    let summary: CalendarSummaryLike | undefined;
    try {
      summary = (await this.yf.quoteSummary(symbol, {
        modules: ['calendarEvents'],
      })) as CalendarSummaryLike | undefined;
    } catch (err) {
      if (err instanceof Error && err.message.includes('No fundamentals data found')) {
        return null;
      }
      throw err;
    }
    const earnings = summary?.calendarEvents?.earnings;
    const first = earnings?.earningsDate?.[0];
    if (!(first instanceof Date) || Number.isNaN(first.getTime())) return null;
    return { at: first, estimated: earnings?.isEarningsDateEstimate === true };
  }

  /**
   * Regular-session daily bars from `from` to now, oldest first. A bar still
   * forming today may be last. Throws on provider failure.
   */
  async dailyBars(symbol: string, from: Date): Promise<DailyBar[]> {
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
    }[];
    const finite = (n: unknown): number | null =>
      typeof n === 'number' && Number.isFinite(n) ? n : null;

    const bars: DailyBar[] = [];
    for (const q of quotes) {
      const close = finite(q.close);
      if (close === null) continue;
      bars.push({
        date: etDate(new Date(q.date)),
        open: finite(q.open),
        high: finite(q.high),
        low: finite(q.low),
        close,
      });
    }
    // The provider is not contracted to return bars in order.
    return bars.sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Regular-market price and previous close; null when Yahoo lacks either
   * (or the symbol). Throws on provider failure.
   */
  async quote(symbol: string): Promise<RegularQuote | null> {
    const q = (await this.yf.quote(symbol)) as QuoteLike | undefined;
    const price = q?.regularMarketPrice;
    const previousClose = q?.regularMarketPreviousClose;
    if (typeof price !== 'number' || !Number.isFinite(price)) return null;
    if (typeof previousClose !== 'number' || !Number.isFinite(previousClose)) return null;
    return { price, previousClose };
  }
}
