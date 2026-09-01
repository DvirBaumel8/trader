import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type Coordinate,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';
import {
  backfillIndexForPrice,
  indexForDate,
  type Bar,
} from '../lib/candleScale';

export interface Fill {
  executedAt: string;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  fee: number;
}

export interface StopLevel {
  kind: 'FIXED' | 'TRAILING';
  price: number | null;
  trailPercent: number | null;
  quantity: number;
}

/**
 * The app's own palette, not the library default — this should look like it
 * belongs on the dark chart surface the rest of the app uses, not a bolted-on
 * widget. Fills now share UP/DOWN with the candles (the owner wants red
 * sells, green buys), so shape and size — not colour — carry the "this is
 * *my* action" distinction. ACCENT is reserved for the crosshair readout,
 * the one other thing that's specifically his interaction with the chart.
 */
const BG = '#0a0e17';
const TEXT = '#e6edf7';
const MUTED = '#7d8da6';
const GRID = '#232f42';
const UP = '#22c55e';
const DOWN = '#f43f5e';
const ACCENT = '#2dd4bf';

/**
 * A bar with a confirmed OHLC range — the only kind lightweight-charts'
 * candlestick series can plot. A day Yahoo returned without a range is
 * skipped rather than invented (matches the backfill's own contract: close
 * alone stays sufficient elsewhere, the chart just omits that candle).
 */
type CandleBar = Bar & { open: number; high: number; low: number };

function hasRange(b: Bar): b is CandleBar {
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
function placeFills(bars: Bar[], fills: Fill[]) {
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

      let markerBar = bar;
      let relocated = false;
      if (outOfRange) {
        const backIndex = backfillIndexForPrice(candleBars, index, f.price);
        if (backIndex !== -1) {
          markerBar = candleBars[backIndex];
          relocated = true;
        }
      }

      return { fill: f, bar, markerBar, snapped, outOfRange, relocated };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);
  return { candleBars, placed };
}

export function TradeChart({
  bars,
  fills,
  stopLevels,
}: {
  bars: Bar[];
  fills: Fill[];
  stopLevels: StopLevel[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Only used for the honesty lines below — the effect recomputes its own
  // copy from the props directly, so the chart doesn't get rebuilt every
  // render just because this derivation produced a fresh array reference.
  const { candleBars, placed: placedFills } = placeFills(bars, fills);
  const snappedCount = placedFills.filter((p) => p.snapped).length;
  const anyOutOfRange = placedFills.some((p) => p.outOfRange);
  const anyRelocated = placedFills.some((p) => p.relocated);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const { candleBars, placed } = placeFills(bars, fills);
    if (candleBars.length === 0) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: BG },
        textColor: TEXT,
        fontSize: 11,
      },
      grid: {
        vertLines: { color: GRID },
        horzLines: { color: GRID },
      },
      crosshair: {
        // Normal, not Magnet: Magnet snaps the horizontal line to the
        // nearest candle's OHLC values, which makes it useless for the
        // owner's actual use — placing the line at an arbitrary level
        // between candles to check whether price gapped through it.
        mode: CrosshairMode.Normal,
        vertLine: { color: MUTED, labelBackgroundColor: ACCENT },
        horzLine: { color: MUTED, labelBackgroundColor: ACCENT },
      },
      rightPriceScale: { borderColor: GRID },
      timeScale: { borderColor: GRID },
      // The owner's fixed-window decision stands, and a pannable chart
      // inside a scrolling page fights the page's own scroll on a phone.
      // The crosshair — what he actually asked for — works without these.
      handleScroll: false,
      handleScale: false,
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
    });

    series.setData(
      candleBars.map((b) => ({
        time: b.date,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      })),
    );

    // A trailing tier has no fixed level to draw; it stays in the text below
    // the chart instead of being drawn at a guessed price.
    const drawableStops = stopLevels.filter(
      (s): s is StopLevel & { price: number } =>
        s.kind === 'FIXED' && s.price !== null,
    );

    // The line itself (still full-width, so it reads at a glance against
    // every candle) carries no built-in text: in this library a price
    // line's `title` and its axis chip are the same visibility switch — you
    // cannot show one without the other — and the title always renders
    // right-aligned in the pane, right next to the price scale. With a
    // recently-closed or still-open trade the window is truncated at
    // "today", so the exit sits right there too: title + chip + exit
    // marker text all fight for the same few pixels. A single custom
    // marker per stop (below, with `fills`) replaces both.
    for (const s of drawableStops) {
      series.createPriceLine({
        price: s.price,
        color: MUTED,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: false,
        title: '',
      });
    }

    // Fills: the owner's own actions. Colour now matches the candle
    // convention he asked for (red sells, green buys), so shape (arrow
    // direction) and size carry the "this is mine" distinction instead.
    // Text is the price alone — short, so it's never the thing forced to
    // truncate at the window's crowded right edge — since the crosshair
    // (Normal mode, above) can now read off any price on demand anyway.
    //
    // Anchored to the bar, not the price: 'atPriceMiddle' put a marker right
    // on top of that day's candle, hiding the price action it annotates.
    // 'belowBar' (buys) / 'aboveBar' (sells) — the conventional placement
    // for trade markers — draws it just outside the candle instead, so no
    // `price` field here (it only means something for the atPrice* family).
    // A seeded entry's recorded price sits nowhere near its recorded day's
    // range (e.g. a fill at 13.29 on a day that traded near 17.32) — the
    // owner's explicit call was to relocate that marker to a bar that
    // actually traded at that level (`markerBar`, from `placeFills`) rather
    // than draw a cost line, so it reads as "this is where you actually
    // bought" instead of a floating rendering bug. Every genuine fill's
    // `markerBar` is just its own true bar — only an out-of-range fill ever
    // differs. The honesty note below discloses the relocation explicitly.
    const fillMarkers = placed.map(
      ({ fill, markerBar }): SeriesMarker<Time> => ({
        time: markerBar.date,
        position: fill.side === 'BUY' ? 'belowBar' : 'aboveBar',
        shape: fill.side === 'BUY' ? 'arrowUp' : 'arrowDown',
        color: fill.side === 'BUY' ? UP : DOWN,
        size: 2.5,
        text: fill.price.toFixed(2),
      }),
    );

    // Two stop tiers can sit close enough in *price* to collide in *pixels*
    // — how close depends on the window's price range, not on the dollar
    // gap alone (39 cents is a collision on BITX's ~$10-tall chart, but
    // would not be on a much wider one), so this is decided from the
    // chart's real, already-computed price scale (`priceToCoordinate`)
    // rather than a fixed price-difference guess. Sorted top-to-bottom on
    // screen, each label is pushed down just far enough to clear a
    // roughly-one-line gap from the one above it; the underlying dashed
    // line stays exactly at the true stop price — only the label's
    // position is nudged, never the price it reports.
    const MIN_STOP_LABEL_GAP_PX = 16;
    const stopsByScreenY = drawableStops
      .map((s) => ({ stop: s, y: series.priceToCoordinate(s.price) }))
      .filter(
        (
          x,
        ): x is { stop: (typeof drawableStops)[number]; y: Coordinate } =>
          x.y !== null,
      )
      .sort((a, b) => a.y - b.y);
    const labelPriceByStop = new Map<(typeof drawableStops)[number], number>();
    let previousLabelY = -Infinity;
    for (const { stop, y } of stopsByScreenY) {
      const labelY = Math.max(y, previousLabelY + MIN_STOP_LABEL_GAP_PX);
      labelPriceByStop.set(stop, series.coordinateToPrice(labelY) ?? stop.price);
      previousLabelY = labelY;
    }

    // One label per stop, combining identity and price in its text, and
    // anchored well clear of the right edge — where a recent or open
    // trade's exit (and this window's truncation) both live — so it never
    // competes with a fill marker for the same pixels. Multiple stops are
    // also staggered onto their own bar horizontally, so two close prices
    // don't collide with each other on that axis either — on top of the
    // vertical declutter above, for whichever axis the collision is on.
    const stopMarkers = drawableStops.map((s, i): SeriesMarker<Time> => {
      const lane = 0.15 + i * 0.1;
      const anchorIndex = Math.min(
        candleBars.length - 1,
        Math.max(0, Math.round((candleBars.length - 1) * lane)),
      );
      return {
        time: candleBars[anchorIndex].date,
        position: 'atPriceMiddle',
        price: labelPriceByStop.get(s) ?? s.price,
        shape: 'square',
        color: MUTED,
        size: 1,
        text: `Stop ${s.price.toFixed(2)}`,
      };
    });

    // The library stacks same-bar/same-position markers outward rather than
    // overdrawing them — confirmed in its source (SeriesMarkersPaneView's
    // per-bar aboveBar/belowBar offset accumulators) — but that stacking
    // only triggers between markers that are *adjacent* in this array (the
    // accumulator resets whenever `time` changes between consecutive
    // entries). Sorting by time guarantees two fills that snap to the same
    // bar (BITX's two Sunday sells both land on the following Monday) are
    // adjacent regardless of the order `fills` came back in, rather than
    // relying on the API already returning them chronologically.
    const markers = [...fillMarkers, ...stopMarkers].sort((a, b) =>
      String(a.time).localeCompare(String(b.time)),
    );
    createSeriesMarkers(series, markers);

    chart.timeScale().fitContent();

    return () => chart.remove();
  }, [bars, fills, stopLevels]);

  if (candleBars.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-surface-1 p-3 text-xs text-muted">
        No price history for this window yet — run a backfill.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="h-[260px] w-full overflow-hidden rounded-xl"
      />

      {/* Honest numbers over pretty ones: say so, rather than silently
          moving or dropping a fill that doesn't line up with its own day. */}
      {snappedCount > 0 && (
        <p className="text-[11px] text-muted">
          {snappedCount === 1
            ? '1 fill fell on a non-trading day and is shown on the nearest session.'
            : `${snappedCount} fills fell on non-trading days and are shown on the nearest session.`}
        </p>
      )}
      {anyOutOfRange && (
        <p className="text-[11px] text-muted">
          Some fills sit outside the price range for their day — a seeded
          position records your average cost on the seed date, not the
          original fill.
          {anyRelocated &&
            ' This marker is placed on the most recent day price actually traded at that level, not a known entry date.'}
        </p>
      )}
    </div>
  );
}
