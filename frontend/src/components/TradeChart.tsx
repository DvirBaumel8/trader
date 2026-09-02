import { useEffect, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';
import {
  backfillIndexForPrice,
  indexForDate,
  type Bar,
} from '../lib/candleScale';
import { replayFrame } from '../lib/tradeReplay';

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

/** How long each newly-revealed bar stays on screen before the next one
 * appears. Tuned for the real window sizes this chart draws (~25–45 daily
 * bars): fast enough that a 40-bar trade finishes in well under five
 * seconds — "a few seconds, not thirty" — slow enough that a fill marker
 * arriving is still something the eye catches rather than a blur. A fixed
 * per-bar tick (not a fixed total duration) was chosen over normalising
 * every trade to the same length: it keeps a consistent, readable rhythm
 * across the whole range instead of needing per-trade retiming for little
 * benefit at these window sizes. */
const REPLAY_TICK_MS = 120;

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

/** A trailing tier has no fixed level to draw; it stays in the text below
 * the chart instead of being drawn at a guessed price. */
function drawableStopsOf(
  stopLevels: StopLevel[],
): (StopLevel & { price: number })[] {
  return stopLevels.filter(
    (s): s is StopLevel & { price: number } =>
      s.kind === 'FIXED' && s.price !== null,
  );
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
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const markersApiRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);

  // Only used for the honesty lines and the stops summary below — these
  // effects recompute their own copies from the props directly, so the
  // chart doesn't get rebuilt every render just because this derivation
  // produced a fresh array reference.
  const { candleBars, placed: placedFills } = placeFills(bars, fills);
  const snappedCount = placedFills.filter((p) => p.snapped).length;
  const anyOutOfRange = placedFills.some((p) => p.outOfRange);
  const anyRelocated = placedFills.some((p) => p.relocated);
  const totalBars = candleBars.length;

  // Stop levels, for the "top to bottom" text summary — see the label
  // placement note on the drawing effect below for why they're not drawn
  // as in-chart labels at all.
  const stopSummaryPrices = drawableStopsOf(stopLevels)
    .map((s) => s.price)
    .sort((a, b) => b - a)
    .map((p) => p.toFixed(2));

  // Replay state. Static by default — the owner opens this chart often
  // just to check where his stop sits, and being made to sit through an
  // animation every time it opens would wear out fast (the same failure
  // mode as the always-on staleness banner). `step` starts at `totalBars`,
  // i.e. everything revealed, identical to the pre-replay static chart.
  // No separate `isPlaying` flag: `step < totalBars` *is* "a replay is in
  // progress" — Play sets step to 0, Skip-to-end sets it straight to
  // `totalBars`, and the ticking effect below just keeps advancing step by
  // one until it catches up. One state variable, one source of truth.
  const [step, setStep] = useState(totalBars);

  // A different trade (new bars/fills/stopLevels) resets back to the
  // static, fully-revealed view rather than carrying over a stale replay
  // position from whatever trade was open before.
  useEffect(() => {
    setStep(totalBars);
    // `totalBars` is deliberately not a dependency: it's derived from
    // `bars`/`fills` (already listed) via `placeFills`, so including it too
    // would just be the same change firing this effect twice.
  }, [bars, fills, stopLevels]);

  // The ticking clock. A chained setTimeout, not setInterval: each tick is
  // scheduled fresh off the *current* step, so there is exactly one timer
  // alive at a time and the effect's own cleanup (unmount, step change,
  // reaching the end, skip-to-end jumping `step` straight to `totalBars`)
  // is always enough to clear it. No separate teardown path to forget.
  useEffect(() => {
    if (step >= totalBars) return;
    const id = setTimeout(() => setStep((s) => s + 1), REPLAY_TICK_MS);
    return () => clearTimeout(id);
  }, [step, totalBars]);

  const handlePlay = () => {
    setStep(0);
  };
  const handleSkipToEnd = () => {
    setStep(totalBars);
  };

  // Chart + series creation. Runs once per trade (bars/fills/stopLevels
  // change) — the expensive part — and is otherwise left alone as `step`
  // ticks during a replay; a second effect below pushes each frame's data
  // into the chart this effect built.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const { candleBars } = placeFills(bars, fills);
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

    // The price axis's range is fixed once, from the *full* window — highs,
    // lows and stop prices alike — and never recomputed as bars come and
    // go during replay. Overriding the library's default per-visible-data
    // autoscale with a constant is what makes "candles rise into the space
    // above" true instead of the axis creeping in as each bar reveals a new
    // extreme, and it is also why the replay's last frame renders pixel-
    // identical to the plain static chart: both use this same range.
    const drawableStops = drawableStopsOf(stopLevels);
    const highs = candleBars.map((b) => b.high);
    const lows = candleBars.map((b) => b.low);
    const stopPrices = drawableStops.map((s) => s.price);
    const minValue = Math.min(...lows, ...stopPrices);
    const maxValue = Math.max(...highs, ...stopPrices);

    const series = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      autoscaleInfoProvider: () => ({
        priceRange: { minValue, maxValue },
      }),
    });

    const markersApi = createSeriesMarkers(series, []);

    chartRef.current = chart;
    seriesRef.current = series;
    markersApiRef.current = markersApi;
    priceLinesRef.current = [];

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markersApiRef.current = null;
      priceLinesRef.current = [];
    };
  }, [bars, fills, stopLevels]);

  // Per-frame draw. Runs on every replay tick (and once for the static
  // default, since `step` starts at `totalBars`). Keeps every time slot in
  // the window present in the series data at all times — real candles for
  // revealed bars, `{ time }` whitespace placeholders for the rest — so
  // `fitContent()` always fits the *same* full time span and the time axis
  // never rescales as bars are revealed, matching the fixed price axis.
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const markersApi = markersApiRef.current;
    if (!chart || !series || !markersApi) return;

    const { candleBars, placed } = placeFills(bars, fills);
    const drawableStops = drawableStopsOf(stopLevels);
    const barDates = candleBars.map((b) => b.date);
    const markerBarDates = placed.map((p) => p.markerBar.date);
    const frame = replayFrame(barDates, markerBarDates, step);

    series.setData(
      candleBars.map((b, i) =>
        i < frame.visibleBarCount
          ? { time: b.date, open: b.open, high: b.high, low: b.low, close: b.close }
          : { time: b.date },
      ),
    );
    chart.timeScale().fitContent();

    // Fill markers: the owner's own actions. Colour matches the candle
    // convention he asked for (red sells, green buys), so shape (arrow
    // direction) and size carry the "this is mine" distinction. Text is the
    // price alone — short, so it never has to truncate — since the
    // crosshair (Normal mode, above) can read off any price on demand
    // anyway.
    //
    // Anchored to the bar, not the price: 'atPriceMiddle' put a marker
    // right on top of that day's candle, hiding the price action it
    // annotates. 'belowBar' (buys) / 'aboveBar' (sells) — the conventional
    // placement for trade markers — draws it just outside the candle
    // instead. A seeded entry's recorded price sits nowhere near its
    // recorded day's range — the owner's explicit call was to relocate
    // that marker to a bar that actually traded at that level (`markerBar`,
    // from `placeFills`) rather than draw a cost line, so it reads as
    // "this is where you actually bought" instead of a floating rendering
    // bug. Only shown once its own bar is reached (`visibleFillIndices`),
    // so watching a fill arrive — and only then seeing what followed — is
    // preserved during replay.
    const visible = new Set(frame.visibleFillIndices);
    const fillMarkers: SeriesMarker<Time>[] = placed
      .filter((_, i) => visible.has(i))
      .map(({ fill, markerBar }) => ({
        time: markerBar.date as Time,
        position: fill.side === 'BUY' ? 'belowBar' : 'aboveBar',
        shape: fill.side === 'BUY' ? 'arrowUp' : 'arrowDown',
        color: fill.side === 'BUY' ? UP : DOWN,
        size: 2.5,
        text: fill.price.toFixed(2),
      }));

    // The library stacks same-bar/same-position markers outward rather than
    // overdrawing them, but that stacking only triggers between markers
    // that are *adjacent* in this array. Sorting by time guarantees two
    // fills that land on the same bar are adjacent regardless of the order
    // `fills` came back in.
    fillMarkers.sort((a, b) => String(a.time).localeCompare(String(b.time)));
    markersApi.setMarkers(fillMarkers);

    // Stop lines. Label placement: rejected two approaches before this one.
    // (1) An absolutely-positioned DOM overlay using `priceToCoordinate()`,
    // pinned to a chart-container margin — still has to dodge fill-marker
    // labels that can land anywhere near that margin, and has to be kept in
    // sync with every resize/redraw by hand. (2) Searching the visible
    // window for a horizontal band where no candle's high–low span crosses
    // the stop price — not guaranteed to exist (BITX's two stops sit 39
    // cents apart on a ~$10 range, where candles routinely span the whole
    // window), so it still needs one of the other approaches as a fallback,
    // which means building both anyway.
    //
    // What's here instead: the dashed lines stay (full width, unlabelled —
    // `axisLabelVisible: false` avoids the library's built-in title/chip,
    // which are the same visibility switch and would still collide with
    // the price scale and a recent trade's exit marker at the right edge),
    // and identity + price move entirely off the plot into the text summary
    // below the chart, ordered top to bottom. A label that isn't drawn on
    // the plot cannot collide with anything on the plot — candle, other
    // stop, or fill label — which is the actual requirement, and it holds
    // regardless of how tight the stops or how busy the candles are.
    //
    // Visible from the moment the entry fill is (`stopLinesVisible`), not
    // from the start: the stop was set at entry, so drawing the line before
    // the entry marker has appeared would flag "something happens near this
    // price" before the owner himself knew it — a spoiler exactly like
    // showing the exit early would be.
    for (const line of priceLinesRef.current) {
      series.removePriceLine(line);
    }
    priceLinesRef.current = frame.stopLinesVisible
      ? drawableStops.map((s) =>
          series.createPriceLine({
            price: s.price,
            color: MUTED,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: false,
            title: '',
          }),
        )
      : [];
  }, [step, bars, fills, stopLevels]);

  if (candleBars.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-surface-1 p-3 text-xs text-muted">
        No price history for this window yet — run a backfill.
      </p>
    );
  }

  const replayFinished = step >= totalBars;

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="h-[260px] w-full overflow-hidden rounded-xl"
      />

      {totalBars > 1 && (
        <div className="flex items-center gap-3">
          {replayFinished ? (
            <button
              type="button"
              onClick={handlePlay}
              className="text-xs font-medium text-accent"
            >
              ▶ Replay
            </button>
          ) : (
            <>
              <span className="text-xs text-muted">Replaying…</span>
              <button
                type="button"
                onClick={handleSkipToEnd}
                className="text-xs font-medium text-accent"
              >
                Skip to end
              </button>
            </>
          )}
        </div>
      )}

      {stopSummaryPrices.length > 0 && (
        <p className="text-[11px] text-muted">
          {stopSummaryPrices.length === 1
            ? `Stop: ${stopSummaryPrices[0]}`
            : `Stops, top to bottom: ${stopSummaryPrices.join(', ')}`}
        </p>
      )}

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
