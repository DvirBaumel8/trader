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
 * so it snaps to the nearest trading day by absolute date distance, ties
 * going to the earlier bar — a weekend-dated fill most likely refers to the
 * session just before it. Bars are assumed to already be in chronological
 * order, as the API returns them. Returns -1 only when there are no bars at
 * all to snap to.
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
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < bars.length; i++) {
    const distance = Math.abs(dayNumber(bars[i].date) - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return bestIndex;
}
