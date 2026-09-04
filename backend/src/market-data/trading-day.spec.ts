import { describe, expect, it } from 'vitest';
import { isHistoryBehind, lastExpectedSession, marketDate } from './trading-day.js';

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

  it('is not behind when today already has a bar', () => {
    expect(isHistoryBehind('2026-09-04', at('2026-09-04T14:30:00Z'))).toBe(false);
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
    expect(
      isHistoryBehind(new Date('2026-09-04T04:00:00Z'), at('2026-09-04T14:30:00Z')),
    ).toBe(false);
  });

  it('is not behind on a Sunday holding Friday data', () => {
    expect(isHistoryBehind('2026-09-04', at('2026-09-06T16:00:00Z'))).toBe(false);
  });
});
