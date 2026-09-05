import { Injectable } from '@nestjs/common';
import { FinnhubClient } from './finnhub.client.js';

/** Earnings move once a quarter; refetching per price refresh would be waste. */
const EPS_TTL_MS = 24 * 60 * 60 * 1000;

interface CachedEps {
  eps: number;
  fetchedAt: number;
}

/**
 * Turns a trailing EPS into the P/E the app shows.
 *
 * The division happens here, against the live price, rather than storing a
 * P/E: a stored multiple would drift away from the price displayed next to it
 * as the day went on, which is the kind of quietly-wrong number this app
 * exists to avoid.
 */
@Injectable()
export class FundamentalsService {
  private readonly eps = new Map<string, CachedEps>();

  constructor(private readonly finnhub: FinnhubClient) {}

  /**
   * Null whenever there is no honest multiple to show: no EPS, no usable
   * price, or a negative result. A negative P/E is not a cheap stock, it is a
   * company losing money — the same reason the Yahoo path rejects a
   * non-positive trailingPE.
   */
  async peRatio(symbol: string, price: number): Promise<number | null> {
    if (!Number.isFinite(price) || price <= 0) return null;

    const eps = await this.trailingEps(symbol.toUpperCase());
    if (eps === null) return null;

    const pe = price / eps;
    return Number.isFinite(pe) && pe > 0 ? pe : null;
  }

  /**
   * Fills in the P/E on quotes that arrived without one, in place. Quotes that
   * already carry a multiple are left alone and cost no request, so this is
   * free on the owner's machine where the real Yahoo quote still works.
   */
  async fillMissingPeRatios(
    quotes: Map<string, { price: number; peRatio: number | null }>,
  ): Promise<void> {
    const missing = [...quotes.entries()].filter(
      ([, q]) => q.peRatio === null || q.peRatio === undefined,
    );
    await Promise.all(
      missing.map(async ([symbol, q]) => {
        q.peRatio = await this.peRatio(symbol, q.price);
      }),
    );
  }

  private async trailingEps(key: string): Promise<number | null> {
    const cached = this.eps.get(key);
    if (cached && Date.now() - cached.fetchedAt < EPS_TTL_MS) return cached.eps;

    const eps = await this.finnhub.trailingEps(key);
    // A miss is not cached: an outage must not blank the P/E until tomorrow.
    if (eps === null) return null;

    this.eps.set(key, { eps, fetchedAt: Date.now() });
    return eps;
  }
}
