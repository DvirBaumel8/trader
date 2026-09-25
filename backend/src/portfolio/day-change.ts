import { todayChangePercent } from '../watchlist/score.js';

export interface DayChange {
  /** Per-share move since the previous regular close. */
  dayChange: number | null;
  /** The same move as a FRACTION of the previous close. */
  dayChangePct: number | null;
  /** What that move did to this position: signed, so a short loses on a rise. */
  dayPnl: number | null;
}

/**
 * Today's move for one holding, the way Handy Trader's Change column reads.
 * `price` is whichever price select-price.ts picked for the session, so a
 * pre-market or after-hours print moves this the same way it moves the price
 * shown next to it. The Holdings title labels those sessions. Shares the
 * percent convention with the watchlist by reusing `todayChangePercent`, so
 * the two screens can never disagree about the same ticker's move.
 */
export function computeDayChange(
  price: number | null,
  previousClose: number | null,
  quantity: number,
): DayChange {
  const pct = todayChangePercent(price, previousClose);
  if (pct === null || price === null || previousClose === null) {
    return { dayChange: null, dayChangePct: null, dayPnl: null };
  }
  const dayChange = price - previousClose;
  return { dayChange, dayChangePct: pct, dayPnl: dayChange * quantity };
}

/**
 * A total over figures that may be unpriced. Null only when NOTHING could
 * be priced: a portfolio of unpriceable holdings has an unknown total, not a
 * zero one.
 */
export function sumNullable(values: (number | null)[]): number | null {
  const priced = values.filter((v): v is number => v !== null);
  return priced.length === 0 ? null : priced.reduce((s, v) => s + v, 0);
}
