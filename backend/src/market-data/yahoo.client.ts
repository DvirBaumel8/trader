import { Injectable } from '@nestjs/common';
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
}

export interface RawBar {
  date: string; // YYYY-MM-DD
  close: number;
  adjClose: number;
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
}

/**
 * The only file permitted to import yahoo-finance2. Everything else depends on
 * this interface, so swapping the data provider touches exactly one file.
 */
@Injectable()
export class YahooClient {
  private readonly yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

  async quote(symbol: string): Promise<RawQuote | null> {
    // An unknown ticker resolves to undefined here rather than throwing.
    const raw = (await this.yf.quote(symbol)) as QuoteLike | undefined;
    return toRawQuote(raw);
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
      close?: number | null;
      adjclose?: number | null;
    }[];

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
        };
      })
      .filter((b): b is RawBar => b !== null);
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
  };
}
