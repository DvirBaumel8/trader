import { describe, expect, it } from 'vitest';
import {
  catchUpFrom,
  isHistoryBehind,
  lastExpectedSession,
  marketDate,
} from './trading-day.js';

/** 2026-09-04 is a Friday; 2026-09-05 a Saturday; 2026-09-07 a Monday. */
const at = (iso: string) => new Date(iso);

describe('marketDate', () => {
  it('uses the exchange calendar, not the machine clock', () => {
    // 01:30 UTC on the 5th is still the evening of the 4th in New York, and a
    // bar belongs to the session it traded in.
    expect(marketDate(at('2026-09-05T01:30:00Z'))).toBe('2026-09-04');
    expect(marketDate(at('2026-09-04T14:30:00Z'))).toBe('2026-09-04');
  });
});

describe('lastExpectedSession', () => {
  it('is today when today is a weekday', () => {
    // During the session Yahoo already serves a partial bar for today, and
    // that bar carries today's high — which is exactly what a trailing stop
    // needs. Waiting for the close would leave the stop a day behind.
    expect(lastExpectedSession(at('2026-09-04T14:30:00Z'))).toBe('2026-09-04');
  });

  it('steps back over the weekend', () => {
    expect(lastExpectedSession(at('2026-09-05T16:00:00Z'))).toBe('2026-09-04');
    expect(lastExpectedSession(at('2026-09-06T16:00:00Z'))).toBe('2026-09-04');
  });

  it('steps back to Friday from Monday before the open', () => {
    // 08:00 UTC Monday is 04:00 in New York — the session has not started, but
    // asking for it is harmless: the fetch simply returns nothing new.
    expect(lastExpectedSession(at('2026-09-07T08:00:00Z'))).toBe('2026-09-07');
  });
});

describe('isHistoryBehind', () => {
  it('is behind when the newest stored bar predates the last session', () => {
    // The real failure: every instrument sat at 2026-09-02 while the market
    // had traded on the 3rd and 4th, so trailing stops resolved from a
    // high-water mark two days old and read below the broker's.
    expect(isHistoryBehind('2026-09-02', at('2026-09-04T14:30:00Z'))).toBe(true);
  });

  /**
   * Changed meaning deliberately, and this is the bug it now pins.
   *
   * Today's bar is provisional — Yahoo revises it all session. Treating its
   * existence as "up to date" froze it at whatever it held on the first fetch
   * of the day. ORCL's Sep 11 bar stayed 154.37–165.99 while the owner sold
   * at 151.29; the trade chart then saw a fill outside its own day's range,
   * concluded it must be a seeded fill, and redrew the exit on Sep 3.
   */
  it('is behind when the only bar for today is the one still being written', () => {
    expect(isHistoryBehind('2026-09-04', at('2026-09-04T14:30:00Z'))).toBe(true);
  });

  it('is behind when there is no history at all', () => {
    expect(isHistoryBehind(null, at('2026-09-04T14:30:00Z'))).toBe(true);
  });

  it('handles a Date, which is what the database driver actually returns', () => {
    // The bug that made the first version of this a no-op: node-postgres
    // parses DATE columns into JS dates, so a raw MAX(date) is not a string.
    // Compared as strings that reads "Wed Sep 02 2026…" < "2026-09-04",
    // which is false, so the history never refreshed.
    const stored = new Date('2026-09-02T04:00:00Z'); // midnight in New York
    expect(isHistoryBehind(stored, at('2026-09-04T14:30:00Z'))).toBe(true);
    // Today's bar, as a Date: provisional, so still worth re-fetching.
    expect(
      isHistoryBehind(new Date('2026-09-04T04:00:00Z'), at('2026-09-04T14:30:00Z')),
    ).toBe(true);
  });

  /**
   * The weekend is why "provisional" is tested against TODAY rather than
   * against the last expected session. Friday's bar is finished once Friday
   * is over; re-fetching it every ten minutes all weekend would be waste.
   */
  it('is not behind on a Sunday holding Friday data', () => {
    expect(isHistoryBehind('2026-09-04', at('2026-09-06T16:00:00Z'))).toBe(false);
  });

  it('is not behind on a Saturday holding Friday data either', () => {
    expect(isHistoryBehind('2026-09-04', at('2026-09-05T16:00:00Z'))).toBe(false);
  });
});

describe('catchUpFrom', () => {
  const now = new Date('2026-09-18T15:00:00Z');
  const opts = { overlapDays: 7, runwayDays: 500 };
  const daysBefore = (d: Date) =>
    Math.round((now.getTime() - d.getTime()) / 86_400_000);

  /**
   * The bug, and then the same bug one level down.
   *
   * A fixed seven-day window meant a history more than a week behind could
   * never catch up: every top-up reached back exactly seven days, so an
   * older gap stayed forever. Deriving the window from the newest bar fixed
   * it — but only from the GLOBAL newest, so one instrument lagging while
   * the rest were current was still never repaired. This answers the
   * question per instrument, which is the only level at which it is true.
   */
  it('reaches back past a single instrument that has fallen far behind', () => {
    const from = catchUpFrom('2026-08-01', now, opts);
    expect(daysBefore(from)).toBeGreaterThan(40);
  });

  it('asks for about a week when that instrument is current', () => {
    const from = catchUpFrom('2026-09-17', now, opts);
    expect(daysBefore(from)).toBeLessThanOrEqual(9);
    expect(daysBefore(from)).toBeGreaterThanOrEqual(7);
  });

  /** No bars at all: fetch the full runway, or the long averages stay null. */
  it('fetches the whole runway for an instrument with no history', () => {
    const from = catchUpFrom(null, now, opts);
    expect(daysBefore(from)).toBe(500);
  });

  /**
   * node-postgres parses DATE columns into JS Dates, so a grouped MAX(date)
   * does not hand back a string. The same trap that once made
   * isHistoryBehind a silent no-op.
   */
  it('accepts a Date, which is what a grouped query actually returns', () => {
    const from = catchUpFrom(new Date('2026-08-01T04:00:00Z'), now, opts);
    expect(daysBefore(from)).toBeGreaterThan(40);
  });

  /** A bar dated in the future must not push the window forward. */
  it('never starts later than the ordinary overlap', () => {
    const from = catchUpFrom('2026-12-01', now, opts);
    expect(daysBefore(from)).toBe(7);
  });
});
