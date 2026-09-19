import { computeMarketSession } from './market-session.js';

export type MarketSession = 'PRE' | 'REGULAR' | 'POST' | 'OVERNIGHT' | 'CLOSED';

export interface PriceInputs {
  marketState?: string | null;
  regularMarketPrice?: number | null;
  preMarketPrice?: number | null;
  postMarketPrice?: number | null;
}

export interface SelectedPrice {
  price: number;
  session: MarketSession;
  /** True when the price came from an extended-hours session, not the close. */
  extended: boolean;
}

/**
 * Yahoo reports several prices at once. Which one is "the" price depends on the
 * session, and getting it wrong means showing yesterday's close during exactly
 * the hours an active trader is most likely to be looking.
 *
 * Extended-hours prices are thinner and can gap, so `extended` is returned for
 * the UI to label — never silently pass an after-hours print off as the close.
 *
 * In every session the rule is the same: show the most recent actual trade.
 *
 * `now` is only ever consulted when `q.marketState` is missing entirely —
 * see `normaliseSession`. It defaults to the real clock so ordinary callers
 * never have to think about it; tests pass a fixed instant.
 */
export function selectPrice(q: PriceInputs, now: Date = new Date()): SelectedPrice | null {
  const session = normaliseSession(q.marketState, now);

  if (session === 'PRE' && isPrice(q.preMarketPrice)) {
    return { price: q.preMarketPrice, session, extended: true };
  }
  if (session === 'POST' && isPrice(q.postMarketPrice)) {
    return { price: q.postMarketPrice, session, extended: true };
  }
  /**
   * With the market fully closed or in the overnight gap, the last trade is
   * the after-hours print, not the official close — and that is what
   * brokers display. Matching the broker matters more here than accounting
   * purity: a portfolio that disagrees with the account it mirrors is a
   * portfolio you stop trusting.
   */
  if (
    (session === 'CLOSED' || session === 'OVERNIGHT') &&
    isPrice(q.postMarketPrice)
  ) {
    return { price: q.postMarketPrice, session, extended: true };
  }
  // Falls back to the regular price whenever an extended print is missing —
  // common in the first minutes of a session, or for thinly traded names.
  if (isPrice(q.regularMarketPrice)) {
    return { price: q.regularMarketPrice, session, extended: false };
  }
  return null;
}

function isPrice(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/**
 * A provider that actually answers is trusted over a calendar guess — it can
 * react to things no rule predicts, an unscheduled halt included. Only when
 * a provider gives us NOTHING (no `marketState` at all) do we compute the
 * session ourselves from wall-clock time; see `computeMarketSession`. This
 * is the fallback production actually needs: Yahoo's crumb-requiring quote
 * endpoint is blocked from Render's IP, so every quote there falls back to
 * an endpoint with no `marketState` field, and used to read as CLOSED
 * unconditionally — including during real trading hours.
 */
function normaliseSession(
  state: string | null | undefined,
  now: Date,
): MarketSession {
  if (state == null) return computeMarketSession(now);
  switch (state.toUpperCase()) {
    case 'PRE':
    case 'PREPRE':
      return 'PRE';
    case 'REGULAR':
      return 'REGULAR';
    case 'POST':
    case 'POSTPOST':
      return 'POST';
    default:
      return 'CLOSED';
  }
}

/** Human label for the badge. Regular sessions get no badge at all. */
export function sessionLabel(session: MarketSession): string | null {
  switch (session) {
    case 'PRE':
      return 'PRE-MARKET';
    case 'POST':
      return 'AFTER HOURS';
    case 'OVERNIGHT':
      return 'OVERNIGHT';
    case 'CLOSED':
      return 'MARKET CLOSED';
    case 'REGULAR':
      return null;
  }
}
