import { computeRisk, type StopLevelInput } from './risk.js';

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
