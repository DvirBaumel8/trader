import { useCallback, useEffect, useState, type RefObject } from 'react';
import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import type { Bar } from '../../lib/candleScale';
import { placeFills, type Fill } from '../../lib/fillPlacement';
import { replayFrame } from '../../lib/tradeReplay';
import { resolvedStopLines } from '../../lib/stopSummary';
import { shortDay } from '../../lib/chartDates';
import { formatMoney } from '../format';
import {
  clampToPlot,
  placeAnnotations,
  resolveOverlaps,
  type Annotation,
} from '../../lib/annotationLayout';
import {
  CALLOUT_GAP_PX,
  CALLOUT_H,
  CALLOUT_W,
  type Callout,
} from './CalloutOverlay';
import type { StopLevel } from '../TradeChart';

/**
 * Callout geometry, in the units `annotationLayout` works in.
 *
 * windowBars is the AREA whose candles a label must clear. Five either side
 * is about the width of a callout box plus its connector at this chart's
 * density, so a label that clears them clears everything it can cover.
 */
const LAYOUT = { windowBars: 5, labelBars: 6 } as const;

const UP = '#22c55e';
const DOWN = '#f43f5e';
const AMBER = '#f59e0b';

interface CalloutSpec {
  annotation: Annotation;
  title: string;
  /** The fill's real date, shown on the label. Empty for a stop, which has none. */
  date: string;
  color: string;
}

/**
 * Which two levels get called out. Deliberately only two: a chart annotated
 * with everything annotates nothing.
 *
 * Entry always. Then the exit if the trade is closed — what actually happened
 * beats what was planned — and otherwise the stop, which is the live decision
 * on an open position.
 */
function calloutAnnotations(
  entry: { index: number; price: number; date: string } | null,
  exit: { index: number; price: number; date: string } | null,
  stopPrice: number | null,
  lastIndex: number,
): CalloutSpec[] {
  const out: CalloutSpec[] = [];
  if (entry) {
    out.push({
      annotation: { index: entry.index, price: entry.price },
      title: 'ENTRY',
      date: shortDay(entry.date),
      color: UP,
    });
  }
  if (exit) {
    out.push({
      annotation: { index: exit.index, price: exit.price },
      title: 'EXIT',
      date: shortDay(exit.date),
      color: DOWN,
    });
  } else if (stopPrice !== null) {
    // A stop is a standing level, not an event, so it has no date to name.
    out.push({
      annotation: { index: lastIndex, price: stopPrice },
      title: 'STOP',
      date: '',
      color: AMBER,
    });
  }
  return out;
}

/**
 * Where the callouts sit, kept in step with a chart that moves underneath
 * them.
 *
 * Extracted because this is the code with the worst record in the repo: it
 * shipped invisible three times in one evening, and each cause was different
 * — a label price off the scale, coordinates requested a frame too early, and
 * an overlay painting under the library's canvases. It is worth reading on
 * its own rather than as 150 lines in the middle of chart setup.
 */
export function useCallouts({
  containerRef,
  chartRef,
  seriesRef,
  bars,
  fills,
  stopLevels,
  step,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  chartRef: RefObject<IChartApi | null>;
  seriesRef: RefObject<ISeriesApi<'Candlestick'> | null>;
  bars: Bar[];
  fills: Fill[];
  stopLevels: StopLevel[];
  step: number;
}): Callout[] {
  const [callouts, setCallouts] = useState<Callout[]>([]);

  const syncCallouts = useCallback((): boolean => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return false;

    const { candleBars: cb, placed: pf } = placeFills(bars, fills);
    if (cb.length === 0) {
      setCallouts([]);
      return true; // Nothing to draw is a finished answer, not a failure.
    }

    // Only what the replay has revealed, so a callout never announces an
    // exit before the bar it happened on has been drawn.
    const frame = replayFrame(
      cb.map((b) => b.date),
      pf.map((p) => p.markerBar.date),
      step,
    );
    const revealed = new Set(frame.visibleFillIndices);
    const shown = pf.filter((_, i) => revealed.has(i));

    const opening = shown.find((p) => p.fill.side === 'BUY') ?? shown[0] ?? null;
    const closing = [...shown].reverse().find((p) => p.fill.side === 'SELL') ?? null;
    const indexOf = (date: string) => cb.findIndex((b) => b.date === date);

    // `index` is where it is DRAWN (markerBar, which relocation may move);
    // `date` is when it actually happened. Keeping them separate is the
    // whole point — the label names the second, never the first.
    const entry = opening
      ? {
          index: indexOf(opening.markerBar.date),
          price: opening.fill.price,
          date: opening.fill.executedAt.slice(0, 10),
        }
      : null;
    const exit = closing
      ? {
          index: indexOf(closing.markerBar.date),
          price: closing.fill.price,
          date: closing.fill.executedAt.slice(0, 10),
        }
      : null;
    const stops = resolvedStopLines(stopLevels);
    const stopPrice = frame.stopLinesVisible && stops.length > 0 ? stops[0].price : null;

    const wanted = calloutAnnotations(entry, exit, stopPrice, cb.length - 1);
    if (wanted.length === 0) {
      setCallouts([]);
      return true;
    }

    const placements = placeAnnotations(
      cb.map((b) => ({ high: b.high, low: b.low })),
      wanted.map((w) => w.annotation),
      LAYOUT,
    );

    const container = containerRef.current;
    /**
     * The PLOT, not the container.
     *
     * The container includes the price-scale gutter on the right and the time
     * axis along the bottom. Clamping to it let a callout slide over the price
     * labels — the STOP box on an open trade sits at the last bar by
     * definition, so it landed squarely on top of the axis and hid the very
     * numbers it was quoting.
     */
    const priceScaleWidth = chart.priceScale('right').width();
    const timeScaleHeight = chart.timeScale().height();
    const width = (container?.clientWidth ?? 0) - priceScaleWidth;
    const height = (container?.clientHeight ?? 0) - timeScaleHeight;

    const raw: (Callout & { side: 'above' | 'below'; width: number; height: number })[] = [];
    placements.forEach((pl, i) => {
      const boxTime = cb[pl.index]?.date;
      const tipTime = cb[pl.index]?.date;
      if (!boxTime || !tipTime) return;

      const x = chart.timeScale().timeToCoordinate(boxTime as Time);
      const tx = chart.timeScale().timeToCoordinate(tipTime as Time);
      // Both of these are real traded prices, so the scale can always place
      // them — unlike the label price the first version tried to convert,
      // which sat beyond the top of the range and came back null every time.
      const yClear = series.priceToCoordinate(pl.clearancePrice);
      const ty = series.priceToCoordinate(pl.price);
      if (x === null || tx === null || yClear === null || ty === null) return;

      // The gap is pixels, not dollars: the same fraction of the price range
      // is a comfortable gap on a quiet stock and a mile on a volatile one.
      const offset = CALLOUT_GAP_PX + CALLOUT_H / 2;
      const y = pl.side === 'above' ? yClear - offset : yClear + offset;

      raw.push({
        key: `${wanted[i].title}-${pl.index}`,
        title: wanted[i].title,
        date: wanted[i].date,
        price: formatMoney(pl.price),
        color: wanted[i].color,
        // Clamped into the plot rather than dropped. A callout pushed out of
        // view by a pan is still worth showing at the edge it left through —
        // silently rendering nothing is how the first version looked broken.
        // A wider pad than the default: flush against the gutter is legal but
        // reads as if the box is falling off the chart.
        boxX: clampToPlot(x, CALLOUT_W, width, 8),
        boxY: clampToPlot(y, CALLOUT_H, height, 8),
        tipX: tx,
        tipY: ty,
        side: pl.side,
        width: CALLOUT_W,
        height: CALLOUT_H,
      });
    });

    // Two callouts can still land on each other once converted; separating
    // them is only decidable in pixels.
    const spaced = resolveOverlaps(
      raw.map((r) => ({ ...r, x: r.boxX, y: r.boxY })),
    ).map((r) => ({
      ...r,
      boxX: r.x,
      boxY: clampToPlot(r.y, CALLOUT_H, height, 8),
    }));

    setCallouts(
      spaced.map(({ key, title, date, price, color, boxX, boxY, tipX, tipY }) => ({
        key,
        title,
        date,
        price,
        color,
        boxX,
        boxY,
        tipX,
        tipY,
      })),
    );

    /**
     * Done only when EVERY callout was placed, not merely one of them.
     *
     * Coordinates come good a frame apart, so a sync can resolve the exit and
     * not the entry. Treating that as finished stops the retry and leaves one
     * callout missing for good — a subtler version of the same silent failure
     * this whole path has already produced twice.
     */
    return raw.length === placements.length;
  }, [bars, fills, stopLevels, step, chartRef, seriesRef, containerRef]);

  // The three things that move the plot. Without the first two the boxes
  // drift off their candles the moment the owner pans or rotates the phone,
  // which is exactly the objection that got a DOM overlay rejected before.
  useEffect(() => {
    const chart = chartRef.current;
    const container = containerRef.current;

    /**
     * Retry until the chart can actually place a coordinate.
     *
     * `setData` and the visible-range call happen in the drawing effect, one
     * commit earlier, but the library lays out its scales on the next frame —
     * so the first attempt asks for coordinates that do not exist yet and
     * gets null for all of them. That alone would be survivable; what made it
     * fatal is that nothing retried. The visible-range event that would have
     * re-run this fires BEFORE this effect subscribes, so a single failed
     * first attempt left the callouts empty forever, which is exactly what
     * showed on the device: correct price lines, no labels.
     *
     * Bounded, and it stops as soon as one attempt succeeds.
     */
    let frame = 0;
    let attempts = 0;
    const attempt = () => {
      if (syncCallouts()) return;
      if (attempts++ < 12) frame = requestAnimationFrame(attempt);
    };
    attempt();

    if (!chart || !container) return () => cancelAnimationFrame(frame);

    const handler = () => syncCallouts();
    chart.timeScale().subscribeVisibleTimeRangeChange(handler);
    // Panning and zooming move the logical range without necessarily
    // changing the time range at the edges, so both are watched.
    chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
    const observer = new ResizeObserver(handler);
    observer.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      chart.timeScale().unsubscribeVisibleTimeRangeChange(handler);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
      observer.disconnect();
    };
  }, [syncCallouts, chartRef, containerRef]);

  return callouts;
}
