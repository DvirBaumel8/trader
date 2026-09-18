import { Injectable } from '@nestjs/common';
import { FinnhubClient } from './finnhub.client.js';

/** Headlines don't change minute to minute; caching keeps a repeat trade-idea click on the same ticker cheap. */
const NEWS_TTL_MS = 45 * 60 * 1000;

/**
 * How far back to ask Finnhub for headlines. Exported so the trade-idea
 * prompt can name the window in its own text rather than a duplicated
 * magic number the two could drift apart on.
 */
export const NEWS_LOOKBACK_DAYS = 7;

/** Enough to give a trade idea real signal without flooding the prompt. */
const MAX_HEADLINES = 5;

export interface NewsHeadline {
  headline: string;
  summary: string;
  source: string;
  /** The day it was published, as YYYY-MM-DD. */
  publishedOn: string;
  url: string;
}

interface CachedHeadlines {
  headlines: NewsHeadline[];
  fetchedAt: number;
}

/**
 * Recent, real, company-specific headlines for a ticker — what closes the
 * gap a same-day announcement (an acquisition, a partnership, an FDA
 * decision) leaves in a trade idea otherwise built entirely from price and
 * technicals. See `docs/ai-configuration.md` and `trade-idea-prompt.ts`.
 */
@Injectable()
export class NewsService {
  private readonly cache = new Map<string, CachedHeadlines>();

  constructor(private readonly finnhub: FinnhubClient) {}

  /**
   * The newest few headlines from the last week, newest first. Never
   * throws — see `FinnhubClient.companyNews`. An empty result is NOT
   * cached, same rule `FundamentalsService` applies to a missing EPS: a
   * transient provider outage must not be mistaken for, and frozen as, a
   * genuinely quiet news day.
   */
  async recentHeadlines(symbol: string): Promise<NewsHeadline[]> {
    const key = symbol.toUpperCase();
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.fetchedAt < NEWS_TTL_MS) {
      return cached.headlines;
    }

    const to = new Date();
    const from = new Date(to.getTime() - NEWS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const raw = await this.finnhub.companyNews(key, from, to);

    const headlines = [...raw]
      .sort((a, b) => b.datetime - a.datetime)
      .slice(0, MAX_HEADLINES)
      .map((r) => ({
        headline: r.headline,
        summary: r.summary,
        source: r.source,
        publishedOn: new Date(r.datetime * 1000).toISOString().slice(0, 10),
        url: r.url,
      }));

    if (headlines.length > 0) {
      this.cache.set(key, { headlines, fetchedAt: Date.now() });
    }
    return headlines;
  }
}
