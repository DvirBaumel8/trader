import { describe, expect, it } from 'vitest';
import { daysUntilEarnings, parseEarningsDate } from './earnings.js';

describe('earnings date helpers', () => {
  it('maps a Yahoo raw timestamp to a UTC calendar date', () => {
    expect(parseEarningsDate({ raw: 1790377200 })).toBe('2026-09-25');
  });

  it('returns calendar days until the event, including today as zero', () => {
    expect(daysUntilEarnings('2026-09-18', '2026-09-15')).toBe(3);
    expect(daysUntilEarnings('2026-09-15', '2026-09-15')).toBe(0);
    expect(daysUntilEarnings('2026-09-14', '2026-09-15')).toBeNull();
  });
});
