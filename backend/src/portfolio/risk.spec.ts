import {
  computeRisk,
  computeRiskFromCurrentPrice,
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

  it('ignores a fixed level on the wrong side of the entry', () => {
    // A "stop" above entry on a long is a typo, not a stop. Counting it would
    // report negative risk, which is nonsense.
    const r = computeRisk({
      avgEntry: 217,
      quantity: 100,
      levels: [fixed(230, 100)],
    });
    expect(r.amount).toBeNull();
    expect(r.invalidLevels).toBe(1);
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

  it('implies a trailing stop price from the entry, then prices it from here', () => {
    // Trail 8% below entry of 217 => implied stop 199.64. Now at 250.
    const r = computeRiskFromCurrentPrice({
      avgEntry: 217,
      currentPrice: 250,
      quantity: 100,
      levels: [trailing(8, 100)],
    });
    expect(r.amount).toBeCloseTo((250 - 217 * 0.92) * 100, 6);
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

  it('does not skip a stop above current price the way computeRisk skips one above entry', () => {
    // Same inputs computeRisk would call invalid (stop on the "wrong" side of
    // entry) are valid and countable here, because the reference is the
    // current price, not the entry.
    const atEntry = computeRisk({
      avgEntry: 217,
      quantity: 100,
      levels: [fixed(230, 100)],
    });
    expect(atEntry.amount).toBeNull();
    expect(atEntry.invalidLevels).toBe(1);

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
  });
});
