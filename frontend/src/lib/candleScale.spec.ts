import { describe, expect, it } from 'vitest';
import { indexForDate, type Bar } from './candleScale';

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
