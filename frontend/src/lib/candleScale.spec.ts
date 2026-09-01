import { describe, expect, it } from 'vitest';
import { backfillIndexForPrice, indexForDate, type Bar } from './candleScale';

describe('indexForDate', () => {
  const window: Bar[] = [
    { date: '2026-08-27', open: 10, high: 12, low: 9, close: 11 },
    { date: '2026-08-28', open: 11, high: 15, low: 10, close: 14 },
    { date: '2026-08-31', open: 14, high: 16, low: 13, close: 15 },
  ];

  it('matches a fill on a trading day exactly', () => {
    expect(indexForDate(window, '2026-08-28T14:30:00.000Z')).toBe(1);
  });

  it('snaps a non-trading-day fill backward to the last trading day before it', () => {
    // 2026-08-30 is a Sunday. The last trading day at or before it is
    // Friday 2026-08-28, not the following Monday — an exit must never land
    // on a session after the owner was already out of the trade.
    expect(indexForDate(window, '2026-08-30T00:00:00.000Z')).toBe(1);
  });

  it('falls back to the first bar when the fill predates the whole window', () => {
    expect(indexForDate(window, '2026-08-01T00:00:00.000Z')).toBe(0);
  });

  it('returns -1 when there are no bars at all', () => {
    expect(indexForDate([], '2026-08-28T00:00:00.000Z')).toBe(-1);
  });
});

describe('backfillIndexForPrice', () => {
  const bars: Bar[] = [
    // Contains 13.29 — the bar a seeded BITX entry should really point to.
    { date: '2026-07-10', open: 13.0, high: 13.5, low: 12.9, close: 13.3 },
    // Does not contain 13.29 — sits between the two bars above and below.
    { date: '2026-07-20', open: 14.0, high: 14.5, low: 13.8, close: 14.2 },
    // The fill's own recorded bar: 13.29 is nowhere near its range, which
    // is exactly why the fill is out of range in the first place.
    { date: '2026-08-28', open: 17.0, high: 18.42, low: 17.03, close: 17.32 },
  ];

  it('finds the most recent earlier bar whose range contains the price', () => {
    // Searching backward from the recorded bar (index 2): the 07-20 bar
    // (index 1) does not contain 13.29, but the 07-10 bar (index 0) does.
    expect(backfillIndexForPrice(bars, 2, 13.29)).toBe(0);
  });

  it('returns -1 when no earlier bar contains the price', () => {
    expect(backfillIndexForPrice(bars, 2, 100)).toBe(-1);
  });

  it('ignores the fill’s own bar and anything at or after it', () => {
    // 17.2 is well inside the recorded bar's own range, but a search that
    // starts strictly before it must not "find" it there.
    expect(backfillIndexForPrice(bars, 2, 17.2)).toBe(-1);
  });

  it('leaves an in-range fill’s price alone: nothing to search for', () => {
    // Not a call this component ever makes for an in-range fill (only
    // outOfRange fills trigger a backward search — see TradeChart), but
    // the function itself is agnostic: searching from index 0 has no
    // earlier bars to search at all.
    expect(backfillIndexForPrice(bars, 0, 13.3)).toBe(-1);
  });
});
