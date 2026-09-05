/** A daily bar as the API returns it. Only `close` is guaranteed. */
export interface Bar {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
}

/** Calendar day count since the epoch, for date-only arithmetic with no timezone drift. */
function dayNumber(dateStr: string): number {
  return Math.floor(Date.parse(`${dateStr}T00:00:00Z`) / 86_400_000);
}

/**
 * Which bar a fill belongs to. Fills carry a full timestamp, bars a date, so
 * the comparison is on the date part. A weekend or holiday fill (the owner's
 * own record of a trade the market wasn't open for) has no bar of its own,
 * so it snaps **backward** to the last trading day at or before the fill's
 * date — the session that was actually open when the fill happened. This is
 * the only direction that can't put a fill on the wrong side of the trade:
 * snapping forward (as an earlier version of this function did) can land an
 * exit on the session *after* the owner was already out, making post-exit
 * price action look like it happened during the trade. Falls back to the
 * first bar only when the fill predates the entire window. Bars are assumed
 * to already be in chronological order, as the API returns them. Returns -1
 * only when there are no bars at all to snap to.
 *
 * Still needed with `lightweight-charts` doing the geometry: the library
 * places a marker by matching a data point's time, so a fill still has to be
 * resolved to a real bar before it can be drawn.
 */
export function indexForDate(bars: Bar[], isoTimestamp: string): number {
  if (bars.length === 0) return -1;
  const day = isoTimestamp.slice(0, 10);
  const exact = bars.findIndex((b) => b.date === day);
  if (exact !== -1) return exact;

  const target = dayNumber(day);
  for (let i = bars.length - 1; i >= 0; i--) {
    if (dayNumber(bars[i].date) <= target) return i;
  }
  // Every bar is after the fill's date — it predates the whole window.
  return 0;
}

/**
 * For a fill whose recorded price doesn't belong to its own bar (the tell
 * for a seeded entry: it is stamped with the seed date and the owner's
 * average cost, not a real historical print), find the most recent
 * *earlier* bar whose own low..high range actually contains that price —
 * the owner really did trade at this level at some real point in the
 * window, just not on the date seeding recorded.
 *
 * Searches strictly backward from `fromIndex`, never including it or
 * anything after it: that bar is exactly the one already known not to
 * contain the price. Returns -1 when no earlier bar contains it either —
 * the caller leaves the marker where it is rather than falling back to a
 * nearest-price bar, which would stack a second guess on top of the first.
 */
export function backfillIndexForPrice(
  bars: Bar[],
  fromIndex: number,
  price: number,
): number {
  for (let i = fromIndex - 1; i >= 0; i--) {
    const b = bars[i];
    if (b.low !== null && b.high !== null && price >= b.low && price <= b.high) {
      return i;
    }
  }
  return -1;
}

/**
 * Why a fill did not land on a bar of its own date.
 *
 * `non-trading-day` is the legitimate case the snapping exists for: a
 * weekend or holiday fill, drawn on the session that was open at the time.
 *
 * `beyond-data` is a different thing wearing the same shape — the fill is
 * newer than the newest bar held, so the market DID trade and the bar simply
 * has not been fetched. Snapping backward then draws the marker on an older
 * candle at a price that day never reached: a Sep 3 fill at $612.73 landed on
 * Sep 2, whose high was $600.38, which reads as the chart showing wrong
 * prices. Naming it separately keeps the explanation truthful, and points at
 * stale market data rather than at a trade recorded on a Sunday.
 */
export type FillPlacement = 'exact' | 'non-trading-day' | 'beyond-data';

export function placementFor(bars: Bar[], fillIso: string): FillPlacement {
  const day = fillIso.slice(0, 10);
  if (bars.some((b) => b.date === day)) return 'exact';
  const last = bars.at(-1)?.date;
  return last !== undefined && day > last ? 'beyond-data' : 'non-trading-day';
}

/**
 * Which side of the fill price to hang its marker on, given the candle it
 * lands on.
 *
 * A marker anchored to the price is only honest if it sits *at* the price —
 * but a fill inside the day's range then has a candle underneath it, and an
 * arrow drawn over the body hides the very price action it annotates. The
 * two constraints only conflict in the middle of the range, so the choice is
 * made per fill instead of fixed per side: hang it on whichever side of the
 * price is nearer that candle's edge, which is the side with less candle to
 * cover.
 *
 * For a fill at or beyond an extreme — a seeded entry relocated onto a bar
 * that merely reaches its price — the nearer edge is the one it is beyond,
 * so the marker lands in open space outside the candle entirely.
 *
 * Ties go below: a doji has no body to hide either way, and an arbitrary
 * rule that is at least stable beats one that flickers as prices move.
 */
export function markerSideForPrice(
  bar: { high: number; low: number },
  price: number,
): 'atPriceTop' | 'atPriceBottom' {
  return price - bar.low <= bar.high - price ? 'atPriceBottom' : 'atPriceTop';
}
