import { describe, expect, it } from 'vitest';
import { placeFills, type Fill } from './fillPlacement';
import type { Bar } from './candleScale';

const bar = (date: string, low: number, high: number): Bar => ({
  date,
  open: (low + high) / 2,
  high,
  low,
  close: (low + high) / 2,
});

const fill = (executedAt: string, price: number, side: 'BUY' | 'SELL' = 'SELL'): Fill => ({
  executedAt,
  side,
  price,
  quantity: 100,
  fee: 0,
});

const bars: Bar[] = [
  bar('2026-09-01', 140, 150),
  bar('2026-09-02', 145, 155),
  bar('2026-09-03', 146, 157), // the only bar whose range contains 151
  bar('2026-09-04', 158, 166),
  bar('2026-09-07', 160, 170),
  bar('2026-09-08', 154, 166), // newest
];

describe('placeFills', () => {
  it('draws a fill on its own day when that day traded at the price', () => {
    const { placed } = placeFills(bars, [fill('2026-09-04T14:30:00Z', 160)]);
    expect(placed[0].markerBar.date).toBe('2026-09-04');
    expect(placed[0].relocated).toBe(false);
  });

  /** A weekend fill has no session of its own; it borrows the last one open. */
  it('snaps a weekend fill backward to the session that was open', () => {
    // 2026-09-05 is a Saturday.
    const { placed } = placeFills(bars, [fill('2026-09-05T14:30:00Z', 160)]);
    expect(placed[0].markerBar.date).toBe('2026-09-04');
    expect(placed[0].snapped).toBe(true);
  });

  /**
   * The seeded-entry case relocation exists for: a fill stamped with the seed
   * date and an average cost no single day traded at.
   */
  it('relocates a fill whose price its own day never traded at', () => {
    const { placed } = placeFills(bars, [fill('2026-09-07T14:30:00Z', 151)]);
    expect(placed[0].relocated).toBe(true);
    expect(placed[0].markerBar.date).toBe('2026-09-03');
  });

  /**
   * The bug the owner caught by reading a date off the chart and doubting it.
   *
   * Today's bar is still being written, so a real fill can sit outside its
   * range — ORCL sold at 151.29 while the stored bar read 154.37-165.99. That
   * was read as the signature of a seeded fill and the exit was redrawn eight
   * days earlier, on a day whose range happened to contain the price.
   */
  it('never relocates a fill on the newest bar, which is still forming', () => {
    const { placed } = placeFills(bars, [fill('2026-09-08T20:00:00Z', 151)]);
    expect(placed[0].relocated).toBe(false);
    expect(placed[0].markerBar.date).toBe('2026-09-08');
  });

  it('skips days with no OHLC rather than inventing a candle', () => {
    const withGap: Bar[] = [
      ...bars,
      { date: '2026-09-09', open: null, high: null, low: null, close: 160 },
    ];
    const { candleBars } = placeFills(withGap, []);
    expect(candleBars.map((b) => b.date)).not.toContain('2026-09-09');
  });

  it('drops a fill that predates every bar it could be drawn on', () => {
    const { placed } = placeFills([], [fill('2026-09-04T14:30:00Z', 160)]);
    expect(placed).toEqual([]);
  });
});
