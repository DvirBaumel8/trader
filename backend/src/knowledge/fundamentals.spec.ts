import { describe, expect, it } from 'vitest';
import { shapeFundamentals } from './fundamentals.js';
import type { RawFundamentals } from '../market-data/yahoo.client.js';
import type { QuarterEstimate } from '../market-data/alpha-vantage.client.js';

const B = 1_000_000_000;
const raw: RawFundamentals = {
  quoteType: 'EQUITY',
  currency: 'USD',
  epsQuarters: [
    { periodEnd: '2025-10-31', fiscalQuarter: '3Q2026', actual: 1.3, reportedAt: '2025-11-19T21:20:00.000Z' },
    { periodEnd: '2026-01-31', fiscalQuarter: '4Q2026', actual: 1.5, reportedAt: '2026-02-25T21:20:00.000Z' },
    { periodEnd: '2026-04-30', fiscalQuarter: '1Q2027', actual: 1.9, reportedAt: '2026-05-27T20:20:00.000Z' },
    { periodEnd: '2026-07-31', fiscalQuarter: '2Q2027', actual: 2.22, reportedAt: '2026-08-26T20:20:00.000Z' },
  ],
  cash: 62.5 * B,
  debt: 38.9 * B,
  series: [
    { periodEnd: '2025-07-31', revenue: 46.7 * B, fcf: 13 * B },
    { periodEnd: '2025-10-31', revenue: 57 * B, fcf: 22 * B },
    { periodEnd: '2026-01-31', revenue: 68 * B, fcf: 34 * B },
    { periodEnd: '2026-04-30', revenue: 80 * B, fcf: 40 * B },
    { periodEnd: '2026-07-31', revenue: 96.2 * B, fcf: 45 * B },
  ],
};
const estimates: QuarterEstimate[] = [
  { periodEnd: '2026-07-31', epsEstimate: 2.0916, revenueEstimate: 92.18 * B },
  { periodEnd: '2026-10-31', epsEstimate: 2.47, revenueEstimate: 109 * B },
  { periodEnd: '2027-01-31', epsEstimate: 2.9, revenueEstimate: 120 * B },
  { periodEnd: '2026-04-30', epsEstimate: 1.8, revenueEstimate: 80 * B },
];
const shape = (e: QuarterEstimate[] | null = estimates, r = raw) =>
  shapeFundamentals(r, e, '2026-10-29T15:00:00.000Z', '2026-10-29');

describe('shapeFundamentals', () => {
  it('lists the newest 4 quarters newest first with fiscal labels', () => {
    const out = shape();
    expect(out.quarters.map((q) => q.label)).toEqual(['Q2 FY27', 'Q1 FY27', 'Q4 FY26', 'Q3 FY26']);
    expect(out.fetchedAt).toBe('2026-10-29T15:00:00.000Z');
    expect(out.currency).toBe('USD');
    expect(out.quarters[0].reportedAt).toBe('2026-08-26T20:20:00.000Z');
  });

  it('computes surprises and YoY to one decimal, matching by calendar month', () => {
    const q = shape().quarters[0];
    expect(q.eps).toBe(2.22);
    expect(q.epsEstimate).toBe(2.0916);
    expect(q.epsSurprisePct).toBe(6.1);
    expect(q.revenue).toBe(96.2 * B);
    expect(q.revenueEstimate).toBe(92.18 * B);
    expect(q.revenueSurprisePct).toBe(4.4);
    expect(q.revenueYoY).toBe(106);
    expect(q.fcf).toBe(45 * B);
  });

  it('matches an estimate whose period end falls on another day of the month', () => {
    const q = shape([{ periodEnd: '2026-07-26', epsEstimate: 2, revenueEstimate: 90 * B }]).quarters[0];
    expect(q.epsEstimate).toBe(2);
  });

  it('leaves YoY null when the year-earlier quarter is missing', () => {
    expect(shape().quarters[3].revenueYoY).toBeNull();
  });

  it('measures a surprise against the size of a negative estimate', () => {
    const r = { ...raw, epsQuarters: [{ ...raw.epsQuarters[3], actual: -0.5 }] };
    const q = shape([{ periodEnd: '2026-07-31', epsEstimate: -1, revenueEstimate: null }], r).quarters[0];
    expect(q.epsSurprisePct).toBe(50);
    expect(q.revenueSurprisePct).toBeNull();
  });

  it('has no surprise against a zero estimate', () => {
    expect(shape([{ periodEnd: '2026-07-31', epsEstimate: 0, revenueEstimate: 0 }]).quarters[0].epsSurprisePct).toBeNull();
  });

  it('sets next to the earliest estimate after the newest reported quarter, stepping the fiscal label', () => {
    expect(shape().next).toEqual({
      label: 'Q3 FY27',
      periodEnd: '2026-10-31',
      reportAt: null,
      epsEstimate: 2.47,
      revenueEstimate: 109 * B,
    });
  });

  it('rolls the fiscal year after Q4', () => {
    const r = { ...raw, epsQuarters: [{ periodEnd: '2026-01-31', fiscalQuarter: '4Q2026', actual: 1.5, reportedAt: null }] };
    expect(shape([{ periodEnd: '2026-04-30', epsEstimate: 1, revenueEstimate: 1 }], r).next?.label).toBe('Q1 FY27');
  });

  it('labels from the period end when Yahoo gives no fiscal quarter', () => {
    const r = { ...raw, epsQuarters: [{ periodEnd: '2026-07-31', fiscalQuarter: null, actual: 2, reportedAt: null }] };
    const out = shape(estimates, r);
    expect(out.quarters[0].label).toBe('Jul 2026');
    expect(out.next?.label).toBe('Oct 2026');
  });

  it('leaves next null when no estimate is later', () => {
    expect(shape([{ periodEnd: '2026-07-31', epsEstimate: 1, revenueEstimate: 1 }]).next).toBeNull();
  });

  it('nulls every expected field when estimates are unavailable', () => {
    const out = shape(null);
    expect(out.next).toBeNull();
    for (const q of out.quarters) {
      expect(q.epsEstimate).toBeNull();
      expect(q.revenueEstimate).toBeNull();
      expect(q.epsSurprisePct).toBeNull();
      expect(q.revenueSurprisePct).toBeNull();
    }
    expect(out.quarters[0].eps).toBe(2.22);
    expect(out.quarters[0].revenue).toBe(96.2 * B);
  });

  it('computes net cash, null when either side is missing', () => {
    expect(shape().netCash).toBe(23.6 * B);
    expect(shape(null, { ...raw, debt: null }).netCash).toBeNull();
    expect(shape(null, { ...raw, cash: null }).netCash).toBeNull();
  });

  it('skips quarters with no actual yet or ending in the future', () => {
    const r = {
      ...raw,
      epsQuarters: [
        ...raw.epsQuarters,
        { periodEnd: '2026-10-31', fiscalQuarter: '3Q2027', actual: null, reportedAt: null },
        { periodEnd: '2026-11-30', fiscalQuarter: null, actual: 3, reportedAt: null },
      ],
    };
    expect(shape(estimates, r).quarters[0].label).toBe('Q2 FY27');
  });

  it('handles no quarters at all', () => {
    const out = shape(estimates, { ...raw, epsQuarters: [], series: [] });
    expect(out.quarters).toEqual([]);
    expect(out.next?.periodEnd).toBe('2026-10-31');
  });
});
