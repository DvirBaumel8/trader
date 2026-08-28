import { describe, expect, it } from 'vitest';
import { sortPositions, type SortablePosition } from './sortPositions';

function p(
  symbol: string,
  marketValue: number | null,
  unrealizedPct: number | null,
  unrealizedPnl: number | null,
): SortablePosition {
  return { symbol, marketValue, unrealizedPct, unrealizedPnl };
}

const book: SortablePosition[] = [
  p('BITX', 32165.82, 0.3446, 8243.82),
  p('APP', 15968.12, 0.0304, 470.4),
  p('AVGO', 14882.02, -0.0036, -53.18),
  p('BE', 19623.15, 0.0584, 1083.15),
];

const symbols = (list: SortablePosition[]) => list.map((x) => x.symbol);

describe('sortPositions', () => {
  it('sorts by symbol ascending', () => {
    expect(symbols(sortPositions(book, 'symbol', 'asc'))).toEqual([
      'APP',
      'AVGO',
      'BE',
      'BITX',
    ]);
  });

  it('sorts by symbol descending', () => {
    expect(symbols(sortPositions(book, 'symbol', 'desc'))).toEqual([
      'BITX',
      'BE',
      'AVGO',
      'APP',
    ]);
  });

  it('sorts by market value descending — biggest position first', () => {
    expect(symbols(sortPositions(book, 'marketValue', 'desc'))).toEqual([
      'BITX',
      'BE',
      'APP',
      'AVGO',
    ]);
  });

  it('sorts by percent return ascending — worst first', () => {
    expect(symbols(sortPositions(book, 'unrealizedPct', 'asc'))).toEqual([
      'AVGO',
      'APP',
      'BE',
      'BITX',
    ]);
  });

  it('sorts by dollar P&L descending', () => {
    expect(symbols(sortPositions(book, 'unrealizedPnl', 'desc'))).toEqual([
      'BITX',
      'BE',
      'APP',
      'AVGO',
    ]);
  });

  it('does not mutate the input array', () => {
    const original = [...book];
    sortPositions(book, 'marketValue', 'asc');
    expect(book).toEqual(original);
  });

  it('sinks unpriceable positions to the bottom when descending', () => {
    const withNull = [...book, p('ZZZ', null, null, null)];
    expect(symbols(sortPositions(withNull, 'marketValue', 'desc')).at(-1)).toBe(
      'ZZZ',
    );
  });

  it('sinks unpriceable positions to the bottom when ascending too', () => {
    const withNull = [...book, p('ZZZ', null, null, null)];
    expect(symbols(sortPositions(withNull, 'marketValue', 'asc')).at(-1)).toBe(
      'ZZZ',
    );
  });

  it('breaks ties on symbol so the order is stable', () => {
    const tied = [p('ZZZ', 100, 0.1, 10), p('AAA', 100, 0.1, 10)];
    expect(symbols(sortPositions(tied, 'marketValue', 'desc'))).toEqual([
      'AAA',
      'ZZZ',
    ]);
  });

  it('orders a short position by its signed value', () => {
    const withShort = [p('LONG', 1000, 0.1, 50), p('SHORT', -2000, 0.1, 50)];
    expect(symbols(sortPositions(withShort, 'marketValue', 'asc'))).toEqual([
      'SHORT',
      'LONG',
    ]);
  });

  it('handles an empty book', () => {
    expect(sortPositions([], 'marketValue', 'desc')).toEqual([]);
  });
});
