import { describe, expect, it } from 'vitest';
import {
  buildPortfolioContext,
  type ContextPosition,
  type PortfolioContextInput,
} from './portfolio-context.js';

function position(overrides: Partial<ContextPosition> = {}): ContextPosition {
  return {
    symbol: 'AAPL',
    quantity: 100,
    avgCost: 150,
    price: 160,
    marketValue: 16000,
    unrealizedPnl: 1000,
    unrealizedPct: 0.0667,
    stale: false,
    ...overrides,
  };
}

function baseInput(overrides: Partial<PortfolioContextInput> = {}): PortfolioContextInput {
  return {
    portfolio: {
      positions: [position()],
      cash: 5000,
      positionsValue: 16000,
      accountValue: 21000,
      pricedAt: '2026-09-02T14:30:00.000Z',
      hasStalePrices: false,
      atRisk: { amount: 800, positionsWithoutStop: { count: 0, symbols: [] } },
    },
    stats: {
      closedCount: 10,
      openCount: 1,
      winRate: 0.6,
      avgWin: 500,
      avgLoss: 200,
      avgRisk: 400,
      riskTradeCount: 8,
      expectancyDollars: 220,
      expectancyR: 0.5,
      rTradeCount: 8,
    },
    performance: {
      range: '1M',
      youReturn: 0.042,
      deltas: { vsSp500: 0.021, vsNasdaq: -0.005 },
    },
    ...overrides,
  };
}

describe('buildPortfolioContext', () => {
  it('includes the facts timestamp so the model can attribute freshness', () => {
    const text = buildPortfolioContext(baseInput());
    expect(text).toContain('2026-09-02T14:30:00.000Z');
  });

  it('quotes account, cash and deployed value exactly, without recomputation', () => {
    const text = buildPortfolioContext(baseInput());
    expect(text).toContain('$21,000.00');
    expect(text).toContain('$5,000.00');
    expect(text).toContain('$16,000.00');
  });

  it('flags negative cash as margin', () => {
    const text = buildPortfolioContext(
      baseInput({
        portfolio: {
          ...baseInput().portfolio,
          cash: -3000,
        },
      }),
    );
    expect(text).toContain('-$3,000.00');
    expect(text).toContain('on margin');
  });

  it('computes gross exposure and leverage from position market values', () => {
    const text = buildPortfolioContext(
      baseInput({
        portfolio: {
          ...baseInput().portfolio,
          positions: [
            position({ symbol: 'AAPL', marketValue: 10000 }),
            // A short contributes its magnitude to gross exposure, not a
            // negative offset — leverage measures total exposure, not net.
            position({ symbol: 'TSLA', quantity: -50, marketValue: -5000 }),
          ],
          accountValue: 10000,
        },
      }),
    );
    expect(text).toContain('Gross exposure (sum of |position value|): $15,000.00');
    expect(text).toContain('Leverage (gross exposure / account value): 1.50x');
  });

  it('omits leverage when account value is zero or negative rather than dividing by it', () => {
    const text = buildPortfolioContext(
      baseInput({
        portfolio: { ...baseInput().portfolio, accountValue: 0 },
      }),
    );
    expect(text).not.toContain('Leverage');
  });

  it('lists at-risk amount and names symbols without a stop', () => {
    const text = buildPortfolioContext(
      baseInput({
        portfolio: {
          ...baseInput().portfolio,
          atRisk: {
            amount: 1200,
            positionsWithoutStop: { count: 2, symbols: ['TSLA', 'NFLX'] },
          },
        },
      }),
    );
    expect(text).toContain('At risk (sum of stop-loss exposure): $1,200.00');
    expect(text).toContain('Positions without a recorded stop: 2 (TSLA, NFLX)');
  });

  it('lists at most the five largest positions by size, largest first', () => {
    const positions = Array.from({ length: 8 }, (_, i) =>
      position({ symbol: `SYM${i}`, marketValue: (i + 1) * 1000 }),
    );
    const text = buildPortfolioContext(
      baseInput({
        portfolio: { ...baseInput().portfolio, positions, accountValue: 40000 },
      }),
    );
    expect(text).toContain('Largest positions (5 of 8, by size)');
    expect(text).toContain('SYM7');
    expect(text).not.toContain('SYM0:');
  });

  it('marks a short position and a stale price on its line', () => {
    const text = buildPortfolioContext(
      baseInput({
        portfolio: {
          ...baseInput().portfolio,
          positions: [position({ symbol: 'GME', quantity: -20, stale: true })],
        },
      }),
    );
    expect(text).toContain('GME: SHORT 20 sh');
    expect(text).toContain('[STALE PRICE]');
  });

  it('reports win rate, avg win/loss, expectancy and R exactly as given', () => {
    const text = buildPortfolioContext(baseInput());
    expect(text).toContain('Win rate: 60.0%');
    expect(text).toContain('Avg win: $500.00, avg loss: $200.00');
    expect(text).toContain('Expectancy: +$220.00 per trade, 0.50R average (based on 8 trade(s))');
  });

  it('says plainly when there are not enough closed trades for a win rate', () => {
    const text = buildPortfolioContext(
      baseInput({
        stats: { ...baseInput().stats, winRate: null, closedCount: 0 },
      }),
    );
    expect(text).toContain('Win rate: not enough closed trades');
  });

  it('reports performance deltas signed, in percentage points', () => {
    const text = buildPortfolioContext(baseInput());
    expect(text).toContain('Your return: +4.2%');
    expect(text).toContain('vs S&P 500: +2.1% points');
    expect(text).toContain('vs Nasdaq: -0.5% points');
  });

  it('says performance is not available rather than guessing when there is no series yet', () => {
    const text = buildPortfolioContext(baseInput({ performance: null }));
    expect(text).toContain('Not available yet (no priced history).');
  });
});
