import { describe, expect, it } from 'vitest';
import { bucketFees, bucketKey, totalFees } from './fee-buckets.js';

/** Dates arrive as local noon converted to UTC — see the module's doc comment. */
const on = (date: string, fee: number) => ({
  occurredAt: new Date(`${date}T12:00:00Z`),
  fee,
});

describe('bucketKey', () => {
  it('groups by day, week (from Monday), month and year', () => {
    const wed = new Date('2026-09-02T12:00:00Z');
    expect(bucketKey(wed, 'DAY')).toBe('2026-09-02');
    expect(bucketKey(wed, 'WEEK')).toBe('2026-08-31'); // the Monday
    expect(bucketKey(wed, 'MONTH')).toBe('2026-09');
    expect(bucketKey(wed, 'YEAR')).toBe('2026');
  });

  it('puts Sunday in the week that began six days earlier', () => {
    const sunday = new Date('2026-09-06T12:00:00Z');
    expect(bucketKey(sunday, 'WEEK')).toBe('2026-08-31');
  });

  it('keeps a trade on the date it was recorded, read in UTC', () => {
    // The reason noon matters: an evening trade in Israel (UTC+3) is stored
    // as 09:00Z and must not slide to the previous or next day when the
    // server buckets it.
    const evening = new Date('2026-09-04T09:00:00Z');
    expect(bucketKey(evening, 'DAY')).toBe('2026-09-04');
  });
});

describe('bucketFees', () => {
  it('totals fees per period, oldest first', () => {
    const out = bucketFees(
      [on('2026-07-01', 4), on('2026-07-15', 6), on('2026-08-03', 5)],
      'MONTH',
    );
    expect(out.map((b) => [b.key, b.total])).toEqual([
      ['2026-07', 10],
      ['2026-08', 5],
    ]);
  });

  it('fills an untraded period with zero rather than skipping it', () => {
    // A month you did not trade is information, and dropping it would put two
    // distant bars side by side as though they were consecutive.
    const out = bucketFees([on('2026-06-01', 4), on('2026-08-01', 6)], 'MONTH');
    expect(out.map((b) => b.key)).toEqual(['2026-06', '2026-07', '2026-08']);
    expect(out[1].total).toBe(0);
  });

  it('labels months in English regardless of the server locale', () => {
    // Computed on a host whose locale is not the owner's, so the name cannot
    // come from the runtime.
    const [bucket] = bucketFees([on('2026-09-01', 4)], 'MONTH');
    expect(bucket.label).toBe('Sep');
  });

  it('ignores zero and negative fees', () => {
    expect(bucketFees([on('2026-09-01', 0), on('2026-09-02', -3)], 'MONTH')).toEqual([]);
  });

  it('keeps only the most recent window', () => {
    const events = Array.from({ length: 40 }, (_, i) =>
      on(`2026-01-${String((i % 28) + 1).padStart(2, '0')}`, 1),
    );
    // 30 days is the cap for DAY.
    expect(bucketFees(events, 'DAY').length).toBeLessThanOrEqual(30);
  });

  it('is empty with no events', () => {
    expect(bucketFees([], 'MONTH')).toEqual([]);
  });
});

describe('totalFees', () => {
  it('sums positive fees only, rounded to cents', () => {
    expect(totalFees([on('2026-09-01', 4.005), on('2026-09-02', 2), on('2026-09-03', -1)])).toBe(
      6.01,
    );
  });
});
