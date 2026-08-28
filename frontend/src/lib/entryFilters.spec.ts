import { describe, expect, it } from 'vitest';
import {
  emptyFilters,
  entryValue,
  filterEntries,
  filterTrades,
  hasActiveFilters,
  sortEntries,
  sortTrades,
  type FilterableTrade,
  type SortableEntry,
} from './entryFilters';

function entry(
  overrides: Partial<SortableEntry> & { occurredAt: string },
): SortableEntry {
  return {
    body: '',
    trade: null,
    cash: null,
    dividend: null,
    ...overrides,
  };
}

const buy = (symbol: string, qty: number, price: number, day = '01') =>
  entry({
    occurredAt: `2026-08-${day}T14:30:00.000Z`,
    trade: { symbol, quantity: qty, price },
  });

describe('hasActiveFilters', () => {
  it('is false when nothing is set', () => {
    expect(hasActiveFilters(emptyFilters)).toBe(false);
  });
  it('ignores whitespace-only search', () => {
    expect(hasActiveFilters({ ...emptyFilters, search: '   ' })).toBe(false);
  });
  it('is true with a date bound', () => {
    expect(hasActiveFilters({ ...emptyFilters, from: '2026-08-01' })).toBe(true);
  });
});

describe('filterEntries', () => {
  const entries = [
    buy('NVDA', 10, 200, '10'),
    buy('AAPL', 5, 300, '20'),
    entry({
      occurredAt: '2026-08-25T14:30:00.000Z',
      body: 'took profit into strength',
      trade: { symbol: 'PLTR', quantity: 1, price: 100 },
    }),
  ];

  it('returns everything with empty filters', () => {
    expect(filterEntries(entries, emptyFilters)).toHaveLength(3);
  });

  it('matches a ticker, case-insensitively', () => {
    const r = filterEntries(entries, { ...emptyFilters, search: 'nvda' });
    expect(r).toHaveLength(1);
    expect(r[0].trade?.symbol).toBe('NVDA');
  });

  it('matches a partial ticker', () => {
    expect(filterEntries(entries, { ...emptyFilters, search: 'AAP' })).toHaveLength(1);
  });

  it('matches note text as well as tickers', () => {
    const r = filterEntries(entries, { ...emptyFilters, search: 'profit' });
    expect(r).toHaveLength(1);
    expect(r[0].trade?.symbol).toBe('PLTR');
  });

  it('filters from a date inclusively', () => {
    expect(
      filterEntries(entries, { ...emptyFilters, from: '2026-08-20' }),
    ).toHaveLength(2);
  });

  it('filters to a date inclusively', () => {
    // The 20th itself must be included, or "up to the 20th" loses a day.
    expect(
      filterEntries(entries, { ...emptyFilters, to: '2026-08-20' }),
    ).toHaveLength(2);
  });

  it('applies both bounds together', () => {
    const r = filterEntries(entries, {
      ...emptyFilters,
      from: '2026-08-20',
      to: '2026-08-20',
    });
    expect(r).toHaveLength(1);
    expect(r[0].trade?.symbol).toBe('AAPL');
  });

  it('combines search with a date range', () => {
    expect(
      filterEntries(entries, {
        search: 'NVDA',
        from: '2026-08-20',
        to: '',
      }),
    ).toHaveLength(0);
  });

  it('matches a dividend by its ticker', () => {
    const divs = [
      entry({
        occurredAt: '2026-08-11T14:30:00.000Z',
        dividend: { symbol: 'AAPL', amount: 120 },
      }),
    ];
    expect(filterEntries(divs, { ...emptyFilters, search: 'aapl' })).toHaveLength(1);
  });
});

describe('entryValue', () => {
  it('is quantity times price for a trade', () => {
    expect(entryValue(buy('NVDA', 151, 212.61))).toBeCloseTo(32104.11, 2);
  });
  it('is the amount for a cash movement', () => {
    expect(
      entryValue(entry({ occurredAt: 'x', cash: { amount: 5000 } })),
    ).toBe(5000);
  });
  it('is the amount for a dividend', () => {
    expect(
      entryValue(
        entry({ occurredAt: 'x', dividend: { symbol: 'T', amount: 120 } }),
      ),
    ).toBe(120);
  });
  it('is positive for a sell, which is still money moved', () => {
    expect(entryValue(buy('NVDA', -10, 200))).toBe(2000);
  });
});

describe('sortEntries', () => {
  const entries = [
    buy('SMALL', 1, 100, '10'),
    buy('BIG', 100, 100, '20'),
    buy('MID', 10, 100, '15'),
  ];

  it('sorts newest first', () => {
    expect(sortEntries(entries, 'NEWEST').map((e) => e.trade?.symbol)).toEqual([
      'BIG',
      'MID',
      'SMALL',
    ]);
  });

  it('sorts oldest first', () => {
    expect(sortEntries(entries, 'OLDEST').map((e) => e.trade?.symbol)).toEqual([
      'SMALL',
      'MID',
      'BIG',
    ]);
  });

  it('sorts by money, largest first', () => {
    expect(sortEntries(entries, 'LARGEST').map((e) => e.trade?.symbol)).toEqual([
      'BIG',
      'MID',
      'SMALL',
    ]);
  });

  it('sorts by money, smallest first', () => {
    expect(
      sortEntries(entries, 'SMALLEST').map((e) => e.trade?.symbol),
    ).toEqual(['SMALL', 'MID', 'BIG']);
  });

  it('does not mutate the input', () => {
    const original = [...entries];
    sortEntries(entries, 'LARGEST');
    expect(entries).toEqual(original);
  });
});

function trade(
  symbol: string,
  pnl: number | null,
  exited: string | null,
): FilterableTrade {
  return {
    symbol,
    enteredAt: '2026-08-01T14:30:00.000Z',
    exitedAt: exited,
    realizedPnl: pnl,
    avgEntry: 100,
    quantity: 10,
  };
}

describe('filterTrades', () => {
  const trades = [
    trade('NVDA', 300, '2026-08-10T14:30:00.000Z'),
    trade('AAPL', -100, '2026-08-20T14:30:00.000Z'),
  ];

  it('matches a ticker', () => {
    expect(filterTrades(trades, { ...emptyFilters, search: 'nvda' })).toHaveLength(1);
  });

  it('filters a closed trade on its exit date, not its entry', () => {
    // Both entered on the 1st; only the exit dates distinguish them.
    const r = filterTrades(trades, { ...emptyFilters, from: '2026-08-15' });
    expect(r).toHaveLength(1);
    expect(r[0].symbol).toBe('AAPL');
  });

  it('falls back to the entry date for an open trade', () => {
    const open = [trade('TSLA', null, null)];
    expect(filterTrades(open, { ...emptyFilters, from: '2026-08-01' })).toHaveLength(1);
    expect(filterTrades(open, { ...emptyFilters, from: '2026-08-02' })).toHaveLength(0);
  });
});

describe('sortTrades', () => {
  const trades = [
    trade('LOSS', -500, '2026-08-10T14:30:00.000Z'),
    trade('WIN', 900, '2026-08-05T14:30:00.000Z'),
    trade('SMALL', 50, '2026-08-20T14:30:00.000Z'),
  ];

  it('sorts by result, biggest win first', () => {
    expect(sortTrades(trades, 'LARGEST').map((t) => t.symbol)).toEqual([
      'WIN',
      'SMALL',
      'LOSS',
    ]);
  });

  it('sorts by result, biggest loss first', () => {
    expect(sortTrades(trades, 'SMALLEST').map((t) => t.symbol)).toEqual([
      'LOSS',
      'SMALL',
      'WIN',
    ]);
  });

  it('sorts newest by exit date', () => {
    expect(sortTrades(trades, 'NEWEST').map((t) => t.symbol)).toEqual([
      'SMALL',
      'LOSS',
      'WIN',
    ]);
  });
});
