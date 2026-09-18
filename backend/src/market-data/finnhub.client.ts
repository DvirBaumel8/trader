import { Injectable, Logger, Optional } from '@nestjs/common';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';
const BASE_URL = `${FINNHUB_BASE}/stock/metric`;
const NEWS_URL = `${FINNHUB_BASE}/company-news`;

export interface RawNewsItem {
  headline: string;
  summary: string;
  source: string;
  /** Unix seconds, as Finnhub reports it. */
  datetime: number;
  url: string;
}

/**
 * The only file permitted to talk to Finnhub, mirroring the rule that keeps
 * yahoo-finance2 inside yahoo.client.ts.
 *
 * It exists for one reason: Yahoo's quote endpoint carries the trailing P/E
 * but needs a crumb token, and that request is refused with 429 from Render's
 * shared datacenter IP. Yahoo's crumb-free chart endpoint has no fundamentals
 * at all, so in production the P/E went dark while prices stayed fine.
 *
 * It fetches trailing EPS rather than the P/E itself. EPS moves once a
 * quarter and the price moves all day, so `price / EPS` stays correct
 * intraday off a single daily fetch — where a stored P/E would drift from the
 * price it is shown beside.
 *
 * Unconfigured is a first-class state, as with LlmClient: no key means no
 * request and a null EPS, which is exactly how the app behaved before.
 */
@Injectable()
export class FinnhubClient {
  private readonly logger = new Logger(FinnhubClient.name);
  private readonly apiKey = process.env.FINNHUB_API_KEY;
  private readonly http: typeof fetch;

  // Unregistered with Nest on purpose — `fetch` is not a provider, so an
  // undecorated required parameter would fail to resolve at bootstrap. Tests
  // pass a stub directly; nothing here may reach the network in a test.
  constructor(@Optional() http?: typeof fetch) {
    this.http = http ?? globalThis.fetch;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  /**
   * Null whenever there is no meaningful figure — unconfigured, provider
   * down, no trailing earnings, or a zero that would divide into an infinite
   * P/E. Never throws: fundamentals decorate a price, and must not be able to
   * take down a quote the price provider answered perfectly well.
   */
  async trailingEps(symbol: string): Promise<number | null> {
    if (!this.isConfigured()) return null;

    const url = `${BASE_URL}?symbol=${encodeURIComponent(symbol)}&metric=all&token=${this.apiKey}`;
    try {
      const res = await this.http(url);
      if (!res.ok) {
        this.logger.warn(`trailingEps(${symbol}) HTTP ${res.status}`);
        return null;
      }
      const body = (await res.json()) as { metric?: Record<string, unknown> };
      const eps = body.metric?.epsTTM;
      return typeof eps === 'number' && Number.isFinite(eps) && eps !== 0
        ? eps
        : null;
    } catch (err) {
      this.logger.warn(
        `trailingEps(${symbol}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * Recent company-specific headlines, `from`/`to` inclusive. Empty
   * whenever there is nothing meaningful to show — unconfigured, provider
   * down, an unexpected payload shape, or genuinely no news — never throws:
   * news is enrichment on a trade idea, not a fact the idea depends on, and
   * must not be able to take the idea down the way a quote failure does.
   */
  async companyNews(symbol: string, from: Date, to: Date): Promise<RawNewsItem[]> {
    if (!this.isConfigured()) return [];

    const day = (d: Date) => d.toISOString().slice(0, 10);
    const url = `${NEWS_URL}?symbol=${encodeURIComponent(symbol)}&from=${day(from)}&to=${day(to)}&token=${this.apiKey}`;
    try {
      const res = await this.http(url);
      if (!res.ok) {
        this.logger.warn(`companyNews(${symbol}) HTTP ${res.status}`);
        return [];
      }
      const body: unknown = await res.json();
      if (!Array.isArray(body)) {
        this.logger.warn(`companyNews(${symbol}) returned an unexpected payload`);
        return [];
      }
      return body
        .filter(
          (item): item is Record<string, unknown> =>
            typeof item === 'object' && item !== null,
        )
        .map((item) => ({
          headline: typeof item.headline === 'string' ? item.headline : '',
          summary: typeof item.summary === 'string' ? item.summary : '',
          source: typeof item.source === 'string' ? item.source : '',
          datetime: typeof item.datetime === 'number' ? item.datetime : 0,
          url: typeof item.url === 'string' ? item.url : '',
        }))
        .filter((item) => item.headline.trim() !== '');
    } catch (err) {
      this.logger.warn(
        `companyNews(${symbol}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }
}
