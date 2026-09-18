import { describe, expect, it } from 'vitest';
import { buildSymbolPatternPrompt } from './symbol-pattern-prompt.js';
import type { SymbolPatternFacts } from './symbol-pattern-context.js';

const stats = {
  closedCount: 3,
  winRate: 0.67,
  avgWin: 500,
  avgLoss: 200,
  expectancyR: 1.2,
  avgRisk: 300,
  avgPositionSize: 5000,
  avgHoldingDays: 4.5,
};

const FACTS: SymbolPatternFacts = {
  symbol: 'NVDA',
  range: '6M',
  thisName: { ...stats, totalPnl: 900, feesPaid: 12 },
  overall: stats,
  trades: [],
  notes: [],
};

describe('buildSymbolPatternPrompt', () => {
  it('warns that its own knowledge of the ticker may be out of date', () => {
    // This prompt is a retrospective read of the trader's own past
    // behavior, not a forward opinion — but nothing stops the model from
    // reaching for its general knowledge of the company while describing a
    // pattern, and that knowledge has a training cutoff. Same discipline
    // trade-idea and the ranking prompt already have.
    const { system } = buildSymbolPatternPrompt(FACTS);
    expect(system).toMatch(/today's news|out of date/i);
  });

  it('still forbids a buy/sell opinion', () => {
    const { system } = buildSymbolPatternPrompt(FACTS);
    expect(system).toMatch(/do not give a buy\/sell opinion|not.*buy\/sell/i);
  });
});
