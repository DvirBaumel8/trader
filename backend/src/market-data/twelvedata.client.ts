import { Injectable, Logger, Optional } from '@nestjs/common';

const BASE_URL = 'https://api.twelvedata.com/quote';

/**
 * The only file permitted to talk to Twelve Data, mirroring the rule that
 * keeps yahoo-finance2 inside yahoo.client.ts and Finnhub inside
 * finnhub.client.ts.
 *
 * It exists for one reason: Yahoo's quote endpoint (the one carrying
 * pre/post-market prints) needs a crumb token, and that request is refused
 * with 429 from Render's shared datacenter IP. The crumb-free fallback has
 * no extended print at all, so production silently shows the regular close
 * during pre-market and after-hours. Twelve Data's free tier answers
 * `prepost=true` with a real extended print (`extended_price`) — confirmed
 * against a live account, not assumed from documentation, since Finnhub's
 * equivalent free-tier field turned out NOT to carry a real extended price
 * despite reading that way in its own docs.
 *
 * Only ever a SECOND opinion: Yahoo stays primary since it already proves
 * out for regular-session data on the Mac; this is asked only when Yahoo's
 * own quote had no genuine extended print to offer. Unconfigured is a
 * first-class state, as with FinnhubClient: no key means no request and a
 * null price, which is exactly how the app behaved before this existed.
 */
@Injectable()
export class TwelveDataClient {
  private readonly logger = new Logger(TwelveDataClient.name);
  private readonly apiKey = process.env.TWELVEDATA_API_KEY;
  private readonly http: typeof fetch;

  // Unregistered with Nest on purpose, matching FinnhubClient — `fetch` is
  // not a provider. Tests pass a stub directly; nothing here may reach the
  // network in a test.
  constructor(@Optional() http?: typeof fetch) {
    this.http = http ?? globalThis.fetch;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  /**
   * The latest pre- or post-market print, or null whenever there is nothing
   * usable — unconfigured, provider down, an in-body error, the regular
   * session (no extended print to report), or a non-positive number. Never
   * throws: this decorates a price Yahoo already answered, and must not be
   * able to take down a quote over a second opinion.
   */
  async extendedPrice(symbol: string): Promise<number | null> {
    if (!this.isConfigured()) return null;

    const url = `${BASE_URL}?symbol=${encodeURIComponent(symbol)}&prepost=true&apikey=${this.apiKey}`;
    try {
      const res = await this.http(url);
      if (!res.ok) {
        this.logger.warn(`extendedPrice(${symbol}) HTTP ${res.status}`);
        return null;
      }
      const body = (await res.json()) as {
        status?: string;
        extended_price?: string | number;
      };
      if (body.status === 'error') {
        this.logger.warn(`extendedPrice(${symbol}) provider error`);
        return null;
      }
      const price = Number(body.extended_price);
      return Number.isFinite(price) && price > 0 ? price : null;
    } catch (err) {
      this.logger.warn(
        `extendedPrice(${symbol}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
