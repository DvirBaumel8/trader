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
