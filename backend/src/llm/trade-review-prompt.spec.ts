import { describe, expect, it } from 'vitest';
import { buildTradeReviewPrompt } from './trade-review-prompt.js';
import type { TradeReviewFacts } from './trade-review-context.js';

describe('buildTradeReviewPrompt', () => {
  it('passes the whole profile, not a prefix that stops before his rules', () => {
    // A 1200-character cut used to end inside the profile's second section,
    // so a review never saw his exit rules or known weaknesses.
    const profile = `# Trader Profile\n${'x'.repeat(5000)}\n## Method — exits\nHe trails the stop up.`;
    const facts: TradeReviewFacts = {
      symbol: 'NVDA',
      direction: 'LONG',
      status: 'CLOSED',
      enteredAt: '2026-09-01',
      exitedAt: '2026-09-05',
      holdingDays: 4,
      quantity: 100,
      remainingQuantity: 0,
      avgEntry: 100,
      avgExit: 110,
      realizedPnl: 1000,
      realizedPnlPercent: 10,
      rMultiple: 2,
      initialRiskPerShare: 5,
      initialRiskPercent: 5,
      plannedTarget: null,
      entryRelativeVolume: null,
      highWaterPrice: 112,
      mfeGainPercent: 12,
      hadInitialStop: true,
      initialStopPrice: 95,
      stopTrailedFavorable: true,
      stopWidenedOrMovedAgainst: false,
      stopSlippageTotal: null,
      stopSlippagePerShare: null,
      exitKinds: { stopShares: 0, targetShares: 0, discretionaryShares: 100 },
      setups: [],
      mistakes: [],
      notes: [],
    };
    const { user } = buildTradeReviewPrompt(facts, profile);
    expect(user).toContain('He trails the stop up.');
  });
});
