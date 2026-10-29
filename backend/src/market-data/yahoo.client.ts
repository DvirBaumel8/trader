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

/** Quarterly fundamentals as Yahoo reports them; shaped for display by knowledge/fundamentals.ts. */
export interface RawFundamentals {
  quoteType: string | null;
  currency: string | null;
  /** earnings.earningsChart.quarterly; dates are YYYY-MM-DD / ISO strings. */
  epsQuarters: { periodEnd: string; fiscalQuarter: string | null; actual: number | null; reportedAt: string | null }[];
  cash: number | null;
  debt: number | null;
  /** fundamentalsTimeSeries quarterly, oldest first. */
  series: { periodEnd: string; revenue: number | null; fcf: number | null }[];
}

interface FundamentalsSummaryLike {
  price?: { quoteType?: unknown; currency?: unknown };
  financialData?: { totalCash?: unknown; totalDebt?: unknown };
  earnings?: {
    earningsChart?: {
      quarterly?: {
        date?: unknown;
        actual?: unknown;
        fiscalQuarter?: unknown;
        periodEndDate?: unknown;
        reportedDate?: unknown;
      }[];
    };
  };
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

  /**
   * Quarterly actuals, cash and debt for a company. Anything that is not an
   * EQUITY comes back with only `quoteType` set. Throws on provider failure.
   */
  async fundamentals(symbol: string): Promise<RawFundamentals> {
    const empty: RawFundamentals = { quoteType: null, currency: null, epsQuarters: [], cash: null, debt: null, series: [] };
    let summary: FundamentalsSummaryLike | undefined;
    try {
      summary = (await this.yf.quoteSummary(symbol, {
        modules: ['earnings', 'financialData', 'price'],
      })) as FundamentalsSummaryLike | undefined;
    } catch (err) {
      // Same "not a company" answer as nextEarnings gives for ETFs.
      if (err instanceof Error && err.message.includes('No fundamentals data found')) return empty;
      throw err;
    }
    const quoteType = typeof summary?.price?.quoteType === 'string' ? summary.price.quoteType : null;
    const currency = typeof summary?.price?.currency === 'string' ? summary.price.currency : null;
    if (quoteType !== 'EQUITY') return { ...empty, quoteType, currency };

    const finite = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) ? n : null);
    const day = (d: unknown): string | null => {
      const t = d instanceof Date ? d : typeof d === 'string' ? new Date(d) : null;
      return t && !Number.isNaN(t.getTime()) ? t.toISOString().slice(0, 10) : null;
    };

    const epsQuarters: RawFundamentals['epsQuarters'] = [];
    for (const q of summary?.earnings?.earningsChart?.quarterly ?? []) {
      const periodEnd = day(q.periodEndDate);
      if (!periodEnd) continue;
      const reported = q.reportedDate instanceof Date ? q.reportedDate : null;
      epsQuarters.push({
        periodEnd,
        fiscalQuarter: typeof q.fiscalQuarter === 'string' ? q.fiscalQuarter : null,
        actual: finite(q.actual),
        reportedAt: reported && !Number.isNaN(reported.getTime()) ? reported.toISOString() : null,
      });
    }

    const since = new Date();
    since.setUTCMonth(since.getUTCMonth() - 30);
    const items = (await this.yf.fundamentalsTimeSeries(symbol, {
      period1: since,
      type: 'quarterly',
      module: 'all',
    })) as unknown as { date?: unknown; totalRevenue?: unknown; freeCashFlow?: unknown }[];
    const series: RawFundamentals['series'] = [];
    for (const it of items ?? []) {
      const periodEnd = day(it.date);
      if (!periodEnd) continue;
      series.push({ periodEnd, revenue: finite(it.totalRevenue), fcf: finite(it.freeCashFlow) });
    }
    series.sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));

    return {
      quoteType,
      currency,
      epsQuarters,
      cash: finite(summary?.financialData?.totalCash),
      debt: finite(summary?.financialData?.totalDebt),
      series,
    };
  }
}
