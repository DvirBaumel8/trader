import { Injectable } from '@nestjs/common';
import { YahooClient } from './yahoo.client.js';

export interface Quote {
  symbol: string;
  name: string | null;
  price: number;
  stale: boolean;
  fetchedAt?: Date;
}

interface CacheEntry {
  quote: Quote;
  fetchedAt: number;
}

const DEFAULT_TTL_MS = 60_000;

@Injectable()
export class MarketDataService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly yahoo: YahooClient;
  private readonly ttlMs: number;

  constructor(yahoo: YahooClient, ttlMs: number = DEFAULT_TTL_MS) {
    this.yahoo = yahoo;
    this.ttlMs = ttlMs;
  }

  async getQuote(symbol: string): Promise<Quote | null> {
    const key = symbol.toUpperCase();
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.fetchedAt < this.ttlMs) {
      return cached.quote;
    }
    try {
      const raw = await this.yahoo.quote(key);
      if (!raw) return null;
      return this.store(key, raw.name, raw.price);
    } catch {
      // Never show a wrong number as if it were fresh.
      return cached ? { ...cached.quote, stale: true } : null;
    }
  }

  async getQuotes(symbols: string[]): Promise<Map<string, Quote>> {
    const keys = [...new Set(symbols.map((s) => s.toUpperCase()))];
    const out = new Map<string, Quote>();
    const missing: string[] = [];

    for (const key of keys) {
      const cached = this.cache.get(key);
      if (cached && Date.now() - cached.fetchedAt < this.ttlMs) {
        out.set(key, cached.quote);
      } else {
        missing.push(key);
      }
    }
    if (missing.length === 0) return out;

    try {
      for (const raw of await this.yahoo.quoteMany(missing)) {
        const key = raw.symbol.toUpperCase();
        out.set(key, this.store(key, raw.name, raw.price));
      }
    } catch {
      for (const key of missing) {
        const cached = this.cache.get(key);
        if (cached) out.set(key, { ...cached.quote, stale: true });
      }
    }
    return out;
  }

  private store(key: string, name: string | null, price: number): Quote {
    const now = new Date();
    const quote: Quote = {
      symbol: key,
      name,
      price,
      stale: false,
      fetchedAt: now,
    };
    this.cache.set(key, { quote, fetchedAt: now.getTime() });
    return quote;
  }
}
