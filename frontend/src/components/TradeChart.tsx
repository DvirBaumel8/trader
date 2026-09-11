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
  type Time,
} from 'lightweight-charts';
import type { Bar } from '../lib/candleScale';
import { placeFills, type Fill } from '../lib/fillPlacement';
import { replayFrame } from '../lib/tradeReplay';
import { fillPriceLines, formatFillsSummary } from '../lib/fillsSummary';
import { resolvedStopLines } from '../lib/stopSummary';
import { CalloutOverlay } from './chart/CalloutOverlay';
import { useCallouts } from './chart/useCallouts';
import { paddedRange } from '../lib/annotationLayout';

// Owned by fillPlacement, which is the module that reasons about fills.
// Re-exported because callers already import it from here.
export type { Fill } from '../lib/fillPlacement';

export interface StopLevel {
  kind: 'FIXED' | 'TRAILING';
  price: number | null;
  trailPercent: number | null;
  quantity: number;
  /**
   * Today's actual level for this stop, or `null` when the backend can't
   * compute one yet (a trailing tier missing high-water data — never a
   * guess). For a fixed stop this is just `price`; for a trailing stop it's
   * the high-water mark since entry times the trail, which is why it's the
   * only field this component trusts to decide whether — and where — to
   * draw a line. May be absent on an API response that predates this field;
   * treated the same as `null` everywhere it's read.
   */
  resolvedPrice?: number | null;
}

/**
 * The app's own palette, not the library default — this should look like it
 * belongs on the dark chart surface the rest of the app uses, not a bolted-on
 * widget. Fills now share UP/DOWN with the candles (the owner wants red
 * sells, green buys), so shape and size — not colour — carry the "this is
 * *my* action" distinction. ACCENT is reserved for the crosshair readout,
 * the one other thing that's specifically his interaction with the chart.
 */

/**
 * Bars of context kept either side of the trade. Roughly three weeks at daily
 * resolution — enough to read the trend the entry was taken against, without
 * shrinking the trade itself to a sliver the way the full fetched window did.
 */
const VIEW_PAD_BARS = 15;

/**
 * Bars of run-up a replay starts with, so the reveal begins just before the
 * entry rather than 45 days of history earlier.
 */
const REPLAY_LEAD_IN_BARS = 5;

const BG = '#0a0e17';
const TEXT = '#e6edf7';
const MUTED = '#7d8da6';
const GRID = '#232f42';
const UP = '#22c55e';
const DOWN = '#f43f5e';
const ACCENT = '#2dd4bf';

/** How long each newly-revealed bar stays on screen before the next one
 * appears. 120ms turned out too fast for a fill to actually register — by
 * the time the eye caught the marker, three more bars had already gone by.
 * 280ms sits in the owner's requested 250–300ms range: over the real window
 * sizes this chart draws (~25–45 daily bars) that's roughly 7–13 seconds
 * end to end — slow enough to watch a fill arrive, not so slow it becomes
 * tedious to sit through. A fixed per-bar tick (not a fixed total duration)
 * was chosen over normalising every trade to the same length: it keeps a
 * consistent, readable rhythm across the whole range instead of needing
 * per-trade retiming for little benefit at these window sizes. Skip-to-end
 * stays the escape hatch for anyone who doesn't want to sit through it. */
const REPLAY_TICK_MS = 280;

export function TradeChart({
  bars,
  fills,
  stopLevels,
  plannedTarget = null,
}: {
  bars: Bar[];
  fills: Fill[];
  stopLevels: StopLevel[];
  /** The level aimed for, recorded on the opening fill. Null when none was set. */
  plannedTarget?: number | null;
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
  const beyondDataCount = placedFills.filter((p) => p.beyondData).length;
  // Genuine non-trading-day fills only; the rest are a data gap, said
  // separately below.
  const snappedCount = placedFills.filter(
    (p) => p.snapped && !p.beyondData,
  ).length;
  const anyOutOfRange = placedFills.some((p) => p.outOfRange);
  const anyRelocated = placedFills.some((p) => p.relocated);
  const totalBars = candleBars.length;

  // Fills, as a text line beneath the chart instead of price text drawn on
  // the markers themselves — see the label-clipping note on the drawing
  // effect below for why the numbers moved off the plot entirely.
  const fillsSummary = formatFillsSummary(fills);

  // Stop levels, for the "top to bottom" text summary — see the label
  // placement note on the drawing effect below for why they're not drawn
  // as in-chart labels at all. Includes any stop (fixed or trailing) that
  // has resolved to a real price today; a trailing tier still missing
  // high-water data is surfaced separately, below.
  const resolvedLines = resolvedStopLines(stopLevels);
  const stopSummaryEntries = resolvedLines.map((l) =>
    l.kind === 'TRAILING' ? `Trailing ${l.label}` : l.label,
  );

  // Replay state. Static by default — the owner opens this chart often
  // just to check where his stop sits, and being made to sit through an
  // animation every time it opens would wear out fast (the same failure
  // mode as the always-on staleness banner). `step` starts at `totalBars`,
  // i.e. everything revealed, identical to the pre-replay static chart.
  // No separate `isPlaying` flag: `step < totalBars` *is* "a replay is in
  // progress" — Play sets step to 0, Skip-to-end sets it straight to
  // `totalBars`, and the ticking effect below just keeps advancing step by
  // one until it catches up. One state variable, one source of truth.
  //
  // A different trade resetting back to this fully-revealed view, rather
  // than carrying over a stale replay position, is the caller's job: it
  // renders this component keyed on the trade id, so a new trade is a fresh
  // mount with `step` initialized here — not a reset effect racing the
  // first paint.
  const [step, setStep] = useState(totalBars);

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

  /**
   * Replay starts at the edge of the FRAME, not at the first bar held.
   *
   * Starting from zero replayed 45 days of context the owner never asked to
   * watch: the candles crawled in from the far left while the chart sat
   * zoomed out, and the view snapped to the trade's window only once the
   * reveal reached it. Beginning at the first bar of the padded range means
   * the context is already drawn, the frame never moves, and the replay shows
   * the thing it is for — the run-up, the entry, and what followed.
   */
  const handlePlay = () => {
    const annotated = placedFills
      .map((p) => candleBars.findIndex((b) => b.date === p.markerBar.date))
      .filter((i) => i >= 0);
    // A handful of bars before the entry: the window's earlier context is
    // already drawn, and the reveal begins just before the thing worth
    // watching. Starting at the window's own left edge instead leaves the
    // frame completely empty, because those bars sit outside it.
    const start =
      annotated.length > 0
        ? Math.max(0, Math.min(...annotated) - REPLAY_LEAD_IN_BARS)
        : 0;
    setStep(start);
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
      // Without this the library formats its axis in the device's locale,
      // which put Hebrew month abbreviations on the owner's phone under an
      // otherwise English screen. Matches lib/chartDates.ts, so the axis and
      // the read-out beneath it name a month the same way.
      localization: { locale: 'en-US' },
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
      rightPriceScale: {
        borderColor: GRID,
        /**
         * Empty space for the callouts to live in. Without it the scale fits
         * the candles exactly, there is nowhere to put a label that is not on
         * top of a candle, and `priceToCoordinate` returns null for anything
         * beyond the highest high — which is why the first version of the
         * callouts rendered nothing at all.
         */
        scaleMargins: { top: 0.22, bottom: 0.18 },
      },
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
    const stopPrices = resolvedStopLines(stopLevels).map((s) => s.price);
    const highs = candleBars.map((b) => b.high);
    const lows = candleBars.map((b) => b.low);
    const minValue = Math.min(...lows, ...stopPrices);
    const maxValue = Math.max(...highs, ...stopPrices);

    const series = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      /**
       * The library's own "last value" line is off.
       *
       * It draws a dotted line at the most recent close with an axis tag, in
       * the series colour — which on this chart is indistinguishable from the
       * dashed/dotted lines we draw for stops. On ORCL it put a red dotted
       * line at 157.00 that reads as a stop level and is actually just
       * Thursday's close, with nothing on screen to say which it was.
       *
       * Every line on this chart should be one we drew and can name. An
       * unexplained one that mimics a risk level is worse than no line.
       */
      lastValueVisible: false,
      priceLineVisible: false,
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
    const drawableStops = resolvedStopLines(stopLevels);
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
    /**
     * The owner's step 4: show some time before the entry and after the sell,
     * rather than letting the trade sit flush against the edge of the plot.
     * `fitContent()` showed the entire fetched window, which is a month
     * either side and makes a three-day trade a sliver. A padded range around
     * the action reads the way his reference screenshot does.
     *
     * Falls back to fitContent whenever there is nothing to centre on, so an
     * unannotated chart is never worse off than before.
     */
    const annotatedIndices = placed
      .map((p) => candleBars.findIndex((b) => b.date === p.markerBar.date))
      .filter((i) => i >= 0);
    /**
     * Not while the replay is still at zero.
     *
     * At step 0 every point is whitespace, and asking the library to show a
     * logical range of nothing makes it fall back to a span of its own —
     * which is a visible jolt: the axis shifts a week to the left on the
     * first frame of a replay and then snaps back once bars appear. Leaving
     * the range alone keeps the frame the owner was already looking at.
     */
    if (frame.visibleBarCount === 0) {
      // Keep whatever range is already set.
    } else if (annotatedIndices.length > 0) {
      const range = paddedRange(candleBars.length, annotatedIndices, VIEW_PAD_BARS);
      chart.timeScale().setVisibleLogicalRange({ from: range.from, to: range.to });
    } else {
      chart.timeScale().fitContent();
    }

    // Fill markers: the owner's own actions. Colour matches the candle
    // convention he asked for (red sells, green buys), so shape (arrow
    // direction) and size carry the "this is mine" distinction. No text on
    // the marker itself: `lightweight-charts` positions marker labels
    // itself and never reflows or clips them into view, so a fill near
    // either edge of the window — the first bar, the last bar — or near the
    // top/bottom of the price range had its price label cut off (a real
    // screenshot: "112.79" rendered as "2.79", a plausible-looking *wrong*
    // number, worse than an obviously broken one). Two alternatives were
    // considered and rejected: widening the visible time range beyond the
    // first/last bar only fixes the horizontal case, not a marker clipped
    // top/bottom against the price axis; a hand-positioned DOM overlay
    // (`priceToCoordinate`) is exactly the approach already rejected below
    // for stop labels, for the same reasons — plus it would have to move on
    // every replay tick, not just on resize. Instead the price moves into
    // the `fillsSummary` text line beneath the chart (`formatFillsSummary`
    // in `lib/fillsSummary.ts`), which can never clip because it isn't
    // positioned against the plot at all — the same move already made for
    // stop levels below. The crosshair (Normal mode, above) still reads off
    // any price on the chart on demand.
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
    /**
     * No arrow markers any more.
     *
     * They were the thing covering the price action: a size-2 arrow anchored
     * at the fill price sat squarely on the candles around it, which is
     * exactly what the owner called amateur. Everything they carried is now
     * said better elsewhere — the callout names the level and its price, the
     * price line draws it across the plot, and the summary beneath repeats
     * the fills as text. Drawing both was clutter on top of clutter.
     */
    markersApi.setMarkers([]);

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
    // What's here instead: dashed lines stay (full width, unlabelled —
    // `axisLabelVisible: false` avoids the library's built-in title/chip,
    // which are the same visibility switch and would still collide with
    // the price scale and a recent trade's exit marker at the right edge),
    // and identity + price move entirely off the plot into the text summary
    // below the chart, ordered top to bottom. A label that isn't drawn on
    // the plot cannot collide with anything on the plot — candle, other
    // stop, or fill label — which is the actual requirement, and it holds
    // regardless of how tight the stops or how busy the candles are.
    //
    // Fixed and trailing stops are both drawn now that the backend resolves
    // a trailing tier to its current high-water level (`resolvedPrice`),
    // but a trailing line is not the same *kind* of fact as a fixed one — a
    // fixed stop is a level the owner set and it stays put; a trailing
    // stop's line is only where it sits *today* and will keep moving as the
    // high-water mark advances. Drawing them identically would claim a
    // permanence the trailing one doesn't have, so it gets its own line
    // style (`Dotted` vs `Dashed`) plus the word "Trailing" in the text
    // summary below — enough to tell them apart without adding an
    // on-plot label to dodge. A trailing tier the backend can't resolve yet
    // (`resolvedPrice: null` — missing high-water data, never guessed) is
    // filtered out by `resolvedStopLines` before this point and keeps the
    // pre-existing text-only treatment.
    //
    // Visible from the moment the entry fill is (`stopLinesVisible`), not
    // from the start: the stop was set at entry, so drawing the line before
    // the entry marker has appeared would flag "something happens near this
    // price" before the owner himself knew it — a spoiler exactly like
    // showing the exit early would be.
    for (const line of priceLinesRef.current) {
      series.removePriceLine(line);
    }
    // Every level that matters gets its number on the price axis. The
    // numbers used to live only in the text beneath the chart, which meant
    // reading a level off the plot was guesswork against the gridlines.
    // Axis labels are drawn by the library in the scale's own gutter, so
    // they are not the marker text that used to get clipped mid-number
    // (see fillsSummary.ts) — that failure mode does not apply here.
    const stopLines = frame.stopLinesVisible
      ? drawableStops.map((s) =>
          series.createPriceLine({
            price: s.price,
            color: MUTED,
            lineWidth: 1,
            lineStyle: s.kind === 'TRAILING' ? LineStyle.Dotted : LineStyle.Dashed,
            axisLabelVisible: true,
            title: '',
          }),
        )
      : [];

    // A line at each price actually traded. The markers above are anchored
    // to the bar rather than the price (see their note), so a fill's arrow
    // can float well away from the number in the summary beneath the chart
    // — a PLTR sell at 167.15 drew its arrow up near 185. These put the real
    // level back on the plot without covering the candle, and appear as
    // their own fill does during replay, so nothing is revealed early.
    const revealedFills = frame.visibleFillIndices.map((i) => placed[i].fill);
    const fillLines = fillPriceLines(revealedFills).map((l) =>
      series.createPriceLine({
        price: l.price,
        color: l.side === 'BUY' ? UP : DOWN,
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: '',
      }),
    );

    // The target the owner was aiming for, recorded at entry. Dashed like
    // the stops because it is the same kind of thing — a level that may or
    // may not be reached — and drawn in the accent colour so it reads as
    // the one level that is neither a fill nor a risk.
    const targetLine =
      plannedTarget !== null && plannedTarget > 0
        ? [
            series.createPriceLine({
              price: plannedTarget,
              color: ACCENT,
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: true,
              title: '',
            }),
          ]
        : [];

    priceLinesRef.current = [...stopLines, ...fillLines, ...targetLine];
  }, [step, bars, fills, stopLevels, plannedTarget]);

  const callouts = useCallouts({
    containerRef,
    chartRef,
    seriesRef,
    bars,
    fills,
    stopLevels,
    step,
  });

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
      <div className="relative h-[320px] w-full">
        <div
          ref={containerRef}
          className="h-full w-full overflow-hidden rounded-xl"
        />
        <CalloutOverlay callouts={callouts} />
      </div>

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

      {/* Fill prices, off the plot for the same reason stop prices are —
          see the label-clipping note on the drawing effect above. */}
      {fillsSummary && <p className="text-[11px] text-muted">{fillsSummary}</p>}

      {stopSummaryEntries.length > 0 && (
        <p className="text-[11px] text-muted">
          {stopSummaryEntries.length === 1
            ? resolvedLines[0].kind === 'TRAILING'
              ? `Trailing stop: ${resolvedLines[0].label}`
              : `Stop: ${stopSummaryEntries[0]}`
            : `Stops, top to bottom: ${stopSummaryEntries.join(', ')}`}
        </p>
      )}

      {plannedTarget !== null && plannedTarget > 0 && (
        <p className="text-[11px] text-muted">
          Target: {plannedTarget.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </p>
      )}

      {/*
        Honest numbers over pretty ones: say so, rather than silently moving
        or dropping a fill that doesn't line up with its own day.

        This one stays in the open because it is TRANSIENT and it resolves —
        the bars are behind, and the chart catches up when they refresh. It
        is the only one of these worth interrupting a glance for.
      */}
      {beyondDataCount > 0 && (
        <p className="text-[11px] text-down">
          {beyondDataCount === 1
            ? 'One fill is newer than the latest price bar, so its marker sits on the last day with data.'
            : `${beyondDataCount} fills are newer than the latest price bar, so their markers sit on the last day with data.`}{' '}
          The chart catches up once the bars refresh.
        </p>
      )}

      {/*
        The other two explain placement, and placement does not change: 20 of
        the owner's 57 fills came from the seed, so left in the open these
        were four lines of permanent furniture under a small chart on a
        phone. Folded away rather than cut — the wording is unchanged, and
        the reason a marker sits where it does is still one tap from the
        marker itself, which is the whole point of having said it.
      */}
      {(snappedCount > 0 || anyOutOfRange) && (
        <details className="text-[11px] text-muted">
          <summary className="cursor-pointer select-none text-accent">
            Why some markers sit where they do
          </summary>
          <div className="space-y-1 pt-1">
            {snappedCount > 0 && (
              <p>
                {snappedCount === 1
                  ? '1 fill fell on a non-trading day and is shown on the nearest session.'
                  : `${snappedCount} fills fell on non-trading days and are shown on the nearest session.`}
              </p>
            )}
            {anyOutOfRange && (
              <p>
                Some fills sit outside the price range for their day — a seeded
                position records your average cost on the seed date, not the
                original fill.
                {anyRelocated &&
                  ' This marker is placed on the most recent day price actually traded at that level, not a known entry date.'}
              </p>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
