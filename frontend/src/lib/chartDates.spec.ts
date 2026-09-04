import { describe, expect, it } from 'vitest';
import { longDay, shortDay } from './chartDates';

describe('chart date labels', () => {
  it('keeps the calendar date the server sent, regardless of timezone', () => {
    // Order is the VIEWER's locale to decide — unlike the server-rendered fee
    // labels, this is drawn in his browser. What must hold is the DAY: read
    // as a local instant, 2026-09-04 becomes the 3rd for anyone west of
    // Greenwich, and the chart would name the wrong day under the finger.
    expect(shortDay('2026-09-04')).toMatch(/Sep/);
    expect(shortDay('2026-09-04')).toMatch(/\b4\b/);
    expect(shortDay('2026-09-04')).not.toMatch(/\b3\b/);
    expect(longDay('2026-09-04')).toMatch(/2026/);
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
