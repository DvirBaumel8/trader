import { computeStopDistances, type StopDistanceInput } from './stop-distance.js';
import type { StopLevelInput } from './risk.js';

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

const base: Omit<StopDistanceInput, 'levels' | 'direction' | 'avgEntry'> = {
  symbol: 'NVDA',
  currentPrice: 100,
  session: 'REGULAR',
  extended: false,
  stale: false,
};

describe('computeStopDistances', () => {
  it('reports room for a long with the stop below price', () => {
    const rows = computeStopDistances([
      { ...base, direction: 'LONG', avgEntry: 90, levels: [fixed(95, 10)] },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].distance).toBe(0.05); // (100-95)/100
    expect(rows[0].passed).toBe(false);
    expect(rows[0].stopPrice).toBe(95);
    expect(rows[0].quantity).toBe(10);
  });

  it('flags a long stop already above the current price as passed, not a small negative', () => {
    const rows = computeStopDistances([
      { ...base, direction: 'LONG', avgEntry: 90, levels: [fixed(105, 10)] },
    ]);
    expect(rows[0].passed).toBe(true);
    expect(rows[0].distance).toBeCloseTo(-0.05); // (100-105)/100
  });

  it('reports room for a short with the stop above price', () => {
    const rows = computeStopDistances([
      {
        ...base,
        currentPrice: 300,
        direction: 'SHORT',
        avgEntry: 310,
        levels: [fixed(320, 5)],
      },
    ]);
    expect(rows[0].passed).toBe(false);
    expect(rows[0].distance).toBeCloseTo((320 - 300) / 300);
  });

  it('flags a short stop already below the current price as passed', () => {
    const rows = computeStopDistances([
      {
        ...base,
        currentPrice: 300,
        direction: 'SHORT',
        avgEntry: 310,
        levels: [fixed(290, 5)],
      },
    ]);
    expect(rows[0].passed).toBe(true);
    expect(rows[0].distance).toBeCloseTo((290 - 300) / 300);
  });

  it('produces one row per tier for a scaled position', () => {
    const rows = computeStopDistances([
      {
        symbol: 'BITX',
        currentPrice: 18,
        session: 'REGULAR',
        extended: false,
        stale: false,
        direction: 'LONG',
        avgEntry: 17,
        levels: [fixed(17.46, 50), fixed(17.07, 50)],
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.stopPrice)).toEqual([17.46, 17.07]);
    expect(rows.map((r) => r.quantity)).toEqual([50, 50]);
    // Nearer tier (17.46) has the smaller distance.
    expect(rows[0].distance).toBeLessThan(rows[1].distance);
  });

  it('produces no rows for a position with no stop', () => {
    const rows = computeStopDistances([
      { ...base, direction: 'LONG', avgEntry: 90, levels: [] },
    ]);
    expect(rows).toEqual([]);
  });

  it('resolves a trailing stop from the entry price, same as risk.ts', () => {
    const rows = computeStopDistances([
      { ...base, direction: 'LONG', avgEntry: 90, levels: [trailing(8, 10)] },
    ]);
    // implied stop = 90 * 0.92 = 82.8; distance = (100-82.8)/100
    expect(rows[0].stopPrice).toBeCloseTo(82.8);
    expect(rows[0].distance).toBeCloseTo((100 - 82.8) / 100);
    expect(rows[0].passed).toBe(false);
  });

  it('skips a position with no live price rather than guessing', () => {
    const rows = computeStopDistances([
      { ...base, currentPrice: null, direction: 'LONG', avgEntry: 90, levels: [fixed(95, 10)] },
    ]);
    expect(rows).toEqual([]);
  });

  it('carries session, extended and stale through for the UI badge', () => {
    const rows = computeStopDistances([
      {
        ...base,
        session: 'PRE',
        extended: true,
        stale: true,
        direction: 'LONG',
        avgEntry: 90,
        levels: [fixed(95, 10)],
      },
    ]);
    expect(rows[0].session).toBe('PRE');
    expect(rows[0].extended).toBe(true);
    expect(rows[0].stale).toBe(true);
  });

  it('skips an invalid tier (zero quantity) without throwing', () => {
    const rows = computeStopDistances([
      { ...base, direction: 'LONG', avgEntry: 90, levels: [fixed(95, 0)] },
    ]);
    expect(rows).toEqual([]);
  });
});
