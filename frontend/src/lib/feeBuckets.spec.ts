import { describe, expect, it } from 'vitest';
import {
  MAX_BUCKETS,
  bucketFees,
  bucketKey,
  totalFees,
  type FeeEvent,
} from './feeBuckets';

/** Local midday, so the bucket never lands on a neighbouring day. */
const at = (y: number, m: number, d: number, fee: number): FeeEvent => ({
  occurredAt: new Date(y, m - 1, d, 12, 0).toISOString(),
  fee,
});

describe('bucketKey', () => {
  it('keys a day', () => {
    expect(bucketKey(at(2026, 8, 5, 4).occurredAt, 'DAY')).toBe('2026-08-05');
  });

  it('keys a month', () => {
    expect(bucketKey(at(2026, 8, 5, 4).occurredAt, 'MONTH')).toBe('2026-08');
  });

  it('keys a year', () => {
    expect(bucketKey(at(2026, 8, 5, 4).occurredAt, 'YEAR')).toBe('2026');
  });

  it('keys a week to its Monday', () => {
    // 2026-08-05 is a Wednesday; its week began Monday the 3rd.
    expect(bucketKey(at(2026, 8, 5, 4).occurredAt, 'WEEK')).toBe('2026-08-03');
  });

  it('puts Sunday in the week that began the previous Monday', () => {
    // The off-by-one that a naive getDay() shift gets wrong.
    expect(bucketKey(at(2026, 8, 9, 4).occurredAt, 'WEEK')).toBe('2026-08-03');
  });

  it('puts Monday in its own week', () => {
    expect(bucketKey(at(2026, 8, 10, 4).occurredAt, 'WEEK')).toBe('2026-08-10');
  });
});

describe('bucketFees', () => {
  it('is empty with no events', () => {
    expect(bucketFees([], 'MONTH')).toEqual([]);
  });

  it('is empty when every fee is zero', () => {
    expect(bucketFees([at(2026, 8, 5, 0)], 'MONTH')).toEqual([]);
  });

  it('sums fees within a period', () => {
    const b = bucketFees(
      [at(2026, 8, 5, 4), at(2026, 8, 20, 4), at(2026, 8, 25, 8)],
      'MONTH',
    );
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ key: '2026-08', total: 16 });
  });

  it('separates periods and orders oldest first', () => {
    const b = bucketFees([at(2026, 9, 5, 8), at(2026, 8, 5, 4)], 'MONTH');
    expect(b.map((x) => x.key)).toEqual(['2026-08', '2026-09']);
  });

  it('fills an empty period with zero rather than skipping it', () => {
    // Skipping September would put August and October side by side, making a
    // two-month gap look like consecutive activity.
    const b = bucketFees([at(2026, 8, 5, 4), at(2026, 10, 5, 4)], 'MONTH');
    expect(b.map((x) => x.key)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(b[1].total).toBe(0);
  });

  it('fills gaps across a year boundary', () => {
    const b = bucketFees([at(2026, 11, 5, 4), at(2027, 1, 5, 4)], 'MONTH');
    expect(b.map((x) => x.key)).toEqual(['2026-11', '2026-12', '2027-01']);
  });

  it('fills day gaps', () => {
    const b = bucketFees([at(2026, 8, 1, 4), at(2026, 8, 4, 4)], 'DAY');
    expect(b.map((x) => x.key)).toEqual([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
    ]);
  });

  it('fills week gaps in seven-day steps', () => {
    const b = bucketFees([at(2026, 8, 3, 4), at(2026, 8, 24, 4)], 'WEEK');
    expect(b.map((x) => x.key)).toEqual([
      '2026-08-03',
      '2026-08-10',
      '2026-08-17',
      '2026-08-24',
    ]);
  });

  it('keeps only the most recent window', () => {
    const events = Array.from({ length: 40 }, (_, i) =>
      at(2026, 1, 1 + i, 4),
    );
    const b = bucketFees(events, 'DAY');
    expect(b).toHaveLength(MAX_BUCKETS.DAY);
    // The window keeps the newest, not the oldest.
    expect(b[b.length - 1].key).toBe('2026-02-09');
  });

  it('ignores negative fees rather than crediting them', () => {
    const b = bucketFees([at(2026, 8, 5, 4), at(2026, 8, 6, -100)], 'MONTH');
    expect(b[0].total).toBe(4);
  });
});

describe('totalFees', () => {
  it('is zero with no events', () => {
    expect(totalFees([])).toBe(0);
  });

  it('sums every fee regardless of period', () => {
    expect(totalFees([at(2026, 1, 1, 4), at(2027, 6, 1, 8)])).toBe(12);
  });

  it('ignores zero and negative fees', () => {
    expect(totalFees([at(2026, 1, 1, 4), at(2026, 1, 2, -4)])).toBe(4);
  });
});
