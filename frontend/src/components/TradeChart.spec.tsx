// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

/**
 * A stand-in for `lightweight-charts`.
 *
 * The callouts failed twice in a row in ways no existing test could see: the
 * layout was correct, the component was correct, and the coordinates came
 * back null — once because the price asked for was off the scale, once
 * because the scale had not been laid out yet. Both are failures of the
 * WIRING between the layout and the library, which is exactly the seam a pure
 * layout test cannot reach and a real browser is needed to reach otherwise.
 *
 * `coordinate` is what the fake returns from both conversions; setting it to
 * null reproduces "the chart cannot place this yet".
 */
const state = {
  coordinate: 100 as number | null,
  /** Calls before coordinates start resolving — simulates layout lag. */
  nullFirstCalls: 0,
  calls: 0,
};

vi.mock('lightweight-charts', () => {
  const timeScale = {
    fitContent: vi.fn(),
    setVisibleLogicalRange: vi.fn(),
    subscribeVisibleTimeRangeChange: vi.fn(),
    unsubscribeVisibleTimeRangeChange: vi.fn(),
    subscribeVisibleLogicalRangeChange: vi.fn(),
    unsubscribeVisibleLogicalRangeChange: vi.fn(),
    timeToCoordinate: () => {
      state.calls += 1;
      return state.calls <= state.nullFirstCalls ? null : state.coordinate;
    },
    // The gutters the callouts must stay clear of. Real values, so a box
    // clamped to the container rather than the plot shows up as a failure.
    height: () => 26,
  };
  const series = {
    setData: vi.fn(),
    createPriceLine: vi.fn(() => ({})),
    removePriceLine: vi.fn(),
    priceToCoordinate: () =>
      state.calls <= state.nullFirstCalls ? null : state.coordinate,
  };
  return {
    CandlestickSeries: 'candles',
    ColorType: { Solid: 'solid' },
    CrosshairMode: { Normal: 0 },
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2 },
    createChart: vi.fn(() => ({
      addSeries: vi.fn(() => series),
      timeScale: () => timeScale,
      priceScale: () => ({ width: () => 54 }),
      applyOptions: vi.fn(),
      remove: vi.fn(),
    })),
    createSeriesMarkers: vi.fn(() => ({ setMarkers: vi.fn() })),
  };
});

import { TradeChart } from './TradeChart';
import { shortDay } from '../lib/chartDates';

const bars = Array.from({ length: 25 }, (_, i) => ({
  date: `2026-08-${String(i + 1).padStart(2, '0')}`,
  open: 40,
  high: 42 + (i % 3),
  low: 38 - (i % 3),
  close: 41,
}));

const fills = [
  { side: 'BUY' as const, quantity: 300, price: 40.55, executedAt: '2026-08-06T14:30:00.000Z' },
  { side: 'SELL' as const, quantity: 300, price: 36.5, executedAt: '2026-08-20T14:30:00.000Z' },
];

beforeEach(() => {
  state.coordinate = 100;
  state.nullFirstCalls = 0;
  state.calls = 0;
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
});
afterEach(cleanup);

describe('TradeChart callouts', () => {
  it('labels the entry and the exit with their prices', async () => {
    render(<TradeChart bars={bars} fills={fills} stopLevels={[]} />);
    expect(await screen.findByText('ENTRY')).toBeInTheDocument();
    expect(await screen.findByText('EXIT')).toBeInTheDocument();
    expect(screen.getByText('$40.55')).toBeInTheDocument();
    expect(screen.getByText('$36.50')).toBeInTheDocument();
  });

  /**
   * The second bug, pinned. The library lays out its scales a frame after
   * setData, so the first attempt gets null for every coordinate. Nothing
   * retried, so the callouts stayed empty forever — correct price lines, no
   * labels, which is exactly what the device showed.
   */
  it('keeps trying until the chart can place a coordinate', async () => {
    state.nullFirstCalls = 6;
    render(<TradeChart bars={bars} fills={fills} stopLevels={[]} />);
    await waitFor(() => expect(screen.getByText('ENTRY')).toBeInTheDocument(), {
      timeout: 2000,
    });
  });

  /** It must give up rather than spin forever against a chart that never resolves. */
  it('stops retrying when coordinates never resolve', async () => {
    state.nullFirstCalls = Number.MAX_SAFE_INTEGER;
    render(<TradeChart bars={bars} fills={fills} stopLevels={[]} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(screen.queryByText('ENTRY')).not.toBeInTheDocument();
  });

  it('names the date each fill actually happened on', async () => {
    render(<TradeChart bars={bars} fills={fills} stopLevels={[]} />);
    expect(await screen.findByText('Aug 6')).toBeInTheDocument();
    expect(await screen.findByText('Aug 20')).toBeInTheDocument();
  });

  /**
   * The bug the owner caught by reading a date off the chart and doubting it.
   *
   * Today's bar is still being written, so a real fill can sit outside its
   * range — ORCL sold at 151.29 while the stored Sep 11 bar read
   * 154.37–165.99. That used to be read as the signature of a seeded fill,
   * and the exit was relocated back to Sep 3, whose range happened to contain
   * the price. The chart asserted an exit eight days before it happened.
   */
  it('does not relocate a fill that sits outside the still-forming last bar', async () => {
    const lastDay = bars[bars.length - 1].date;
    const belowTheDayLow = bars[bars.length - 1].low - 5;
    render(
      <TradeChart
        bars={bars}
        fills={[
          fills[0],
          {
            side: 'SELL',
            quantity: 300,
            price: belowTheDayLow,
            executedAt: `${lastDay}T20:00:00.000Z`,
          },
        ]}
        stopLevels={[]}
      />,
    );
    // Labelled with its own day, not dragged back to an earlier one.
    expect(await screen.findByText(shortDay(lastDay))).toBeInTheDocument();
  });

  it('draws no callouts for a trade with no fills at all', async () => {
    render(<TradeChart bars={bars} fills={[]} stopLevels={[]} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(screen.queryByText('ENTRY')).not.toBeInTheDocument();
  });
});
