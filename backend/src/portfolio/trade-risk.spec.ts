import { describe, expect, it } from 'vitest';
import { computeTradeRisk } from './trade-risk.js';

describe('computeTradeRisk', () => {
  it('reads a stop below and a target above as a long', () => {
    const r = computeTradeRisk({ entryPrice: 50, stop: 45, target: 65, usualRisk: 1500 })!;
    expect(r.direction).toBe('LONG');
    expect(r.riskPerShare).toBeCloseTo(5, 6);
    expect(r.rewardPerShare).toBeCloseTo(15, 6);
    expect(r.riskReward).toBeCloseTo(3, 6);
  });

  it('reads a stop above and a target below as a short', () => {
    const r = computeTradeRisk({ entryPrice: 50, stop: 55, target: 40, usualRisk: null })!;
    expect(r.direction).toBe('SHORT');
    expect(r.riskPerShare).toBeCloseTo(5, 6);
    expect(r.rewardPerShare).toBeCloseTo(10, 6);
    expect(r.riskReward).toBeCloseTo(2, 6);
  });

  it('sizes the position from the owner own average risk', () => {
    // $1,500 of risk at $5 a share is 300 shares, worth $15,000 at $50.
    const r = computeTradeRisk({ entryPrice: 50, stop: 45, target: 65, usualRisk: 1500 })!;
    expect(r.sharesAtUsualRisk).toBe(300);
    expect(r.positionValueAtUsualRisk).toBeCloseTo(15000, 6);
  });

  it('rounds the share count DOWN, never up', () => {
    // $1,000 at $3 a share is 333.33; 334 shares would risk more than he does.
    const r = computeTradeRisk({ entryPrice: 50, stop: 47, target: 60, usualRisk: 1000 })!;
    expect(r.sharesAtUsualRisk).toBe(333);
  });

  it('reports the average it sized against, which the rounded size understates', () => {
    const r = computeTradeRisk({ entryPrice: 50, stop: 47, target: 60, usualRisk: 1000 })!;
    // The caller can say "your usual $1,000" truthfully. Deriving it from the
    // rounded share count would give $999 — a wrong number wearing a precise
    // label, which is exactly what this field exists to prevent.
    expect(r.usualRisk).toBe(1000);
    expect(r.riskPerShare * r.sharesAtUsualRisk!).toBeCloseTo(999, 6);
  });

  it('reports no average when there was none to size against', () => {
    const r = computeTradeRisk({ entryPrice: 50, stop: 45, target: 65, usualRisk: null })!;
    expect(r.usualRisk).toBeNull();
  });

  it('offers no size when there is no recorded average risk to size against', () => {
    const r = computeTradeRisk({ entryPrice: 50, stop: 45, target: 65, usualRisk: null })!;
    expect(r.sharesAtUsualRisk).toBeNull();
    expect(r.positionValueAtUsualRisk).toBeNull();
  });

  it('refuses incoherent levels rather than inventing a direction', () => {
    // Both below entry: this is not a trade, it is a typo.
    expect(
      computeTradeRisk({ entryPrice: 50, stop: 45, target: 40, usualRisk: 1500 }),
    ).toBeNull();
    // Both above.
    expect(
      computeTradeRisk({ entryPrice: 50, stop: 55, target: 65, usualRisk: 1500 }),
    ).toBeNull();
    // A stop AT the entry has no risk to divide by.
    expect(
      computeTradeRisk({ entryPrice: 50, stop: 50, target: 65, usualRisk: 1500 }),
    ).toBeNull();
  });

  it('refuses a non-positive price rather than returning Infinity', () => {
    expect(computeTradeRisk({ entryPrice: 0, stop: 45, target: 65, usualRisk: 1500 })).toBeNull();
    expect(computeTradeRisk({ entryPrice: 50, stop: -1, target: 65, usualRisk: 1500 })).toBeNull();
  });
});
