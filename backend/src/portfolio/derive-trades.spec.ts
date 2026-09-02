import {
  deriveTrades,
  summariseTrades,
  selectEntryStops,
  selectCurrentStops,
  type TradeTxn,
  type StopRevisionInput,
} from './derive-trades.js';

const KNOWN_CREATED_AT = new Date(2026, 0, 1).toISOString();

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
    // A single fixed stop covering the whole fill, recorded as revision 0
    // with a known set-time — the common case for a fresh, revision-aware
    // trade.
    stopLevels:
      extra.stop == null
        ? []
        : [
            {
              kind: 'FIXED',
              price: extra.stop,
              trailPercent: null,
              quantity,
              revisionSeq: 0,
              createdAt: KNOWN_CREATED_AT,
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
          {
            kind: 'FIXED',
            price: 205,
            trailPercent: null,
            quantity: 50,
            revisionSeq: 0,
            createdAt: KNOWN_CREATED_AT,
          },
          {
            kind: 'TRAILING',
            price: null,
            trailPercent: 8,
            quantity: 50,
            revisionSeq: 0,
            createdAt: KNOWN_CREATED_AT,
          },
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

  describe('stop revisions', () => {
    // A trade with an original stop plus two later trail-ups: risk/R must
    // come from the FIRST revision, current stop from the LAST.
    it('computes risk from the original stop and currentStops from the latest', () => {
      const [t] = deriveTrades([
        {
          symbol: 'NVDA',
          side: 'BUY',
          quantity: 10,
          price: 100,
          fee: 0,
          executedAt: new Date(2026, 0, 1),
          stopLevels: [
            // revision 0: the original stop, set at entry.
            {
              kind: 'FIXED',
              price: 90,
              trailPercent: null,
              quantity: 10,
              revisionSeq: 0,
              createdAt: new Date(2026, 0, 1).toISOString(),
            },
            // revision 1: trailed up as the trade worked.
            {
              kind: 'FIXED',
              price: 105,
              trailPercent: null,
              quantity: 10,
              revisionSeq: 1,
              createdAt: new Date(2026, 0, 3).toISOString(),
            },
            // revision 2: trailed again, this is the current stop.
            {
              kind: 'FIXED',
              price: 112,
              trailPercent: null,
              quantity: 10,
              revisionSeq: 2,
              createdAt: new Date(2026, 0, 4).toISOString(),
            },
          ],
        },
        txn('NVDA', 'SELL', 10, 130, 5),
      ]);

      // Risk/R from revision 0 (the original stop): (100-90)*10 = 100.
      expect(t.riskAmount).toBe(100);
      expect(t.rMultiple).toBe(3); // +300 on 100 risked

      // currentStops is revision 2, the live stop — well above entry, as a
      // trailed profit-lock legitimately is.
      expect(t.currentStops).toEqual([
        { kind: 'FIXED', price: 112, trailPercent: null, quantity: 10 },
      ]);
    });

    it('treats a single stop as both the entry and current stop', () => {
      const [t] = deriveTrades([
        txn('NVDA', 'BUY', 10, 100, 1, { stop: 90 }),
        txn('NVDA', 'SELL', 10, 130, 5),
      ]);
      expect(t.riskAmount).toBe(100);
      expect(t.currentStops).toEqual([
        { kind: 'FIXED', price: 90, trailPercent: null, quantity: 10 },
      ]);
    });

    it('leaves both risk and currentStops empty/null with no stop at all', () => {
      const [t] = deriveTrades([
        txn('NVDA', 'BUY', 10, 100, 1),
        txn('NVDA', 'SELL', 10, 130, 5),
      ]);
      expect(t.riskAmount).toBeNull();
      expect(t.rMultiple).toBeNull();
      expect(t.currentStops).toEqual([]);
    });

    // An existing-style trade: only one stop on record, but its createdAt is
    // unknown — the migration's honest label for a row that survived the old
    // overwrite-in-place bug. It is definitely the CURRENT stop (it's all
    // there is), but it must NOT be trusted as the entry stop.
    it('reports null risk for a trade whose only stop is of unknown vintage', () => {
      const [t] = deriveTrades([
        {
          symbol: 'BITX',
          side: 'BUY',
          quantity: 100,
          price: 13.29,
          fee: 0,
          executedAt: new Date(2026, 0, 1),
          stopLevels: [
            {
              kind: 'FIXED',
              price: 17.07, // above entry, on a long — the tell.
              trailPercent: null,
              quantity: 100,
              revisionSeq: 0,
              createdAt: null,
            },
          ],
        },
        txn('BITX', 'SELL', 100, 17.07, 5),
      ]);

      expect(t.riskAmount).toBeNull();
      expect(t.riskCoversFullPosition).toBe(false);
      expect(t.rMultiple).toBeNull();
      // Still reported as the CURRENT stop — the dashboard and chart should
      // keep showing it, only risk/R must refuse to use it.
      expect(t.currentStops).toEqual([
        { kind: 'FIXED', price: 17.07, trailPercent: null, quantity: 100 },
      ]);
    });

    it('still refuses risk once a known revision is added on top of an unknown-vintage original', () => {
      // Even after the owner trails the stop again (with the new,
      // revision-aware code, so revision 1 has a known createdAt), the TRUE
      // original at entry is still unknowable — revision 0 was already the
      // final trailed stop from before revisions were tracked, not
      // necessarily what was set at entry. Only the earliest revision's
      // vintage decides this, not whether later revisions are known.
      const [t] = deriveTrades([
        {
          symbol: 'BITX',
          side: 'BUY',
          quantity: 100,
          price: 13.29,
          fee: 0,
          executedAt: new Date(2026, 0, 1),
          stopLevels: [
            {
              kind: 'FIXED',
              price: 17.07,
              trailPercent: null,
              quantity: 100,
              revisionSeq: 0,
              createdAt: null,
            },
            {
              kind: 'FIXED',
              price: 18.0,
              trailPercent: null,
              quantity: 100,
              revisionSeq: 1,
              createdAt: new Date(2026, 0, 4).toISOString(),
            },
          ],
        },
        txn('BITX', 'SELL', 100, 18.0, 5),
      ]);

      expect(t.riskAmount).toBeNull();
      expect(t.rMultiple).toBeNull();
      expect(t.currentStops).toEqual([
        { kind: 'FIXED', price: 18.0, trailPercent: null, quantity: 100 },
      ]);
    });
  });

  it('orders by execution time regardless of input order', () => {
    const [t] = deriveTrades([
      txn('NVDA', 'SELL', 10, 130, 5),
      txn('NVDA', 'BUY', 10, 100, 1),
    ]);
    expect(t.realizedPnl).toBe(300);
  });

  it('emits every fill of a scaled trade, in execution order', () => {
    const [trade] = deriveTrades([
      {
        symbol: 'AAPL',
        side: 'BUY',
        quantity: 10,
        price: 100,
        fee: 4,
        executedAt: new Date('2026-08-28T13:30:00.000Z'),
      },
      {
        symbol: 'AAPL',
        side: 'BUY',
        quantity: 10,
        price: 110,
        fee: 4,
        executedAt: new Date('2026-08-29T13:30:00.000Z'),
      },
      {
        symbol: 'AAPL',
        side: 'SELL',
        quantity: 20,
        price: 120,
        fee: 4,
        executedAt: new Date('2026-09-01T13:30:00.000Z'),
      },
    ]);

    expect(trade.fills).toHaveLength(3);
    expect(trade.fills.map((f) => f.side)).toEqual(['BUY', 'BUY', 'SELL']);
    expect(trade.fills[1].price).toBe(110);
    expect(trade.fills[2].quantity).toBe(20);
  });

  it('keeps a re-entry’s fills out of the first trade', () => {
    const trades = deriveTrades([
      {
        symbol: 'AAPL',
        side: 'BUY',
        quantity: 10,
        price: 100,
        fee: 4,
        executedAt: new Date('2026-08-28T13:30:00.000Z'),
      },
      {
        symbol: 'AAPL',
        side: 'SELL',
        quantity: 10,
        price: 110,
        fee: 4,
        executedAt: new Date('2026-08-29T13:30:00.000Z'),
      },
      {
        symbol: 'AAPL',
        side: 'BUY',
        quantity: 5,
        price: 105,
        fee: 4,
        executedAt: new Date('2026-08-31T13:30:00.000Z'),
      },
    ]);

    expect(trades).toHaveLength(2);
    // Newest first (see the sort test above): the still-open re-entry leads.
    expect(trades[0].fills).toHaveLength(1);
    expect(trades[1].fills).toHaveLength(2);
  });
});

describe('selectEntryStops / selectCurrentStops', () => {
  const rev = (
    revisionSeq: number,
    price: number,
    createdAt: string | null,
  ): StopRevisionInput => ({
    kind: 'FIXED',
    price,
    trailPercent: null,
    quantity: 10,
    revisionSeq,
    createdAt,
  });

  it('are both empty with no revisions', () => {
    expect(selectEntryStops([])).toEqual([]);
    expect(selectCurrentStops([])).toEqual([]);
  });

  it('picks the lowest revisionSeq for entry and the highest for current', () => {
    const levels = [rev(0, 90, KNOWN_CREATED_AT), rev(1, 105, KNOWN_CREATED_AT)];
    expect(selectEntryStops(levels)).toEqual([
      { kind: 'FIXED', price: 90, trailPercent: null, quantity: 10 },
    ]);
    expect(selectCurrentStops(levels)).toEqual([
      { kind: 'FIXED', price: 105, trailPercent: null, quantity: 10 },
    ]);
  });

  it('returns no entry stop when the earliest revision has no known createdAt', () => {
    const levels = [rev(0, 90, null)];
    expect(selectEntryStops(levels)).toEqual([]);
    // But it is still the current stop.
    expect(selectCurrentStops(levels)).toEqual([
      { kind: 'FIXED', price: 90, trailPercent: null, quantity: 10 },
    ]);
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
