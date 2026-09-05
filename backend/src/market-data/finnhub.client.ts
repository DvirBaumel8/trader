import { Injectable, Logger, Optional } from '@nestjs/common';

const BASE_URL = 'https://finnhub.io/api/v1/stock/metric';

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
}
