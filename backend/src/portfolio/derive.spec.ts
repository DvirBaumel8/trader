import {
  derivePositions,
  deriveCash,
  type DerivedTxn,
  type DerivedFlow,
} from './derive.js';

function buy(
  symbol: string,
  quantity: number,
  price: number,
  fee = 4,
  day = 1,
): DerivedTxn {
  return {
    symbol,
    side: 'BUY',
    quantity,
    price,
    fee,
    executedAt: new Date(2026, 0, day),
  };
}
function sell(
  symbol: string,
  quantity: number,
  price: number,
  fee = 4,
  day = 1,
): DerivedTxn {
  return {
    symbol,
    side: 'SELL',
    quantity,
    price,
    fee,
    executedAt: new Date(2026, 0, day),
  };
}
function deposit(amount: number, day = 1): DerivedFlow {
  return { direction: 'DEPOSIT', amount, occurredAt: new Date(2026, 0, day) };
}
function withdraw(amount: number, day = 1): DerivedFlow {
  return { direction: 'WITHDRAW', amount, occurredAt: new Date(2026, 0, day) };
}

describe('derivePositions', () => {
  it('returns nothing for an empty log', () => {
    expect(derivePositions([])).toEqual([]);
  });

  it('derives a single long position', () => {
    const [p] = derivePositions([buy('NVDA', 10, 100)]);
    expect(p.symbol).toBe('NVDA');
    expect(p.quantity).toBe(10);
    expect(p.costBasis).toBe(1000);
    expect(p.avgCost).toBe(100);
    expect(p.feesPaid).toBe(4);
    expect(p.realizedPnl).toBe(-4); // no closes yet, so realized is just fees
  });

  it('averages cost across multiple buys', () => {
    const [p] = derivePositions([
      buy('NVDA', 10, 100, 4, 1),
      buy('NVDA', 10, 120, 4, 2),
    ]);
    expect(p.quantity).toBe(20);
    expect(p.costBasis).toBe(2200);
    expect(p.avgCost).toBe(110);
    expect(p.feesPaid).toBe(8);
  });

  it('matches lots FIFO on a partial sell', () => {
    // buy 10@100, buy 10@120, sell 15@130
    // FIFO closes 10 from the 100 lot (+300) and 5 from the 120 lot (+50) = +350
    const [p] = derivePositions([
      buy('NVDA', 10, 100, 4, 1),
      buy('NVDA', 10, 120, 4, 2),
      sell('NVDA', 15, 130, 4, 3),
    ]);
    expect(p.quantity).toBe(5);
    expect(p.costBasis).toBe(600); // 5 remaining @ 120
    expect(p.avgCost).toBe(120);
    expect(p.feesPaid).toBe(12);
    expect(p.realizedPnl).toBe(350 - 12);
  });

  it('drops a fully closed position to zero quantity but keeps realized P&L', () => {
    const [p] = derivePositions([
      buy('NVDA', 10, 100, 4, 1),
      sell('NVDA', 10, 130, 4, 2),
    ]);
    expect(p.quantity).toBe(0);
    expect(p.costBasis).toBe(0);
    expect(p.realizedPnl).toBe(300 - 8);
    expect(p.isOpen).toBe(false);
  });

  it('opens a short when selling with no position', () => {
    const [p] = derivePositions([sell('TSLA', 10, 300, 4)]);
    expect(p.quantity).toBe(-10);
    expect(p.costBasis).toBe(-3000);
    expect(p.avgCost).toBe(300);
    expect(p.isOpen).toBe(true);
  });

  it('profits on a short when the price falls', () => {
    const [p] = derivePositions([
      sell('TSLA', 10, 300, 4, 1),
      buy('TSLA', 10, 250, 4, 2),
    ]);
    expect(p.quantity).toBe(0);
    expect(p.realizedPnl).toBe(500 - 8); // (300-250)*10 minus fees
  });

  it('loses on a short when the price rises', () => {
    const [p] = derivePositions([
      sell('TSLA', 10, 300, 4, 1),
      buy('TSLA', 10, 340, 4, 2),
    ]);
    expect(p.realizedPnl).toBe(-400 - 8);
  });

  it('flips from long to short in one oversized sell', () => {
    // long 10@100, sell 15@130: closes 10 (+300), opens a 5 short at 130
    const [p] = derivePositions([
      buy('NVDA', 10, 100, 4, 1),
      sell('NVDA', 15, 130, 4, 2),
    ]);
    expect(p.quantity).toBe(-5);
    expect(p.costBasis).toBe(-650);
    expect(p.realizedPnl).toBe(300 - 8);
  });

  it('flips from short to long in one oversized buy', () => {
    // short 10@300, buy 15@250: closes 10 (+500), opens a 5 long at 250
    const [p] = derivePositions([
      sell('TSLA', 10, 300, 4, 1),
      buy('TSLA', 15, 250, 4, 2),
    ]);
    expect(p.quantity).toBe(5);
    expect(p.costBasis).toBe(1250);
    expect(p.realizedPnl).toBe(500 - 8);
  });

  it('keeps positions independent from each other', () => {
    const positions = derivePositions([
      buy('NVDA', 10, 100),
      buy('AAPL', 5, 200),
    ]);
    expect(positions.map((p) => p.symbol).sort()).toEqual(['AAPL', 'NVDA']);
  });

  it('orders by execution time regardless of input order', () => {
    const [p] = derivePositions([
      sell('NVDA', 10, 130, 4, 5), // later
      buy('NVDA', 10, 100, 4, 1), // earlier
    ]);
    expect(p.quantity).toBe(0);
    expect(p.realizedPnl).toBe(300 - 8);
  });

  it('handles fractional quantities', () => {
    const [p] = derivePositions([buy('SPY', 0.5, 600, 0)]);
    expect(p.quantity).toBe(0.5);
    expect(p.costBasis).toBe(300);
  });

  it('does not accumulate floating point dust across many fills', () => {
    const txns = Array.from({ length: 10 }, (_, i) =>
      buy('SPY', 0.1, 600, 0, i + 1),
    );
    const [p] = derivePositions(txns);
    expect(p.quantity).toBe(1);
    expect(p.costBasis).toBe(600);
  });
});

describe('deriveCash', () => {
  it('is zero with no activity', () => {
    expect(deriveCash([], [])).toBe(0);
  });

  it('adds deposits and subtracts withdrawals', () => {
    expect(deriveCash([], [deposit(10000), withdraw(2500)])).toBe(7500);
  });

  it('subtracts buy cost and fee', () => {
    expect(deriveCash([buy('NVDA', 10, 100, 4)], [deposit(10000)])).toBe(
      10000 - 1000 - 4,
    );
  });

  it('adds sell proceeds and still subtracts the fee', () => {
    const cash = deriveCash(
      [buy('NVDA', 10, 100, 4, 1), sell('NVDA', 10, 130, 4, 2)],
      [deposit(10000)],
    );
    expect(cash).toBe(10000 - 1000 - 4 + 1300 - 4);
  });

  it('goes negative on margin without complaint', () => {
    // Buying more than the cash on hand is a legitimate margin state.
    expect(deriveCash([buy('NVDA', 100, 100, 4)], [deposit(1000)])).toBe(
      1000 - 10000 - 4,
    );
  });
});
