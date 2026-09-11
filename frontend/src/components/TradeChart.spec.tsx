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
      applyOptions: vi.fn(),
      remove: vi.fn(),
    })),
    createSeriesMarkers: vi.fn(() => ({ setMarkers: vi.fn() })),
  };
});

import { TradeChart } from './TradeChart';

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

  it('draws no callouts for a trade with no fills at all', async () => {
    render(<TradeChart bars={bars} fills={[]} stopLevels={[]} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(screen.queryByText('ENTRY')).not.toBeInTheDocument();
  });
});
