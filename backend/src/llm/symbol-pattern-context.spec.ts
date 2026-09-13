import { describe, expect, it } from 'vitest';
import { buildSymbolPatternFacts, type SymbolStats } from './symbol-pattern-context.js';
import type { RecordTrade } from './trade-idea-context.js';

const stats = (over: Partial<SymbolStats> = {}): SymbolStats => ({
  closedCount: 5,
  winRate: 0.6,
  avgWin: 500,
  avgLoss: 200,
  avgRisk: 150,
  expectancyR: 1.2,
  avgPositionSize: 5000,
  avgHoldingDays: 3,
  ...over,
});

const trade = (exitedAt: string, over: Partial<RecordTrade> = {}): RecordTrade => ({
  symbol: 'NVDA',
  direction: 'LONG',
  isOpen: false,
  realizedPnl: 100,
  rMultiple: 1,
  enteredAt: '2026-01-01',
  exitedAt,
  ...over,
});

describe('buildSymbolPatternFacts', () => {
  it('sorts trades most recent first', () => {
    const facts = buildSymbolPatternFacts({
      symbol: 'NVDA',
      range: 'ALL',
      thisName: { ...stats(), totalPnl: 900, feesPaid: 40 },
      overall: stats(),
      trades: [trade('2026-01-10'), trade('2026-03-01'), trade('2026-02-15')],
      notes: [],
    });
    expect(facts.trades.map((t) => t.exitedAt)).toEqual([
      '2026-03-01',
      '2026-02-15',
      '2026-01-10',
    ]);
  });

  it('caps the trade list at 30, keeping the most recent', () => {
    const trades = Array.from({ length: 35 }, (_, i) =>
      trade(`2026-01-${String((i % 28) + 1).padStart(2, '0')}`, {
        realizedPnl: i,
      }),
    );
    const facts = buildSymbolPatternFacts({
      symbol: 'NVDA',
      range: 'ALL',
      thisName: { ...stats(), totalPnl: 900, feesPaid: 40 },
      overall: stats(),
      trades,
      notes: [],
    });
    expect(facts.trades).toHaveLength(30);
  });

  it('drops blank notes and trims whitespace', () => {
    const facts = buildSymbolPatternFacts({
      symbol: 'NVDA',
      range: 'ALL',
      thisName: { ...stats(), totalPnl: 900, feesPaid: 40 },
      overall: stats(),
      trades: [],
      notes: ['  got greedy  ', '', '   '],
    });
    expect(facts.notes).toEqual(['got greedy']);
  });

  it('truncates a note longer than 240 characters', () => {
    const longNote = 'x'.repeat(300);
    const facts = buildSymbolPatternFacts({
      symbol: 'NVDA',
      range: 'ALL',
      thisName: { ...stats(), totalPnl: 900, feesPaid: 40 },
      overall: stats(),
      trades: [],
      notes: [longNote],
    });
    expect(facts.notes[0]).toHaveLength(241); // 240 chars + the ellipsis
    expect(facts.notes[0].endsWith('…')).toBe(true);
  });
});
