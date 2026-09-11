import {
  backfillIndexForPrice,
  indexForDate,
  placementFor,
  type Bar,
} from './candleScale';

/** One fill of the trade, as the API returns it. */
export interface Fill {
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  fee: number;
  executedAt: string;
}

/**
 * A bar with a confirmed OHLC range — the only kind lightweight-charts'
 * candlestick series can plot. A day Yahoo returned without a range is
 * skipped rather than invented (matches the backfill's own contract: close
 * alone stays sufficient elsewhere, the chart just omits that candle).
 */
type CandleBar = Bar & { open: number; high: number; low: number };

export function hasRange(b: Bar): b is CandleBar {
  return b.open !== null && b.high !== null && b.low !== null;
}

/**
 * Where each fill lands once snapped onto the nearest *plottable* trading
 * session (a weekend or holiday fill has no bar of its own — see
 * `indexForDate`), and — for a fill that landed on its own real day, not a
 * borrowed one — whether its price falls outside that day's actual range.
 * That is the tell for a seeded opening fill, which is stamped with the
 * seed date and the owner's average cost rather than a real historical
 * print — detected from the data, not from any assumption about which
 * trades were seeded, since transactions carry no such flag.
 *
 * An out-of-range fill also gets `markerBar`: the owner really did trade at
 * that price at some real point in the window, just not on the recorded
 * date, so the marker is relocated to the most recent earlier bar whose own
 * range actually contains the price (see `backfillIndexForPrice`) — while
 * `bar` (and `outOfRange` itself) keep referring to the *true* recorded
 * bar, since that is what "out of range" means and the honesty note below
 * has to stay accurate about it. Only an out-of-range fill is ever
 * relocated; every genuine post-seed fill keeps its true date.
 */
export function placeFills(bars: Bar[], fills: Fill[]) {
  const candleBars = bars.filter(hasRange);
  const placed = fills
    .map((f) => {
      const index = indexForDate(candleBars, f.executedAt);
      if (index === -1) return null;
      const bar = candleBars[index];
      const ownDay = f.executedAt.slice(0, 10);
      const snapped = bar.date !== ownDay;
      // A snapped fill was borrowed onto a bar it didn't actually happen
      // on (see indexForDate) — its price has no meaningful relationship
      // to that borrowed day's range, so only a fill on its own real
      // trading day can be honestly flagged as outside it. Without this
      // guard a real print snapped onto a day whose range doesn't happen
      // to contain it gets blamed on seeding, which is simply false.
      const outOfRange = !snapped && (f.price < bar.low || f.price > bar.high);

      /**
       * The NEWEST bar is still being written, so it is never evidence of
       * seeding.
       *
       * Relocation exists for a seeded opening fill, stamped with the seed
       * date and an average cost no single day traded at. A fill on today's
       * bar looks identical — its price can sit outside a range that has not
       * finished forming — and treating it the same way moves a real fill to
       * a date it did not happen on.
       *
       * It did exactly that: ORCL sold at 151.29 on Sep 11, today's bar read
       * 154.37–165.99, and the exit was redrawn on Sep 3, whose range happened
       * to contain 151.29. The backend now keeps today's bar fresh
       * (`isHistoryBehind`), which fixes the cause; this is the belt to that
       * braces, because today's bar is partial between refreshes no matter
       * how often it is fetched.
       */
      const onNewestBar = index === candleBars.length - 1;

      let markerBar = bar;
      let relocated = false;
      if (outOfRange && !onNewestBar) {
        const backIndex = backfillIndexForPrice(candleBars, index, f.price);
        if (backIndex !== -1) {
          markerBar = candleBars[backIndex];
          relocated = true;
        }
      }

      // Why it did not land on its own day — see placementFor. A fill newer
      // than the newest bar is a data gap, not a weekend.
      const beyondData = placementFor(candleBars, f.executedAt) === 'beyond-data';

      return { fill: f, bar, markerBar, snapped, beyondData, outOfRange, relocated };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);
  return { candleBars, placed };
}



export type PlacedFill = ReturnType<typeof placeFills>['placed'][number];
