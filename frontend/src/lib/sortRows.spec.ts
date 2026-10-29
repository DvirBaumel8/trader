import { describe, expect, it } from 'vitest';
import { nextSort, sortRows, type SortState } from './sortRows';
import type { Move } from '../api/moves';

const mv = (symbol: string, atrPercent: number | null, movePercent: number | null): Move => ({
  symbol, atrPercent, movePercent, live: true, asOf: null,
});
const rows = ['CCC', 'AAA', 'BBB', 'DDD'].map((symbol) => ({ symbol }));
const moves = [mv('CCC', 2, 1), mv('AAA', 4, null), mv('BBB', 2, -3)];
const order = (s: SortState | null) => sortRows(rows, s, moves).map((r) => r.symbol);

describe('nextSort', () => {
  it('cycles descending, ascending, then My order', () => {
    const a = nextSort(null, 'atr');
    expect(a).toEqual({ key: 'atr', dir: 'desc' });
    const b = nextSort(a, 'atr');
    expect(b).toEqual({ key: 'atr', dir: 'asc' });
    expect(nextSort(b, 'atr')).toBeNull();
  });
  it('Ticker starts A-Z, and switching column starts over', () => {
    expect(nextSort(null, 'ticker')).toEqual({ key: 'ticker', dir: 'asc' });
    expect(nextSort({ key: 'ticker', dir: 'asc' }, 'ticker')).toEqual({ key: 'ticker', dir: 'desc' });
    expect(nextSort({ key: 'ticker', dir: 'desc' }, 'ticker')).toBeNull();
    expect(nextSort({ key: 'atr', dir: 'asc' }, 'today')).toEqual({ key: 'today', dir: 'desc' });
  });
});

describe('sortRows', () => {
  it('keeps server order with no sort', () => {
    expect(order(null)).toEqual(['CCC', 'AAA', 'BBB', 'DDD']);
  });
  it('sorts by ticker', () => {
    expect(order({ key: 'ticker', dir: 'asc' })).toEqual(['AAA', 'BBB', 'CCC', 'DDD']);
    expect(order({ key: 'ticker', dir: 'desc' })).toEqual(['DDD', 'CCC', 'BBB', 'AAA']);
  });
  it('puts missing values last in both directions, ties by symbol', () => {
    expect(order({ key: 'atr', dir: 'desc' })).toEqual(['AAA', 'BBB', 'CCC', 'DDD']);
    expect(order({ key: 'atr', dir: 'asc' })).toEqual(['BBB', 'CCC', 'AAA', 'DDD']);
    expect(order({ key: 'today', dir: 'desc' })).toEqual(['CCC', 'BBB', 'AAA', 'DDD']);
    expect(order({ key: 'today', dir: 'asc' })).toEqual(['BBB', 'CCC', 'AAA', 'DDD']);
  });
  it('does not mutate its input', () => {
    sortRows(rows, { key: 'ticker', dir: 'asc' }, moves);
    expect(rows.map((r) => r.symbol)).toEqual(['CCC', 'AAA', 'BBB', 'DDD']);
  });
});
