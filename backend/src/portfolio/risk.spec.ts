import {
  computeFavorablePrice,
  computeRisk,
  computeRiskFromCurrentPrice,
  evaluateStopPlan,
  resolveStopPrice,
  type StopLevelInput,
} from './risk.js';

const fixed = (price: number, quantity: number): StopLevelInput => ({
  kind: 'FIXED',
  price,
  trailPercent: null,
  quantity,
});
const trailing = (trailPercent: number, quantity: number): StopLevelInput => ({
  kind: 'TRAILING',
  price: null,
  trailPercent,
  quantity,
});

describe('computeFavorablePrice', () => {
  it('ratchets a long trail up to the highest bar since entry', () => {
    // ONDS-style: price ran up since entry then pulled back — the favorable
    // price is the high-water mark (110), not today's price (105).
    const p = computeFavorablePrice(
      [{ high: 90, low: 85 }, { high: 110, low: 100 }, { high: 108, low: 103 }],
      'LONG',
      105,
    );
    expect(p).toBe(110);
  });

  it('holds a long trail at the high-water mark rather than sliding back with price', () => {
    // Ran to 110, fell back to 95 — the mark must stay 110, never drop.
    const p = computeFavorablePrice(
      [{ high: 90, low: 85 }, { high: 110, low: 100 }],
      'LONG',
      95,
    );
    expect(p).toBe(110);
  });

  it('folds in the current price when it exceeds every recorded bar', () => {
    // Today's bar has not been backfilled yet, but price is already higher.
    const p = computeFavorablePrice([{ high: 90, low: 85 }], 'LONG', 95);
    expect(p).toBe(95);
  });

  it('ratchets a short trail down to the lowest bar since entry', () => {
    const p = computeFavorablePrice(
      [{ high: 65, low: 60 }, { high: 58, low: 50 }, { high: 55, low: 52 }],
      'SHORT',
      54,
    );
    expect(p).toBe(50);
  });

  it('holds a short trail at the low-water mark rather than rising back with price', () => {
    // Fell to 50, bounced to 62 — the mark must stay 50, never rise.
    const p = computeFavorablePrice(
      [{ high: 65, low: 60 }, { high: 58, low: 50 }],
      'SHORT',
      62,
    );
    expect(p).toBe(50);
  });

  it('is null with no bars and no current price', () => {
    expect(computeFavorablePrice([], 'LONG', null)).toBeNull();
  });
});

describe('resolveStopPrice', () => {
  const trailing = (trailPercent: number): StopLevelInput => ({
    kind: 'TRAILING',
    price: null,
    trailPercent,
    quantity: 10,
  });

  it('resolves a long trail from the high-water price, ratcheted up since entry', () => {
    // Entry 90, price ran to 110: 8% trail sits at 110*0.92 = 101.2, not
    // 90*0.92 = 82.8.
    const price = resolveStopPrice(trailing(8), 'LONG', 110);
    expect(price).toBeCloseTo(101.2);
  });

  it('holds a long trail at the price implied by the high-water mark after a pullback', () => {
    // The high-water price itself already reflects "holds at the peak" (see
    // computeFavorablePrice) — resolveStopPrice just applies the percentage
    // to whatever it is handed.
    const price = resolveStopPrice(trailing(8), 'LONG', 110);
    expect(price).toBeCloseTo(101.2);
    expect(price).toBeGreaterThan(90 * 0.92); // never the entry-anchored level
  });

  it('resolves a short trail from the low-water price, ratcheted down since entry', () => {
    // Entry 60, price fell to 50: 10% trail sits at 50*1.10 = 55, not
    // 60*1.10 = 66.
    const price = resolveStopPrice(trailing(10), 'SHORT', 50);
    expect(price).toBeCloseTo(55);
  });

  it('returns null for a trailing level with no high-water price available', () => {
    expect(resolveStopPrice(trailing(8), 'LONG', null)).toBeNull();
  });

  it('does not need a high-water price for a FIXED level', () => {
    const fixed: StopLevelInput = {
      kind: 'FIXED',
      price: 82.8,
      trailPercent: null,
      quantity: 10,
    };
    expect(resolveStopPrice(fixed, 'LONG', null)).toBe(82.8);
  });
});

describe('computeRisk', () => {
  it('is null with no stop levels', () => {
    const r = computeRisk({ avgEntry: 217, quantity: 100, levels: [] });
    expect(r.amount).toBeNull();
    expect(r.coveredQuantity).toBe(0);
  });

  it('computes a single fixed stop on a long', () => {
    const r = computeRisk({
      avgEntry: 217,
      quantity: 100,
      levels: [fixed(205, 100)],
    });
    expect(r.amount).toBe(1200);
    expect(r.coveredQuantity).toBe(100);
    expect(r.fullyCovered).toBe(true);
  });

  it('sums a tiered exit', () => {
    // 50 out at 205 (-12) and 50 at 195 (-22)
    const r = computeRisk({
      avgEntry: 217,
      quantity: 100,
      levels: [fixed(205, 50), fixed(195, 50)],
    });
    expect(r.amount).toBe(600 + 1100);
  });

  it('computes a percentage trail from the entry price', () => {
    // A trailing stop starts trailPercent below entry, so risk at entry is known.
    const r = computeRisk({
      avgEntry: 217,
      quantity: 100,
      levels: [trailing(8, 100)],
    });
    expect(r.amount).toBe(1736); // 217 * 0.08 * 100
  });

  it('mixes fixed and trailing tiers', () => {
    const r = computeRisk({
      avgEntry: 217,
      quantity: 100,
      levels: [fixed(205, 50), trailing(8, 50)],
    });
    expect(r.amount).toBe(600 + 868);
  });

  it('reports partial coverage rather than understating risk silently', () => {
    const r = computeRisk({
      avgEntry: 217,
      quantity: 150,
      levels: [fixed(205, 100)],
    });
    expect(r.amount).toBe(1200);
    expect(r.coveredQuantity).toBe(100);
    expect(r.fullyCovered).toBe(false);
  });

  it('works for a short, where the stop sits above the entry', () => {
    const r = computeRisk({
      avgEntry: 300,
      quantity: 10,
      levels: [fixed(320, 10)],
      direction: 'SHORT',
    });
    expect(r.amount).toBe(200);
  });

  it('trails a short upward from entry', () => {
    const r = computeRisk({
      avgEntry: 300,
      quantity: 10,
      levels: [trailing(10, 10)],
      direction: 'SHORT',
    });
    expect(r.amount).toBe(300); // 300 * 0.10 * 10
  });

  it('counts a stop beyond entry as covered, at zero risk', () => {
    // A stop above entry on a long locks in a gain. It is a real stop, so it
    // covers its shares — but it contributes no risk, and must never net
    // against real risk elsewhere and shrink it.
    const r = computeRisk({
      avgEntry: 217,
      quantity: 100,
      levels: [fixed(230, 100)],
    });
    expect(r.amount).toBe(0);
    expect(r.coveredQuantity).toBe(100);
    expect(r.fullyCovered).toBe(true);
    expect(r.invalidLevels).toBe(0);
  });

  it('reports full coverage for a winner half-stopped at a gain', () => {
    // The real META plan that exposed this: 46 shares in at 593.49, one tier
    // of 20 at 572.68 and one of 26 at 602.93. Every share has a stop, and
    // the risk is only what the losing tier can cost.
    const r = computeRisk({
      avgEntry: 593.49,
      quantity: 46,
      levels: [fixed(572.68, 20), fixed(602.93, 26)],
    });
    expect(r.coveredQuantity).toBe(46);
    expect(r.fullyCovered).toBe(true);
    expect(r.invalidLevels).toBe(0);
    // (593.49 - 572.68) * 20, with the profit-locking tier adding nothing.
    expect(r.amount).toBeCloseTo(416.2, 6);
  });

  it('ignores a level with no usable price or percent', () => {
    const r = computeRisk({
      avgEntry: 217,
      quantity: 100,
      levels: [
        { kind: 'FIXED', price: null, trailPercent: null, quantity: 100 },
      ],
    });
    expect(r.amount).toBeNull();
    expect(r.invalidLevels).toBe(1);
  });

  it('ignores a zero or negative trail percent', () => {
    const r = computeRisk({
      avgEntry: 217,
      quantity: 100,
      levels: [trailing(0, 100)],
    });
    expect(r.amount).toBeNull();
  });

  it('ignores a level with zero quantity', () => {
    const r = computeRisk({
      avgEntry: 217,
      quantity: 100,
      levels: [fixed(205, 0)],
    });
    expect(r.amount).toBeNull();
    expect(r.coveredQuantity).toBe(0);
  });

  it('caps coverage at the position size when tiers overshoot', () => {
    // Over-covering is a data error; risk still counts only real shares.
    const r = computeRisk({
      avgEntry: 217,
      quantity: 100,
      levels: [fixed(205, 80), fixed(195, 80)],
    });
    expect(r.coveredQuantity).toBe(100);
    expect(r.overCovered).toBe(true);
    // The dollar figure is scaled down by the same ratio as the share count
    // (100/160), not left at the raw sum over 160 shares that were never
    // all held at once: 12*80 + 22*80 = 2720, scaled by 100/160 = 1700.
    expect(r.amount).toBe(1700);
  });

  it('reports zero coverage and null risk for a fully closed position', () => {
    // Held quantity 0: a stop cannot protect shares that are gone. This is
    // the SMCI/BITX/MRNA-style bug — tiers survive the shares they
    // protected because they attach to the opening fill and are never
    // reconciled when the position later changes.
    const r = computeRisk({
      avgEntry: 217,
      quantity: 0,
      levels: [fixed(205, 100)],
    });
    expect(r.amount).toBeNull();
    expect(r.coveredQuantity).toBe(0);
    expect(r.fullyCovered).toBe(false);
    expect(r.overCovered).toBe(true);
  });
});

describe('computeRiskFromCurrentPrice', () => {
  it('is null with no stop levels', () => {
    const r = computeRiskFromCurrentPrice({
      avgEntry: 217,
      currentPrice: 230,
      quantity: 100,
      levels: [],
    });
    expect(r.amount).toBeNull();
    expect(r.coveredQuantity).toBe(0);
  });

  it('prices a long stop against the current price, not the entry', () => {
    // Entry 217, now trading at 250, stop still at 205: risk from here is
    // 250 - 205, not 217 - 205.
    const r = computeRiskFromCurrentPrice({
      avgEntry: 217,
      currentPrice: 250,
      quantity: 100,
      levels: [fixed(205, 100)],
    });
    expect(r.amount).toBe(4500);
    expect(r.fullyCovered).toBe(true);
  });

  it('prices a short stop against the current price', () => {
    const r = computeRiskFromCurrentPrice({
      avgEntry: 300,
      currentPrice: 280,
      quantity: 10,
      levels: [fixed(320, 10)],
      direction: 'SHORT',
    });
    expect(r.amount).toBe(400); // 320 - 280, times 10
  });

  it('reports partial coverage, same as computeRisk', () => {
    const r = computeRiskFromCurrentPrice({
      avgEntry: 217,
      currentPrice: 230,
      quantity: 150,
      levels: [fixed(205, 100)],
    });
    expect(r.amount).toBe(2500); // (230 - 205) * 100
    expect(r.coveredQuantity).toBe(100);
    expect(r.fullyCovered).toBe(false);
  });

  it('implies a trailing stop price from the high-water mark, then prices it from here', () => {
    // Price ran up to 260 since entry (217), then pulled back to 250. Trail
    // 8% below the HIGH-WATER price (260), not the entry (217).
    const r = computeRiskFromCurrentPrice({
      avgEntry: 217,
      currentPrice: 250,
      quantity: 100,
      levels: [trailing(8, 100)],
      highWaterPrice: 260,
    });
    expect(r.amount).toBeCloseTo((250 - 260 * 0.92) * 100, 6);
  });

  it('treats an unresolved trailing level (no high-water price) as invalid, not entry-anchored', () => {
    const r = computeRiskFromCurrentPrice({
      avgEntry: 217,
      currentPrice: 250,
      quantity: 100,
      levels: [trailing(8, 100)],
    });
    expect(r.amount).toBeNull();
    expect(r.invalidLevels).toBe(1);
  });

  it('goes negative when a raised stop sits above the current price on a long', () => {
    // A trail walked up to lock in profit: stop at 240, price has since
    // pulled back to 230. If it hits, that is a further $10/share GAIN from
    // here, not a loss — the whole point of the feature.
    const r = computeRiskFromCurrentPrice({
      avgEntry: 217,
      currentPrice: 230,
      quantity: 100,
      levels: [fixed(240, 100)],
    });
    expect(r.amount).toBe(-1000);
  });

  it('lets its figure go negative where computeRisk floors the same level at zero', () => {
    // Both now COUNT a stop beyond entry; they differ in what they let it do
    // to the dollar figure. Risk at entry is floored at zero so a profit lock
    // cannot shrink the number R is measured against; risk from here is
    // allowed to go negative, because "this position can no longer lose" is
    // exactly what that question is asking.
    const atEntry = computeRisk({
      avgEntry: 217,
      quantity: 100,
      levels: [fixed(230, 100)],
    });
    expect(atEntry.amount).toBe(0);
    expect(atEntry.invalidLevels).toBe(0);

    const fromHere = computeRiskFromCurrentPrice({
      avgEntry: 217,
      currentPrice: 225,
      quantity: 100,
      levels: [fixed(230, 100)],
    });
    expect(fromHere.amount).toBe(-500);
    expect(fromHere.invalidLevels).toBe(0);
  });

  it('still treats an unusable level as invalid', () => {
    const r = computeRiskFromCurrentPrice({
      avgEntry: 217,
      currentPrice: 230,
      quantity: 100,
      levels: [
        { kind: 'FIXED', price: null, trailPercent: null, quantity: 100 },
      ],
    });
    expect(r.amount).toBeNull();
    expect(r.invalidLevels).toBe(1);
  });

  it('caps coverage at the position size when tiers overshoot', () => {
    const r = computeRiskFromCurrentPrice({
      avgEntry: 217,
      currentPrice: 230,
      quantity: 100,
      levels: [fixed(205, 80), fixed(195, 80)],
    });
    expect(r.coveredQuantity).toBe(100);
    expect(r.overCovered).toBe(true);
    // (230-205)*80 + (230-195)*80 = 4800, scaled by 100/160 = 3000.
    expect(r.amount).toBe(3000);
  });

  it('contributes no risk at all once the position is fully closed', () => {
    const r = computeRiskFromCurrentPrice({
      avgEntry: 217,
      currentPrice: 230,
      quantity: 0,
      levels: [fixed(205, 100)],
    });
    expect(r.amount).toBeNull();
    expect(r.coveredQuantity).toBe(0);
  });
});

describe('evaluateStopPlan', () => {
  const long = (qty: number, price: number): StopLevelInput =>
    fixed(price, qty);

  it('needs no update for a normal, untouched position', () => {
    const status = evaluateStopPlan({
      heldQuantity: 100,
      recordedDirection: 'LONG',
      levels: [long(100, 205)],
    });
    expect(status.needsUpdate).toBe(false);
    expect(status.issue).toBeNull();
    expect(status.recordedQuantity).toBe(100);
    expect(status.heldQuantity).toBe(100);
  });

  it('needs no update when tiers exactly match holdings', () => {
    const status = evaluateStopPlan({
      heldQuantity: 550,
      recordedDirection: 'LONG',
      levels: [long(550, 30.39)],
    });
    expect(status.needsUpdate).toBe(false);
    expect(status.issue).toBeNull();
  });

  it('flags a fully closed position that still carries tiers', () => {
    // BITX/BMNR/MSTR: held 0, but the opening fill's stops were never
    // reconciled away.
    const status = evaluateStopPlan({
      heldQuantity: 0,
      recordedDirection: 'LONG',
      levels: [long(1800, 17.46)],
    });
    expect(status.needsUpdate).toBe(true);
    expect(status.issue).toBe('CLOSED_WITH_STOPS');
    expect(status.recordedQuantity).toBe(1800);
    expect(status.heldQuantity).toBe(0);
  });

  it('flags a partial exit where tiers exceed holdings', () => {
    // SMCI: 1150 opened with two tiers (600 @ 36.92, 550 @ 30.39); the 600
    // executed via a SELL, 550 remain, but both tiers are still on record.
    const status = evaluateStopPlan({
      heldQuantity: 550,
      recordedDirection: 'LONG',
      levels: [long(600, 36.92), long(550, 30.39)],
    });
    expect(status.needsUpdate).toBe(true);
    expect(status.issue).toBe('OVER_COVERED');
    expect(status.recordedQuantity).toBe(1150);
    expect(status.heldQuantity).toBe(550);
  });

  it('flags a short whose tiers were recorded while long', () => {
    // MRNA: net -200 now, first recorded short, but its 400-share tier was
    // written back when the position was long.
    const status = evaluateStopPlan({
      heldQuantity: -200,
      recordedDirection: 'LONG',
      levels: [long(400, 60)],
    });
    expect(status.needsUpdate).toBe(true);
    expect(status.issue).toBe('DIRECTION_MISMATCH');
    expect(status.recordedQuantity).toBe(400);
    expect(status.heldQuantity).toBe(200);
  });

  it('needs no update with no tiers recorded at all', () => {
    const status = evaluateStopPlan({
      heldQuantity: 100,
      recordedDirection: 'LONG',
      levels: [],
    });
    expect(status.needsUpdate).toBe(false);
    expect(status.issue).toBeNull();
    expect(status.recordedQuantity).toBe(0);
  });

  it('flags a trailing tier that has no high-water price to resolve against', () => {
    const status = evaluateStopPlan({
      heldQuantity: 1000,
      recordedDirection: 'LONG',
      levels: [
        { kind: 'TRAILING', price: null, trailPercent: 8.5, quantity: 1000 },
      ],
      hasUnresolvedTrailing: true,
    });
    expect(status.needsUpdate).toBe(true);
    expect(status.issue).toBe('UNRESOLVED_TRAILING');
  });

  it('does not flag an unresolved trailing when a more specific issue already applies', () => {
    // Over-covered takes priority: the coverage problem is real regardless
    // of whether the trailing price happens to be resolvable too.
    const status = evaluateStopPlan({
      heldQuantity: 550,
      recordedDirection: 'LONG',
      levels: [long(600, 36.92), long(550, 30.39)],
      hasUnresolvedTrailing: true,
    });
    expect(status.issue).toBe('OVER_COVERED');
  });
});

describe('computeFavorablePrice with extended hours', () => {
  const bars = [{ high: 19.21, low: 17.0 }];

  it('ratchets a long trail up to an extended-hours high', () => {
    // The real BITX case: the regular session topped at 19.21 while the stock
    // printed 19.58 outside hours. Trailing 9.8% from 19.21 gives 17.33; from
    // 19.58 it gives 17.66, which is what his broker showed.
    expect(computeFavorablePrice(bars, 'LONG', 18.24, 19.58)).toBeCloseTo(19.58, 6);
  });

  it('ignores an extended print that is worse than the session high', () => {
    expect(computeFavorablePrice(bars, 'LONG', 18.24, 18.9)).toBeCloseTo(19.21, 6);
  });

  it('takes the extended LOW for a short', () => {
    expect(computeFavorablePrice(bars, 'SHORT', 18.0, 16.4)).toBeCloseTo(16.4, 6);
  });

  it('is unchanged when nothing extended is known', () => {
    // Null, not zero: an unknown extreme must not drag a short's trail to 0.
    expect(computeFavorablePrice(bars, 'LONG', 18.24, null)).toBeCloseTo(19.21, 6);
    expect(computeFavorablePrice(bars, 'SHORT', 18.0, null)).toBeCloseTo(17.0, 6);
  });
});
