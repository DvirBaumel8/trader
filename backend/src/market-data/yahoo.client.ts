import { Injectable, Optional } from '@nestjs/common';
import YahooFinance from 'yahoo-finance2';

export interface TickerInfo {
  symbol: string;
  name: string | null;
}

export interface NextEarnings {
  at: Date;
  /** True when Yahoo marks the date as an estimate rather than confirmed. */
  estimated: boolean;
}

interface QuoteLike {
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
}
