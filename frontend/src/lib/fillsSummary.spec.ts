import { describe, expect, it } from 'vitest';
import { fillPriceLines, formatFillsSummary } from './fillsSummary';

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

describe('fillPriceLines', () => {
  const buy = (price: number, quantity = 100) => ({
    executedAt: '2026-09-01T14:30:00.000Z',
    side: 'BUY' as const,
    price,
    quantity,
  });
  const sell = (price: number, quantity = 100) => ({
    executedAt: '2026-09-02T14:30:00.000Z',
    side: 'SELL' as const,
    price,
    quantity,
  });

  it('draws one line per fill, at the price actually traded', () => {
    expect(fillPriceLines([buy(13.29), sell(17.46), sell(17.07)])).toEqual([
      { price: 13.29, side: 'BUY' },
      { price: 17.07, side: 'SELL' },
      { price: 17.46, side: 'SELL' },
    ]);
  });

  it('collapses fills that share a price into one line', () => {
    // Scaling into a position at one price is several fills but one level:
    // stacking identical lines just thickens it.
    expect(fillPriceLines([buy(13.29, 800), buy(13.29, 1000)])).toEqual([
      { price: 13.29, side: 'BUY' },
    ]);
  });

  it('is empty when nothing has been filled yet', () => {
    expect(fillPriceLines([])).toEqual([]);
  });
});
