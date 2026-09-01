import { describe, expect, it } from 'vitest';
import { parseTradeId, tradeId, windowBounds } from './trade-window.js';

describe('tradeId', () => {
  it('round-trips a symbol and entry timestamp', () => {
    const id = tradeId('AAPL', new Date('2026-08-28T13:30:00.000Z'));
    expect(id).toBe('AAPL:2026-08-28T13:30:00.000Z');
    expect(parseTradeId(id)).toEqual({
      symbol: 'AAPL',
      enteredAt: '2026-08-28T13:30:00.000Z',
    });
  });

  it('rejects a malformed id rather than guessing', () => {
    expect(parseTradeId('AAPL')).toBeNull();
    expect(parseTradeId('')).toBeNull();
    expect(parseTradeId(':2026-08-28T13:30:00.000Z')).toBeNull();
    expect(parseTradeId('AAPL:not-a-date')).toBeNull();
  });

  it('survives a symbol round trip through URL encoding', () => {
    const id = tradeId('BRK.B', new Date('2026-08-28T13:30:00.000Z'));
    expect(
      parseTradeId(decodeURIComponent(encodeURIComponent(id)))?.symbol,
    ).toBe('BRK.B');
  });
});

describe('windowBounds', () => {
  it('pads about a month of trading days either side of a closed trade', () => {
    const { fromDate, toDate } = windowBounds(
      new Date('2026-08-28T13:30:00.000Z'),
      new Date('2026-09-04T13:30:00.000Z'),
    );
    // 21 trading days is ~29-31 calendar days once weekends are included.
    expect(fromDate < '2026-08-01').toBe(true);
    expect(fromDate > '2026-07-20').toBe(true);
    expect(toDate! > '2026-10-01').toBe(true);
    expect(toDate! < '2026-10-10').toBe(true);
  });

  it('leaves an open trade unbounded at the right edge', () => {
    const { toDate } = windowBounds(new Date('2026-08-28T13:30:00.000Z'), null);
    expect(toDate).toBeNull();
  });
});
