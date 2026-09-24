import { Injectable, Logger, Optional } from '@nestjs/common';

const BASE_URL = 'https://api.twelvedata.com/quote';

/**
 * The free/basic plan's own limit — confirmed against a live key's
 * `/api_usage` response (`plan_limit: 8`), not assumed from docs.
 */
const CALLS_PER_MINUTE = 8;
const WINDOW_MS = 60_000;

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
  private readonly now: () => number;
  /** Timestamps (ms) of recent calls, oldest first — a sliding window over WINDOW_MS. */
  private readonly recentCalls: number[] = [];

  // Unregistered with Nest on purpose, matching FinnhubClient — `fetch` is
  // not a provider. Tests pass a stub directly; nothing here may reach the
  // network in a test. `now` is injected the same way, so tests can drive
  // the rate-limit window without a real clock.
  constructor(@Optional() http?: typeof fetch, @Optional() now?: () => number) {
    this.http = http ?? globalThis.fetch;
    this.now = now ?? Date.now;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  /**
   * Whether another call fits under the plan's per-minute cap right now.
   *
   * Found live: every held symbol plus the whole watchlist asks for an
   * extended print on the same poll, all at once — 30+ requests against an
   * 8/minute plan — and every single one came back 429. Firing into a
   * guaranteed rejection is worse than not asking: it wastes the round trip
   * AND still leaves the caller with nothing, indistinguishable from a
   * quiet, well-behaved skip. Checking first turns "flood and mostly fail"
   * into "take the slots that exist, skip the rest" — the skips fall back
   * to the regular price exactly as a real null response would.
   */
  private hasBudget(): boolean {
    const cutoff = this.now() - WINDOW_MS;
    while (this.recentCalls.length > 0 && this.recentCalls[0] <= cutoff) {
      this.recentCalls.shift();
    }
    return this.recentCalls.length < CALLS_PER_MINUTE;
  }

  /**
   * The latest pre- or post-market print and when it was made, or null
   * whenever there is nothing usable — unconfigured, provider down, an
   * in-body error, the regular session (no extended print to report), a
   * non-positive number, or no timestamp to judge it by. The timestamp is
   * required, not decorative: the free tier has been observed returning a
   * stale print with no error at all, carried over from a prior session, and
   * the caller needs the print's own time to catch that — see
   * extended-print-freshness.ts. Never throws: this decorates a price Yahoo
   * already answered, and must not be able to take down a quote over a
   * second opinion.
   *
   * Also null, silently, when the plan's per-minute budget is already spent
   * — see `hasBudget`. No network call is made in that case.
   */
  async extendedPrice(symbol: string): Promise<{ price: number; timestamp: Date } | null> {
    if (!this.isConfigured()) return null;
    if (!this.hasBudget()) return null;
    this.recentCalls.push(this.now());

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
        extended_timestamp?: string | number;
      };
      if (body.status === 'error') {
        this.logger.warn(`extendedPrice(${symbol}) provider error`);
        return null;
      }
      const price = Number(body.extended_price);
      const timestampSeconds = Number(body.extended_timestamp);
      if (!Number.isFinite(price) || price <= 0) return null;
      if (!Number.isFinite(timestampSeconds) || timestampSeconds <= 0) return null;
      return { price, timestamp: new Date(timestampSeconds * 1000) };
    } catch (err) {
      this.logger.warn(
        `extendedPrice(${symbol}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
