import {
  deriveTrades,
  summariseTrades,
  type TradeTxn,
} from './derive-trades.js';

function txn(
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity: number,
  price: number,
  day: number,
  extra: { fee?: number; stop?: number | null } = {},
): TradeTxn {
  return {
    symbol,
    side,
    quantity,
    price,
    fee: extra.fee ?? 0,
    executedAt: new Date(2026, 0, day),
    // A single fixed stop covering the whole fill — the common case.
    stopLevels:
      extra.stop == null
        ? []
        : [
            {
              kind: 'FIXED',
              price: extra.stop,
              trailPercent: null,
              quantity,
            },
          ],
  };
}

describe('deriveTrades', () => {
  it('returns nothing for an empty log', () => {
    expect(deriveTrades([])).toEqual([]);
  });

  it('treats an open position as an open trade with no result', () => {
    const [t] = deriveTrades([txn('NVDA', 'BUY', 10, 100, 1)]);
    expect(t.isOpen).toBe(true);
    expect(t.exitedAt).toBeNull();
    expect(t.realizedPnl).toBeNull();
  });

  it('closes a trade when the position returns to flat', () => {
    const [t] = deriveTrades([
      txn('NVDA', 'BUY', 10, 100, 1),
      txn('NVDA', 'SELL', 10, 130, 5),
    ]);
    expect(t.isOpen).toBe(false);
    expect(t.symbol).toBe('NVDA');
    expect(t.direction).toBe('LONG');
    expect(t.quantity).toBe(10);
    expect(t.avgEntry).toBe(100);
    expect(t.avgExit).toBe(130);
    expect(t.realizedPnl).toBe(300);
    expect(t.isWin).toBe(true);
    expect(t.holdingDays).toBe(4);
  });

  it('nets fees out of the result', () => {
    const [t] = deriveTrades([
      txn('NVDA', 'BUY', 10, 100, 1, { fee: 4 }),
      txn('NVDA', 'SELL', 10, 130, 5, { fee: 4 }),
    ]);
    expect(t.realizedPnl).toBe(300 - 8);
    expect(t.feesPaid).toBe(8);
  });

  it('averages a scaled-in entry and a scaled-out exit', () => {
    const [t] = deriveTrades([
      txn('NVDA', 'BUY', 10, 100, 1),
      txn('NVDA', 'BUY', 10, 120, 2),
      txn('NVDA', 'SELL', 10, 150, 5),
      txn('NVDA', 'SELL', 10, 130, 6),
    ]);
    expect(t.quantity).toBe(20);
    expect(t.avgEntry).toBe(110);
    expect(t.avgExit).toBe(140);
    expect(t.realizedPnl).toBe(600);
  });

  it('splits a re-entry into a separate trade', () => {
    // Flat between them, so these are two trades, not one.
    const trades = deriveTrades([
      txn('NVDA', 'BUY', 10, 100, 1),
      txn('NVDA', 'SELL', 10, 130, 5),
      txn('NVDA', 'BUY', 10, 140, 10),
      txn('NVDA', 'SELL', 10, 120, 15),
    ]);
    expect(trades).toHaveLength(2);
    // Newest first, so the losing re-entry leads.
    expect(trades[0].realizedPnl).toBe(-200);
    expect(trades[0].isWin).toBe(false);
    expect(trades[1].realizedPnl).toBe(300);
  });

  it('handles a short trade', () => {
    const [t] = deriveTrades([
      txn('TSLA', 'SELL', 10, 300, 1),
      txn('TSLA', 'BUY', 10, 250, 5),
    ]);
    expect(t.direction).toBe('SHORT');
    expect(t.realizedPnl).toBe(500);
    expect(t.isWin).toBe(true);
  });

  it('loses on a short that goes against you', () => {
    const [t] = deriveTrades([
      txn('TSLA', 'SELL', 10, 300, 1),
      txn('TSLA', 'BUY', 10, 340, 5),
    ]);
    expect(t.realizedPnl).toBe(-400);
    expect(t.isWin).toBe(false);
  });

  it('keeps trades in different symbols separate', () => {
    const trades = deriveTrades([
      txn('NVDA', 'BUY', 10, 100, 1),
      txn('AAPL', 'BUY', 5, 200, 1),
      txn('NVDA', 'SELL', 10, 130, 5),
    ]);
    expect(trades).toHaveLength(2);
    expect(trades.filter((t) => t.isOpen)).toHaveLength(1);
  });

  it('computes risk and R from the stop on the opening fill', () => {
    const [t] = deriveTrades([
      txn('NVDA', 'BUY', 10, 100, 1, { stop: 90 }),
      txn('NVDA', 'SELL', 10, 130, 5),
    ]);
    expect(t.riskAmount).toBe(100); // (100 - 90) * 10
    expect(t.rMultiple).toBe(3); // +300 on 100 risked
  });

  it('computes R for a short from a stop above entry', () => {
    const [t] = deriveTrades([
      txn('TSLA', 'SELL', 10, 300, 1, { stop: 320 }),
      txn('TSLA', 'BUY', 10, 250, 5),
    ]);
    expect(t.riskAmount).toBe(200);
    expect(t.rMultiple).toBe(2.5);
  });

  it('sums tiered stops into one risk figure', () => {
    const [t] = deriveTrades([
      {
        symbol: 'NVDA',
        side: 'BUY',
        quantity: 100,
        price: 217,
        fee: 0,
        executedAt: new Date(2026, 0, 1),
        stopLevels: [
          { kind: 'FIXED', price: 205, trailPercent: null, quantity: 50 },
          { kind: 'TRAILING', price: null, trailPercent: 8, quantity: 50 },
        ],
      },
      txn('NVDA', 'SELL', 100, 240, 5),
    ]);
    expect(t.riskAmount).toBe(600 + 868);
    expect(t.riskCoversFullPosition).toBe(true);
  });

  it('leaves R null when no stop was set', () => {
    const [t] = deriveTrades([
      txn('NVDA', 'BUY', 10, 100, 1),
      txn('NVDA', 'SELL', 10, 130, 5),
    ]);
    expect(t.riskAmount).toBeNull();
    expect(t.rMultiple).toBeNull();
  });

  it('leaves R null when the stop equals the entry', () => {
    // Zero risk would divide by zero and produce Infinity.
    const [t] = deriveTrades([
      txn('NVDA', 'BUY', 10, 100, 1, { stop: 100 }),
      txn('NVDA', 'SELL', 10, 130, 5),
    ]);
    expect(t.rMultiple).toBeNull();
  });

  it('orders by execution time regardless of input order', () => {
    const [t] = deriveTrades([
      txn('NVDA', 'SELL', 10, 130, 5),
      txn('NVDA', 'BUY', 10, 100, 1),
    ]);
    expect(t.realizedPnl).toBe(300);
  });
});

describe('summariseTrades', () => {
  const closed = (
    pnl: number,
    r: number | null = null,
    riskAmount: number | null = null,
  ) => ({
    realizedPnl: pnl,
    isOpen: false,
    isWin: pnl > 0,
    rMultiple: r,
    riskAmount,
  });

  it('is empty with no closed trades', () => {
    const s = summariseTrades([]);
    expect(s.closedCount).toBe(0);
    expect(s.winRate).toBeNull();
    expect(s.avgRisk).toBeNull();
    expect(s.expectancyR).toBeNull();
  });

  it('ignores open trades in the outcome stats', () => {
    const s = summariseTrades([
      {
        realizedPnl: null,
        isOpen: true,
        isWin: null,
        rMultiple: null,
        riskAmount: null,
      },
    ]);
    expect(s.closedCount).toBe(0);
    expect(s.winRate).toBeNull();
  });

  it('computes win rate', () => {
    const s = summariseTrades([
      closed(100),
      closed(-50),
      closed(200),
      closed(-10),
    ]);
    expect(s.closedCount).toBe(4);
    expect(s.winRate).toBe(0.5);
  });

  it('averages the dollar risk over trades that set a stop', () => {
    const s = summariseTrades([
      closed(300, 3, 100),
      closed(-200, -1, 200),
      closed(50), // no stop, excluded
    ]);
    expect(s.avgRisk).toBe(150);
    expect(s.riskTradeCount).toBe(2);
  });

  it('counts an open trade in average risk, since risk is known at entry', () => {
    const s = summariseTrades([
      closed(300, 3, 100),
      {
        realizedPnl: null,
        isOpen: true,
        isWin: null,
        rMultiple: null,
        riskAmount: 300,
      },
    ]);
    expect(s.avgRisk).toBe(200);
    expect(s.riskTradeCount).toBe(2);
    expect(s.closedCount).toBe(1);
  });

  it('leaves average risk null when no trade set a stop', () => {
    const s = summariseTrades([closed(300), closed(-100)]);
    expect(s.avgRisk).toBeNull();
    expect(s.riskTradeCount).toBe(0);
  });

  it('computes expectancy in R only over trades that have one', () => {
    const s = summariseTrades([
      closed(300, 3, 100),
      closed(-100, -1, 100),
      closed(200), // no stop, excluded from R
    ]);
    expect(s.expectancyR).toBe(1); // (3 + -1) / 2
    expect(s.rTradeCount).toBe(2);
    expect(s.closedCount).toBe(3);
  });

  it('reports expectancy in dollars over every closed trade', () => {
    const s = summariseTrades([closed(300), closed(-100)]);
    expect(s.expectancyDollars).toBe(100);
  });

  it('leaves expectancy in R null when no trade has a stop', () => {
    const s = summariseTrades([closed(300), closed(-100)]);
    expect(s.expectancyR).toBeNull();
    expect(s.rTradeCount).toBe(0);
  });

  it('treats a scratch trade as a loss, not a win', () => {
    // Break-even is not a win; counting it as one flatters the win rate.
    const s = summariseTrades([closed(0), closed(100)]);
    expect(s.winRate).toBe(0.5);
  });
});
