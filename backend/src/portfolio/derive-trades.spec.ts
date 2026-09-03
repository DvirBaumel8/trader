import {
  deriveTrades,
  summariseTrades,
  selectEntryStops,
  selectCurrentStops,
  computeEffectiveStops,
  suggestTierForFill,
  type TradeTxn,
  type StopRevisionInput,
  type ReducingFill,
} from './derive-trades.js';
import type { StopLevelInput } from './risk.js';

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
    // come from the FIRST revision, current stop from the LAST. No closing
    // fill here on purpose — nothing has sold, so `computeEffectiveStops`
    // has nothing to reconcile against and currentStops is revision 2
    // untouched. See the `computeEffectiveStops` describe block below for
    // what happens once a fill DOES reduce the position.
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
      ]);

      expect(t.isOpen).toBe(true);
      // Risk from revision 0 (the original stop): (100-90)*10 = 100.
      expect(t.riskAmount).toBe(100);

      // currentStops is revision 2, the live stop — well above entry, as a
      // trailed profit-lock legitimately is.
      expect(t.currentStops).toEqual([
        { kind: 'FIXED', price: 112, trailPercent: null, quantity: 10 },
      ]);
    });

    it('treats a single stop as both the entry and current stop', () => {
      const [t] = deriveTrades([txn('NVDA', 'BUY', 10, 100, 1, { stop: 90 })]);
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
      ]);

      expect(t.riskAmount).toBeNull();
      expect(t.rMultiple).toBeNull();
      expect(t.currentStops).toEqual([
        { kind: 'FIXED', price: 18.0, trailPercent: null, quantity: 100 },
      ]);
    });
  });

  it('reports remaining quantity as 0 once a trade closes flat', () => {
    const [t] = deriveTrades([
      txn('NVDA', 'BUY', 10, 100, 1),
      txn('NVDA', 'SELL', 10, 130, 5),
    ]);
    expect(t.remainingQuantity).toBe(0);
  });

  it('reports remaining quantity as the live signed size for an open trade', () => {
    const [t] = deriveTrades([txn('NVDA', 'BUY', 10, 100, 1)]);
    expect(t.remainingQuantity).toBe(10);
  });

  it('reports a negative remaining quantity once a single sell flips the position short', () => {
    // MRNA's shape: 400 bought long, then one SELL of 600 flips it to -200
    // without ever passing through an intermediate flat trade — this stays
    // ONE open trade (direction fixed at 'LONG' from the opening fill), but
    // remainingQuantity must reflect the live short size.
    const [t] = deriveTrades([
      txn('MRNA', 'BUY', 400, 60, 1, { stop: 55 }),
      txn('MRNA', 'SELL', 600, 65, 5),
    ]);
    expect(t.isOpen).toBe(true);
    expect(t.direction).toBe('LONG'); // fixed at the opening fill, on purpose
    expect(t.remainingQuantity).toBe(-200);
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

describe('computeEffectiveStops', () => {
  // The owner's instruction, verbatim: "system should recognize sell activity
  // as a one that removes stop". There is deliberately no manual remove
  // control — a sell IS the removal. These fixtures pin the inference down,
  // because getting it wrong silently changes the dashboard's At-risk figure.
  const OPENED = new Date(2026, 0, 1);
  const RECORDED = new Date(2026, 0, 10);

  function fixed(price: number, quantity: number): StopLevelInput {
    return { kind: 'FIXED', price, trailPercent: null, quantity };
  }

  function trailing(trailPercent: number, quantity: number): StopLevelInput {
    return { kind: 'TRAILING', price: null, trailPercent, quantity };
  }

  function sell(quantity: number, price: number, day: number): ReducingFill {
    return { executedAt: new Date(2026, 0, day), price, quantity };
  }

  it('retires the tier a sale matches exactly, and leaves the other alone', () => {
    // The owner's own worked example. He held 1150 SMCI across two tiers,
    // sold 600 at the price of the 600-share tier, and the app went on
    // showing both tiers — claiming protection on 1150 shares when he held
    // 550. Price AND quantity match here, so this is the unambiguous case.
    const effective = computeEffectiveStops(
      [fixed(36.92, 600), fixed(30.39, 550)],
      RECORDED,
      OPENED,
      [sell(600, 36.92, 15)],
    );
    expect(effective).toEqual([fixed(30.39, 550)]);
  });

  it('reduces a tier in place when the sale is smaller than it', () => {
    // Partial scale-out: the tier is not retired, it just covers fewer
    // shares. Retiring it whole would under-report risk.
    const effective = computeEffectiveStops([fixed(36.92, 600)], RECORDED, OPENED, [
      sell(250, 36.9, 15),
    ]);
    expect(effective).toEqual([fixed(36.92, 350)]);
  });

  it('spans more than one tier when the sale is larger than the closest', () => {
    // 800 sold against a 600 tier at the fill price and a 550 tier further
    // away: the closest goes first and in full, the remainder comes out of
    // the next-closest.
    const effective = computeEffectiveStops(
      [fixed(36.92, 600), fixed(30.39, 550)],
      RECORDED,
      OPENED,
      [sell(800, 36.92, 15)],
    );
    expect(effective).toEqual([fixed(30.39, 350)]);
  });

  it('still reduces coverage when the sale matches no tier closely', () => {
    // A discretionary exit, not a planned scale-out. Which tier he "meant"
    // is genuinely unknowable, but coverage must still come down — claiming
    // stops on shares he no longer holds is the bug being fixed. Closest
    // price wins as the least-bad guess, and because nothing is deleted he
    // can correct it by recording a fresh revision.
    const effective = computeEffectiveStops(
      [fixed(36.92, 600), fixed(30.39, 550)],
      RECORDED,
      OPENED,
      [sell(200, 33.0, 15)],
    );
    // 33.00 sits nearer 30.39 than 36.92, so the lower tier absorbs it.
    expect(effective).toEqual([fixed(36.92, 600), fixed(30.39, 350)]);
  });

  it('leaves nothing behind once the position is fully closed', () => {
    // BITX, BMNR and MSTR all showed live stops on closed positions.
    const effective = computeEffectiveStops(
      [fixed(36.92, 600), fixed(30.39, 550)],
      RECORDED,
      OPENED,
      [sell(1150, 35.0, 15)],
    );
    expect(effective).toEqual([]);
  });

  it('consumes nothing when the position has not been reduced', () => {
    // The common case: no sells, so the effective plan IS the recorded one.
    // A derivation that quietly altered an untouched plan would be worse
    // than the bug it replaces.
    const recorded = [fixed(36.92, 600), fixed(30.39, 550)];
    expect(computeEffectiveStops(recorded, RECORDED, OPENED, [])).toEqual(recorded);
  });

  it('ignores fills that predate the recorded revision', () => {
    // A sale before he set this revision was already accounted for when he
    // set it — consuming it again would double count and under-report risk.
    const effective = computeEffectiveStops([fixed(36.92, 600)], RECORDED, OPENED, [
      sell(300, 36.92, 5),
    ]);
    expect(effective).toEqual([fixed(36.92, 600)]);
  });

  it('falls back to the position open date when no revision time is known', () => {
    // Legacy stops predate revision tracking and carry no timestamp. Every
    // fill since the position opened is then fair game — a tier cannot have
    // been consumed by a sale older than the position it protects.
    const effective = computeEffectiveStops([fixed(36.92, 600)], null, OPENED, [
      sell(300, 36.92, 5),
    ]);
    expect(effective).toEqual([fixed(36.92, 300)]);
  });

  it('consumes a trailing tier only after every priced tier is exhausted', () => {
    // A trailing tier has no fixed price to compare a fill against (it moves
    // with the market), so it cannot be matched on proximity and must not
    // win the "closest" contest by default.
    const effective = computeEffectiveStops(
      [trailing(8.5, 400), fixed(36.92, 600)],
      RECORDED,
      OPENED,
      [sell(600, 36.92, 15)],
    );
    expect(effective).toEqual([trailing(8.5, 400)]);
  });

  it('stops at zero when more is sold than every tier covers', () => {
    // Over-selling past the plan leaves nothing to consume rather than
    // producing negative coverage.
    const effective = computeEffectiveStops([fixed(36.92, 600)], RECORDED, OPENED, [
      sell(900, 36.92, 15),
    ]);
    expect(effective).toEqual([]);
  });

  it('applies successive fills oldest first', () => {
    // Order matters: each fill consumes from what the previous one left.
    const effective = computeEffectiveStops(
      [fixed(36.92, 600), fixed(30.39, 550)],
      RECORDED,
      OPENED,
      [sell(600, 36.92, 15), sell(300, 30.39, 20)],
    );
    expect(effective).toEqual([fixed(30.39, 250)]);
  });

  it('does not mutate the recorded tiers it was given', () => {
    // The whole design rests on the recorded plan surviving untouched —
    // this is derivation, not deletion. If this ever fails, a wrong
    // inference becomes permanent and the owner's audit trail is gone.
    const recorded = [fixed(36.92, 600), fixed(30.39, 550)];
    computeEffectiveStops(recorded, RECORDED, OPENED, [sell(600, 36.92, 15)]);
    expect(recorded).toEqual([fixed(36.92, 600), fixed(30.39, 550)]);
  });
});

describe('suggestTierForFill', () => {
  const tiers = [
    { id: 'a', kind: 'FIXED' as const, price: 36.92, trailPercent: null, quantity: 600 },
    { id: 'b', kind: 'FIXED' as const, price: 30.39, trailPercent: null, quantity: 550 },
  ];

  it('picks the tier nearest the fill price', () => {
    expect(suggestTierForFill(tiers, 36.92)).toBe('a');
    expect(suggestTierForFill(tiers, 30.5)).toBe('b');
  });

  it('returns null when no tier has a resolvable price', () => {
    expect(
      suggestTierForFill(
        [{ id: 'c', kind: 'TRAILING', price: null, trailPercent: 11.9, quantity: 100 }],
        123.07,
      ),
    ).toBeNull();
  });

  it('returns null for an empty plan', () => {
    expect(suggestTierForFill([], 10)).toBeNull();
  });
});
