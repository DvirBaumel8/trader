import { Injectable } from '@nestjs/common';
import { YahooClient, type RawQuote } from './yahoo.client.js';
import type { MarketSession } from './select-price.js';

export interface Quote {
  symbol: string;
  name: string | null;
  price: number;
  stale: boolean;
  /** Which trading session `price` came from. */
  session: MarketSession;
  /** True when `price` is an extended-hours print rather than the close. */
  extended: boolean;
  /** The regular-session price, for showing the move since the close. */
  regularPrice: number | null;
  /** Trailing P/E. Null when Yahoo has none or it isn't meaningful — see RawQuote. */
  peRatio: number | null;
  fetchedAt?: Date;
}

interface CacheEntry {
  quote: Quote;
  fetchedAt: number;
}

const DEFAULT_TTL_MS = 60_000;

/**
 * Longer than a quote's TTL on purpose. A high-water mark since entry only
 * ever ratchets, and never by much in a minute — while the dashboard polls
 * every 60s, so tying this to the quote TTL would put an extra provider
 * round trip per trailing position on almost every poll.
 */
const EXTREMES_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class MarketDataService {
  private readonly cache = new Map<string, CacheEntry>();
  /** symbol -> extremes since a position's entry, with pre/post included. */
  private readonly extremesCache = new Map<
    string,
    { fetchedAt: number; high: number | null; low: number | null }
  >();
  private readonly yahoo: YahooClient;
  private readonly ttlMs: number;

  constructor(yahoo: YahooClient, ttlMs: number = DEFAULT_TTL_MS) {
    this.yahoo = yahoo;
    this.ttlMs = ttlMs;
  }

  /**
   * The highest and lowest traded price since `from`, pre-market and
   * after-hours included.
   *
   * A trailing stop ratchets from the most favourable price REACHED, and the
   * owner's broker counts extended prints. Daily bars do not: BITX peaked
   * near $19.58 outside regular hours while its daily high was $19.21, which
   * put the app's trail at $17.33 against the broker's $17.63. A stop that
   * disagrees with the broker is worse than no stop shown at all.
   *
   * Cached like a quote, and for the same reason: this sits on the portfolio
   * read path, which must not spend a network round trip per trailing
   * position on every load.
   */
  async getExtendedExtremes(
    symbol: string,
    from: Date,
    force = false,
  ): Promise<{ high: number | null; low: number | null }> {
    const key = `${symbol.toUpperCase()}:${from.toISOString().slice(0, 10)}`;
    const cached = this.extremesCache.get(key);
    if (!force && cached && Date.now() - cached.fetchedAt < EXTREMES_TTL_MS) {
      return { high: cached.high, low: cached.low };
    }
    try {
      const found = await this.yahoo.extremesIncludingExtended(symbol, from);
      this.extremesCache.set(key, { ...found, fetchedAt: Date.now() });
      return found;
    } catch {
      // A failure here must never take down the portfolio: the caller falls
      // back to daily bars, which is the behaviour that existed before this.
      return cached
        ? { high: cached.high, low: cached.low }
        : { high: null, low: null };
    }
  }

  /**
   * `force` bypasses the cache for an explicit user-initiated refresh. Without
   * it, a refresh button would re-serve the same cached number and look broken.
   */
  async getQuote(symbol: string, force = false): Promise<Quote | null> {
    const key = symbol.toUpperCase();
    const cached = this.cache.get(key);
    if (!force && cached && Date.now() - cached.fetchedAt < this.ttlMs) {
      return cached.quote;
    }
    try {
      const raw = await this.yahoo.quote(key);
      if (!raw) return null;
      return this.store(key, raw);
    } catch {
      // Never show a wrong number as if it were fresh.
      return cached ? { ...cached.quote, stale: true } : null;
    }
  }

  async getQuotes(
    symbols: string[],
    force = false,
  ): Promise<Map<string, Quote>> {
    const keys = [...new Set(symbols.map((s) => s.toUpperCase()))];
    const out = new Map<string, Quote>();
    const missing: string[] = [];

    for (const key of keys) {
      const cached = this.cache.get(key);
      if (!force && cached && Date.now() - cached.fetchedAt < this.ttlMs) {
        out.set(key, cached.quote);
      } else {
        missing.push(key);
      }
    }
    if (missing.length === 0) return out;

    try {
      for (const raw of await this.yahoo.quoteMany(missing)) {
        const key = raw.symbol.toUpperCase();
        out.set(key, this.store(key, raw));
      }
    } catch {
      for (const key of missing) {
        const cached = this.cache.get(key);
        if (cached) out.set(key, { ...cached.quote, stale: true });
      }
    }
    return out;
  }

  private store(key: string, raw: RawQuote): Quote {
    const now = new Date();
    const quote: Quote = {
      symbol: key,
      name: raw.name,
      price: raw.price,
      stale: false,
      session: raw.session,
      extended: raw.extended,
      regularPrice: raw.regularPrice,
      peRatio: raw.peRatio,
      fetchedAt: now,
    };
    this.cache.set(key, { quote, fetchedAt: now.getTime() });
    return quote;
  }
}
