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

  it('snaps a non-trading-day fill to the nearest bar', () => {
    // 2026-08-30 is a Sunday: 2 days after the Friday bar, 1 day before the
    // Monday bar — the nearer one wins.
    expect(indexForDate(window, '2026-08-30T00:00:00.000Z')).toBe(2);
  });

  it('breaks a tie by snapping to the earlier bar', () => {
    const tieWindow: Bar[] = [
      { date: '2026-08-27', open: 10, high: 12, low: 9, close: 11 },
      { date: '2026-08-29', open: 11, high: 15, low: 10, close: 14 },
    ];
    // 2026-08-28 sits exactly one day from each neighbour.
    expect(indexForDate(tieWindow, '2026-08-28T00:00:00.000Z')).toBe(0);
  });

  it('returns -1 when there are no bars at all', () => {
    expect(indexForDate([], '2026-08-28T00:00:00.000Z')).toBe(-1);
  });
});
