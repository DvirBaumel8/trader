/**
 * A trade is derived, never stored, so it has no database id. Symbol plus
 * entry timestamp identifies it uniquely: two trades in one symbol cannot
 * overlap, because a trade is the span from flat to flat.
 *
 * This means an id goes stale if the opening transaction is edited — the
 * trade is simply re-derived under a new one. The endpoint 404s rather than
 * rendering an empty chart.
 */
export function tradeId(symbol: string, enteredAt: Date): string {
  return `${symbol}:${enteredAt.toISOString()}`;
}

export function parseTradeId(
  id: string,
): { symbol: string; enteredAt: string } | null {
  // Split on the FIRST colon only: the ISO timestamp contains colons too.
  const separator = id.indexOf(':');
  if (separator <= 0) return null;
  const symbol = id.slice(0, separator);
  const enteredAt = id.slice(separator + 1);
  if (!symbol || Number.isNaN(Date.parse(enteredAt))) return null;
  return { symbol, enteredAt };
}

/** Trading days of context on each side of the trade. About one month. */
const PADDING_TRADING_DAYS = 21;

/** Calendar days needed to span N trading days, weekends included. */
function calendarDaysFor(tradingDays: number): number {
  return Math.ceil((tradingDays / 5) * 7);
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The bar range the chart asks for: padded either side so the setup before
 * the entry and the aftermath of the exit are both visible.
 *
 * `toDate` is null for an open trade — there is no right edge yet, and the
 * query simply takes everything up to the latest bar that exists. No bar is
 * ever invented to fill the padding.
 */
export function windowBounds(
  enteredAt: Date,
  exitedAt: Date | null,
  tradingDays: number = PADDING_TRADING_DAYS,
): { fromDate: string; toDate: string | null } {
  const padding = calendarDaysFor(tradingDays);

  const from = new Date(enteredAt);
  from.setUTCDate(from.getUTCDate() - padding);

  if (exitedAt === null) return { fromDate: toDateString(from), toDate: null };

  const to = new Date(exitedAt);
  to.setUTCDate(to.getUTCDate() + padding);
  return { fromDate: toDateString(from), toDate: toDateString(to) };
}
