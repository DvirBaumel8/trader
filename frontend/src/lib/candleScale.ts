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
