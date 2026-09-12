import { describe, expect, it } from 'vitest';
import { dayLabel } from './dayHeading';

describe('dayLabel', () => {
  // The rest of the app pins en-US for every money value and (since
  // chartDates.ts) for the benchmark chart's dates too; this heading used to
  // pass no locale at all and follow the device, which put Hebrew month
  // abbreviations under an otherwise English screen on the owner's phone.
  // Asserted as an exact string so the format is pinned, not just the
  // language.
  it('names the month in English whatever the device is set to', () => {
    expect(dayLabel('2026-01-01T12:00:00.000Z')).toBe('Jan 1, 2026');
    expect(dayLabel('2026-09-04T09:30:00.000Z')).toBe('Sep 4, 2026');
  });
});
