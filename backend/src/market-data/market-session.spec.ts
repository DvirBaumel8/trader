import { describe, expect, it } from 'vitest';
import {
  nthWeekdayOfMonth,
  lastWeekdayOfMonth,
  easterSunday,
  observedFixedDate,
  isUsMarketHoliday,
  isEarlyCloseDay,
  computeMarketSession,
} from './market-session.js';

const at = (iso: string) => new Date(iso);

describe('nthWeekdayOfMonth', () => {
  it('finds MLK Day 2024: the 3rd Monday of January', () => {
    expect(nthWeekdayOfMonth(2024, 1, 1, 3)).toBe('2024-01-15');
  });

  it("finds Thanksgiving 2023: the 4th Thursday of November", () => {
    expect(nthWeekdayOfMonth(2023, 11, 4, 4)).toBe('2023-11-23');
  });

  it("finds Presidents' Day 2024: the 3rd Monday of February", () => {
    expect(nthWeekdayOfMonth(2024, 2, 1, 3)).toBe('2024-02-19');
  });

  it('finds Labor Day 2024: the 1st Monday of September', () => {
    expect(nthWeekdayOfMonth(2024, 9, 1, 1)).toBe('2024-09-02');
  });
});

describe('lastWeekdayOfMonth', () => {
  it('finds Memorial Day 2024: the last Monday of May', () => {
    expect(lastWeekdayOfMonth(2024, 5, 1)).toBe('2024-05-27');
  });
});

describe('easterSunday', () => {
  it('finds Easter 2024 (March 31)', () => {
    expect(easterSunday(2024)).toBe('2024-03-31');
  });

  it('finds Easter 2025 (April 20)', () => {
    expect(easterSunday(2025)).toBe('2025-04-20');
  });
});

describe('observedFixedDate', () => {
  it('leaves a weekday holiday on its own date', () => {
    // 2026-12-25 is a Friday.
    expect(observedFixedDate(2026, 12, 25)).toBe('2026-12-25');
  });

  it('shifts a Saturday holiday to the preceding Friday', () => {
    // 2027-01-01 is a Friday, so New Year's 2028... use a known Saturday
    // instead: 2022-01-01 was a Saturday, observed Friday 2021-12-31.
    expect(observedFixedDate(2022, 1, 1)).toBe('2021-12-31');
  });

  it('shifts a Sunday holiday to the following Monday', () => {
    // 2023-01-01 was a Sunday, observed Monday 2023-01-02.
    expect(observedFixedDate(2023, 1, 1)).toBe('2023-01-02');
  });
});

describe('isUsMarketHoliday', () => {
  it('is true for New Year\'s Day', () => {
    expect(isUsMarketHoliday('2026-01-01')).toBe(true);
  });

  it('is true for a computed Good Friday', () => {
    // Easter 2024 is March 31, so Good Friday is March 29.
    expect(isUsMarketHoliday('2024-03-29')).toBe(true);
  });

  it('is false for an ordinary trading day next to a holiday', () => {
    expect(isUsMarketHoliday('2026-01-02')).toBe(false);
  });

  it('observes New Year\'s Day 2023 on Monday Jan 2, since Jan 1 was a Sunday', () => {
    expect(isUsMarketHoliday('2023-01-02')).toBe(true);
  });
});

describe('isEarlyCloseDay', () => {
  it('is true the day after Thanksgiving 2023', () => {
    expect(isEarlyCloseDay('2023-11-24')).toBe(true);
  });

  it('is false on an ordinary day', () => {
    expect(isEarlyCloseDay('2023-11-22')).toBe(false);
  });
});

describe('computeMarketSession', () => {
  // 2026-09-04 is a Friday (EDT, UTC-4); 2026-01-02 is also a Friday (EST,
  // UTC-5) — 245 days / 35 weeks earlier, same weekday, opposite DST side.
  it('is REGULAR at 9:30am ET during EDT', () => {
    expect(computeMarketSession(at('2026-09-04T13:30:00Z'))).toBe('REGULAR');
  });

  it('is REGULAR at 9:30am ET during EST, proving DST is handled', () => {
    expect(computeMarketSession(at('2026-01-02T14:30:00Z'))).toBe('REGULAR');
  });

  it('is PRE before the open', () => {
    expect(computeMarketSession(at('2026-09-04T13:29:00Z'))).toBe('PRE');
  });

  it('is POST right at the close', () => {
    expect(computeMarketSession(at('2026-09-04T20:00:00Z'))).toBe('POST');
  });

  it('is OVERNIGHT right at 8pm ET', () => {
    expect(computeMarketSession(at('2026-09-05T00:00:00Z'))).toBe('OVERNIGHT');
  });

  it('is OVERNIGHT before 4am ET on a trading day', () => {
    expect(computeMarketSession(at('2026-09-04T07:00:00Z'))).toBe('OVERNIGHT');
  });

  it('is CLOSED on a Saturday, not OVERNIGHT', () => {
    expect(computeMarketSession(at('2026-09-05T14:00:00Z'))).toBe('CLOSED');
  });

  it('is CLOSED on a weekday holiday even during normal trading hours', () => {
    // 2026-01-01 is a Thursday and New Year's Day.
    expect(computeMarketSession(at('2026-01-01T15:00:00Z'))).toBe('CLOSED');
  });
});
