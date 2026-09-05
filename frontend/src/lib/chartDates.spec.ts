import { describe, expect, it } from 'vitest';
import { longDay, shortDay } from './chartDates';

describe('chart date labels', () => {
  it('keeps the calendar date the server sent, regardless of timezone', () => {
    // What must hold is the DAY: read as a local instant, 2026-09-04 becomes
    // the 3rd for anyone west of Greenwich, and the chart would name the
    // wrong day under the finger.
    expect(shortDay('2026-09-04')).toMatch(/\b4\b/);
    expect(shortDay('2026-09-04')).not.toMatch(/\b3\b/);
    expect(longDay('2026-09-04')).toMatch(/2026/);
  });

  it('names the month in English whatever the device is set to', () => {
    // The rest of the app pins en-US for every money value; dates used to
    // pass no locale at all and follow the device, which put Hebrew month
    // abbreviations under an otherwise English chart on the owner's phone.
    // Asserted as exact strings so the format is pinned, not just the
    // language — these are the two shapes the doc comments promise.
    expect(shortDay('2026-09-04')).toBe('Sep 4');
    expect(longDay('2026-09-04')).toBe('Sep 4, 2026');
    expect(shortDay('2026-08-11')).toBe('Aug 11');
  });

  it('carries the year only where there is room for it', () => {
    // The axis ends sit side by side and the year is obvious from context;
    // the point under the finger is worth naming in full.
    expect(shortDay('2026-01-02')).not.toContain('2026');
    expect(longDay('2026-01-02')).toContain('2026');
  });

  it('is empty rather than "Invalid Date" when there is no point', () => {
    expect(shortDay(undefined)).toBe('');
    expect(longDay(undefined)).toBe('');
  });
});
