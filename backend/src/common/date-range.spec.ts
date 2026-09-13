import { describe, expect, it } from 'vitest';
import { rangeStartDate } from './date-range.js';

describe('rangeStartDate', () => {
  it('returns the earliest date unchanged for ALL', () => {
    expect(rangeStartDate('ALL', '2026-09-13', '2020-01-01')).toBe('2020-01-01');
  });

  it('goes back 7 calendar days for 1W', () => {
    expect(rangeStartDate('1W', '2026-09-13', '2020-01-01')).toBe('2026-09-06');
  });

  it('goes back 1 month for 1M', () => {
    expect(rangeStartDate('1M', '2026-09-13', '2020-01-01')).toBe('2026-08-13');
  });

  it('goes back 6 months for 6M', () => {
    expect(rangeStartDate('6M', '2026-09-13', '2020-01-01')).toBe('2026-03-13');
  });

  it('goes back 12 months for 1Y', () => {
    expect(rangeStartDate('1Y', '2026-09-13', '2020-01-01')).toBe('2025-09-13');
  });

  it('returns January 1st of the anchor year for YTD', () => {
    expect(rangeStartDate('YTD', '2026-09-13', '2020-01-01')).toBe('2026-01-01');
  });
});
