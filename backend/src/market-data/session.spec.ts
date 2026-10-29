import { describe, expect, it } from 'vitest';
import {
  currentSession,
  isRegularSessionOpen,
  isTradingDay,
  previousTradingDay,
  isUsMarketHoliday,
  isEarlyCloseDay,
} from './session.js';

describe('calendar', () => {
  it('knows Thanksgiving, the day after, and weekends', () => {
    expect(isUsMarketHoliday('2026-11-26')).toBe(true);
    expect(isEarlyCloseDay('2026-11-27')).toBe(true);
    expect(isTradingDay('2026-11-27')).toBe(true);
    expect(isTradingDay('2026-11-28')).toBe(false);
    expect(isTradingDay('2026-10-29')).toBe(true);
  });

  it('previousTradingDay skips weekends and holidays', () => {
    expect(previousTradingDay('2026-11-02')).toBe('2026-10-30'); // Mon -> Fri
    expect(previousTradingDay('2026-11-27')).toBe('2026-11-25'); // over Thanksgiving
  });
});

describe('isRegularSessionOpen / currentSession (EDT = UTC-4 until 2026-11-01)', () => {
  it('open at 09:30 ET, closed at 09:29 and at 16:00', () => {
    expect(isRegularSessionOpen(new Date('2026-10-29T13:30:00Z'))).toBe(true);
    expect(isRegularSessionOpen(new Date('2026-10-29T13:29:00Z'))).toBe(false);
    expect(isRegularSessionOpen(new Date('2026-10-29T19:59:00Z'))).toBe(true);
    expect(isRegularSessionOpen(new Date('2026-10-29T20:00:00Z'))).toBe(false);
  });

  it('Thu 11:00 ET is live, asOf Thu', () => {
    expect(currentSession(new Date('2026-10-29T15:00:00Z'))).toEqual({ live: true, asOf: '2026-10-29' });
  });

  it('Thu 17:00 ET (after close) is not live, asOf Thu', () => {
    expect(currentSession(new Date('2026-10-29T21:00:00Z'))).toEqual({ live: false, asOf: '2026-10-29' });
  });

  it('Fri 08:00 ET (pre-market) is not live, asOf Thu', () => {
    expect(currentSession(new Date('2026-10-30T12:00:00Z'))).toEqual({ live: false, asOf: '2026-10-29' });
  });

  it('Saturday is asOf Friday', () => {
    expect(currentSession(new Date('2026-10-31T15:00:00Z'))).toEqual({ live: false, asOf: '2026-10-30' });
  });

  it('Thanksgiving is closed, asOf Wednesday', () => {
    expect(currentSession(new Date('2026-11-26T16:00:00Z'))).toEqual({ live: false, asOf: '2026-11-25' });
  });

  it('after the 13:00 early close the next day is not live, asOf that day', () => {
    // 2026-11-27 13:30 ET (EST = UTC-5) = 18:30Z
    expect(currentSession(new Date('2026-11-27T18:30:00Z'))).toEqual({ live: false, asOf: '2026-11-27' });
    expect(currentSession(new Date('2026-11-27T17:30:00Z'))).toEqual({ live: true, asOf: '2026-11-27' });
  });
});
