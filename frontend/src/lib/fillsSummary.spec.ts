import { describe, expect, it } from 'vitest';
import { formatFillsSummary } from './fillsSummary';

describe('formatFillsSummary', () => {
  it('formats a single buy', () => {
    expect(
      formatFillsSummary([
        { executedAt: '2026-08-25T14:31:00Z', side: 'BUY', price: 13.29, quantity: 1000 },
      ]),
    ).toBe('Bought 1,000 at 13.29');
  });

  it('formats a buy and a sell, entry before exit', () => {
    expect(
      formatFillsSummary([
        { executedAt: '2026-08-27T20:00:00Z', side: 'SELL', price: 17.46, quantity: 600 },
        { executedAt: '2026-08-25T14:31:00Z', side: 'BUY', price: 13.29, quantity: 1000 },
      ]),
    ).toBe('Bought 1,000 at 13.29 · Sold 600 at 17.46');
  });

  it('orders strictly by execution time regardless of input order', () => {
    const summary = formatFillsSummary([
      { executedAt: '2026-08-26T00:00:00Z', side: 'BUY', price: 10, quantity: 100 },
      { executedAt: '2026-08-24T00:00:00Z', side: 'BUY', price: 9, quantity: 50 },
      { executedAt: '2026-08-25T00:00:00Z', side: 'SELL', price: 11, quantity: 25 },
    ]);
    expect(summary).toBe(
      'Bought 50 at 9.00 · Sold 25 at 11.00 · Bought 100 at 10.00',
    );
  });

  it('groups large share counts with commas', () => {
    expect(
      formatFillsSummary([
        { executedAt: '2026-08-25T00:00:00Z', side: 'BUY', price: 112.79, quantity: 18000 },
      ]),
    ).toBe('Bought 18,000 at 112.79');
  });

  it('always renders two decimal places on price, even for whole numbers', () => {
    expect(
      formatFillsSummary([
        { executedAt: '2026-08-25T00:00:00Z', side: 'SELL', price: 123, quantity: 1 },
      ]),
    ).toBe('Sold 1 at 123.00');
  });

  it('returns an empty string for no fills', () => {
    expect(formatFillsSummary([])).toBe('');
  });
});
