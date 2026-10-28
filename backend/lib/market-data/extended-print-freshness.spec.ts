import { describe, expect, it } from 'vitest';
import { isExtendedPrintFresh } from './extended-print-freshness.js';

describe('isExtendedPrintFresh', () => {
  it('trusts any print age when the market is CLOSED — a weekend has nothing fresher', () => {
    const now = new Date('2026-09-20T12:00:00Z'); // Sunday
    const fridayPrint = new Date('2026-09-18T20:00:00Z');
    expect(isExtendedPrintFresh(now, fridayPrint, 'CLOSED')).toBe(true);
  });

  it('rejects a print from a prior trading day once the current day is live', () => {
    // Monday 04:05 ET pre-market, print still timestamped the prior Friday —
    // the exact NBIS/MSTR case: Twelve Data's free tier never refreshed it.
    const now = new Date('2026-09-21T08:05:00Z'); // 04:05 America/New_York
    const staleFridayPrint = new Date('2026-09-18T23:59:00Z');
    expect(isExtendedPrintFresh(now, staleFridayPrint, 'PRE')).toBe(false);
  });

  it('accepts a print timestamped today in the same session', () => {
    const now = new Date('2026-09-21T08:05:00Z'); // 04:05 America/New_York
    const freshPrint = new Date('2026-09-21T08:01:00Z'); // 04:01 America/New_York
    expect(isExtendedPrintFresh(now, freshPrint, 'PRE')).toBe(true);
  });

  it('accepts a POST print from earlier today', () => {
    const now = new Date('2026-09-21T22:00:00Z'); // 18:00 America/New_York
    const freshPrint = new Date('2026-09-21T21:00:00Z'); // 17:00 America/New_York
    expect(isExtendedPrintFresh(now, freshPrint, 'POST')).toBe(true);
  });

  it('rejects an OVERNIGHT print left over from two days ago', () => {
    const now = new Date('2026-09-22T03:00:00Z'); // late Monday evening ET
    const twoDaysStale = new Date('2026-09-19T21:00:00Z');
    expect(isExtendedPrintFresh(now, twoDaysStale, 'OVERNIGHT')).toBe(false);
  });
});
