import { marketDate } from './trading-day.js';
import type { MarketSession } from './select-price.js';

/**
 * Whether a Twelve Data extended-hours print is worth trusting right now.
 *
 * Found live: NBIS and MSTR kept returning Friday's `extended_price` well
 * into Monday's pre-market, at the same `extended_timestamp`, while other
 * symbols refreshed normally — the free tier can silently fail to roll a
 * symbol's print forward into a new session. There is no error to catch;
 * the response looks exactly like a valid one. The only tell is the
 * timestamp riding along with it.
 *
 * A closed market (weekend, holiday) has nothing fresher than the last
 * session's print, so any age is fine there. Once a new trading day is
 * live, the print must be from that same exchange calendar day — anything
 * older is presented as "now" when it is really carried over.
 */
export function isExtendedPrintFresh(
  now: Date,
  printTime: Date,
  session: MarketSession,
): boolean {
  if (session === 'CLOSED') return true;
  return marketDate(printTime) === marketDate(now);
}
