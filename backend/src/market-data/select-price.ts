export type MarketSession = 'PRE' | 'REGULAR' | 'POST' | 'CLOSED';

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
 */
export function selectPrice(q: PriceInputs): SelectedPrice | null {
  const session = normaliseSession(q.marketState);

  if (session === 'PRE' && isPrice(q.preMarketPrice)) {
    return { price: q.preMarketPrice, session, extended: true };
  }
  if (session === 'POST' && isPrice(q.postMarketPrice)) {
    return { price: q.postMarketPrice, session, extended: true };
  }
  /**
   * With the market fully closed, the last trade is the after-hours print, not
   * the official close — and that is what brokers display. Matching the broker
   * matters more here than accounting purity: a portfolio that disagrees with
   * the account it mirrors is a portfolio you stop trusting.
   */
  if (session === 'CLOSED' && isPrice(q.postMarketPrice)) {
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

function normaliseSession(state: string | null | undefined): MarketSession {
  switch ((state ?? '').toUpperCase()) {
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
    case 'CLOSED':
      return 'MARKET CLOSED';
    case 'REGULAR':
      return null;
  }
}
