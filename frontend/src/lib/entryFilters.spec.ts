import { describe, expect, it } from 'vitest';
import {
  emptyFilters,
  entryValue,
  filterSymbols,
  filterTrades,
  hasActiveFilters,
  sortEntries,
  sortSymbols,
  sortTrades,
  type FilterableTrade,
  type SortableEntry,
  type SymbolRow,
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

describe('filtering trades by several tickers', () => {
  const trades = [
    { symbol: 'NVDA', enteredAt: '2026-08-01', exitedAt: '2026-08-05', realizedPnl: 100, avgEntry: 1, quantity: 1 },
    { symbol: 'META', enteredAt: '2026-08-02', exitedAt: '2026-08-06', realizedPnl: -50, avgEntry: 1, quantity: 1 },
    { symbol: 'AAPL', enteredAt: '2026-08-03', exitedAt: '2026-08-07', realizedPnl: 20, avgEntry: 1, quantity: 1 },
  ];

  it('matches any of a comma-separated list', () => {
    const out = filterTrades(trades, { ...emptyFilters, search: 'NVDA, META' });
    expect(out.map((t) => t.symbol)).toEqual(['NVDA', 'META']);
  });

  it('still treats a single term as it always did', () => {
    expect(
      filterTrades(trades, { ...emptyFilters, search: 'nvd' }).map((t) => t.symbol),
    ).toEqual(['NVDA']);
  });

  it('ignores empty terms from stray commas', () => {
    // "NVDA," while still typing the next ticker must not match everything.
    expect(
      filterTrades(trades, { ...emptyFilters, search: 'NVDA, ,' }).map((t) => t.symbol),
    ).toEqual(['NVDA']);
  });

  it('returns everything when the search is blank', () => {
    expect(filterTrades(trades, emptyFilters)).toHaveLength(3);
  });
});

describe('sortSymbols', () => {
  const row = (
    symbol: string,
    totalPnl: number | null,
    latestExit: string | null,
    feesPaid = 0,
    closedCount = 1,
  ): SymbolRow => ({ symbol, closedCount, totalPnl, feesPaid, latestExit });

  const rows = [
    row('LOSS', -500, '2026-08-10T14:30:00.000Z'),
    row('WIN', 900, '2026-08-05T14:30:00.000Z'),
    row('SMALL', 50, '2026-08-20T14:30:00.000Z'),
  ];

  it('sorts by total P&L, biggest win first', () => {
    expect(sortSymbols(rows, 'LARGEST').map((r) => r.symbol)).toEqual([
      'WIN',
      'SMALL',
      'LOSS',
    ]);
  });

  it('sorts by total P&L, biggest loss first', () => {
    expect(sortSymbols(rows, 'SMALLEST').map((r) => r.symbol)).toEqual([
      'LOSS',
      'SMALL',
      'WIN',
    ]);
  });

  it('sorts newest by latest exit', () => {
    expect(sortSymbols(rows, 'NEWEST').map((r) => r.symbol)).toEqual([
      'SMALL',
      'LOSS',
      'WIN',
    ]);
  });

  it('sorts oldest by latest exit', () => {
    expect(sortSymbols(rows, 'OLDEST').map((r) => r.symbol)).toEqual([
      'WIN',
      'LOSS',
      'SMALL',
    ]);
  });

  it('sorts by fees paid, highest first', () => {
    const feeRows = [
      row('LOW', 0, null, 4),
      row('HIGH', 0, null, 40),
      row('MID', 0, null, 12),
    ];
    expect(sortSymbols(feeRows, 'FEES_HIGH').map((r) => r.symbol)).toEqual([
      'HIGH',
      'MID',
      'LOW',
    ]);
  });

  it('sorts by fees paid, lowest first', () => {
    const feeRows = [
      row('LOW', 0, null, 4),
      row('HIGH', 0, null, 40),
      row('MID', 0, null, 12),
    ];
    expect(sortSymbols(feeRows, 'FEES_LOW').map((r) => r.symbol)).toEqual([
      'LOW',
      'MID',
      'HIGH',
    ]);
  });

  it('sorts by number of trades, most first', () => {
    const tradeRows = [
      row('FEW', 0, null, 0, 1),
      row('MANY', 0, null, 0, 10),
      row('SOME', 0, null, 0, 4),
    ];
    expect(sortSymbols(tradeRows, 'TRADES_MOST').map((r) => r.symbol)).toEqual([
      'MANY',
      'SOME',
      'FEW',
    ]);
  });

  it('sorts by number of trades, fewest first', () => {
    const tradeRows = [
      row('FEW', 0, null, 0, 1),
      row('MANY', 0, null, 0, 10),
      row('SOME', 0, null, 0, 4),
    ];
    expect(sortSymbols(tradeRows, 'TRADES_FEWEST').map((r) => r.symbol)).toEqual([
      'FEW',
      'SOME',
      'MANY',
    ]);
  });
});

describe('filterSymbols', () => {
  const row = (symbol: string): SymbolRow => ({
    symbol,
    closedCount: 1,
    totalPnl: 0,
    feesPaid: 0,
    latestExit: null,
  });

  const rows = [row('NVDA'), row('AAPL'), row('META')];

  it('matches a symbol substring case-insensitively', () => {
    expect(filterSymbols(rows, 'nvd').map((r) => r.symbol)).toEqual(['NVDA']);
  });

  it('matches any of a comma-separated list', () => {
    expect(filterSymbols(rows, 'NVDA, META').map((r) => r.symbol)).toEqual([
      'NVDA',
      'META',
    ]);
  });

  it('does nothing below two characters', () => {
    expect(filterSymbols(rows, 'n')).toEqual(rows);
  });

  it('does nothing for whitespace-only search', () => {
    expect(filterSymbols(rows, '   ')).toEqual(rows);
  });

  it('returns nothing when a real search matches no symbol', () => {
    expect(filterSymbols(rows, 'ZZZZ')).toEqual([]);
  });
});
