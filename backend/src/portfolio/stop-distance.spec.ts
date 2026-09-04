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
  highWaterPrice: null,
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
        highWaterPrice: null,
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

  it('resolves a trailing stop from the high-water price, not the entry price', () => {
    const rows = computeStopDistances([
      {
        ...base,
        direction: 'LONG',
        avgEntry: 90,
        highWaterPrice: 110, // price ran up to 110 since entry
        levels: [trailing(8, 10)],
      },
    ]);
    // implied stop = 110 * 0.92 = 101.2, not 90 * 0.92 = 82.8.
    expect(rows[0].stopPrice).toBeCloseTo(101.2);
    expect(rows[0].distance).toBeCloseTo((100 - 101.2) / 100);
    expect(rows[0].passed).toBe(true); // price (100) has fallen back through it
  });

  it('produces no row for a trailing tier with no high-water price to resolve against', () => {
    // A wrong stop level is worse than an absent one — see resolveStopPrice.
    const rows = computeStopDistances([
      {
        ...base,
        direction: 'LONG',
        avgEntry: 90,
        highWaterPrice: null,
        levels: [trailing(8, 10)],
      },
    ]);
    expect(rows).toEqual([]);
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

describe('amountAtRisk', () => {
  it('is (current - stop) x quantity for a long', () => {
    const [row] = computeStopDistances([
      {
        symbol: 'SMCI',
        direction: 'LONG',
        avgEntry: 32,
        currentPrice: 36.7,
        session: 'REGULAR',
        extended: false,
        stale: false,
        highWaterPrice: null,
        levels: [{ kind: 'FIXED', price: 30.39, trailPercent: null, quantity: 550 }],
      },
    ]);
    expect(row.amountAtRisk).toBeCloseTo((36.7 - 30.39) * 550, 6);
  });

  it('is (stop - current) x quantity for a short', () => {
    const [row] = computeStopDistances([
      {
        symbol: 'MRNA',
        direction: 'SHORT',
        avgEntry: 146.43,
        currentPrice: 100,
        session: 'REGULAR',
        extended: false,
        stale: false,
        highWaterPrice: null,
        levels: [{ kind: 'FIXED', price: 110, trailPercent: null, quantity: 50 }],
      },
    ]);
    expect(row.amountAtRisk).toBeCloseTo((110 - 100) * 50, 6);
  });

  it('goes negative when the stop has already been passed', () => {
    const [row] = computeStopDistances([
      {
        symbol: 'BE',
        direction: 'LONG',
        avgEntry: 206,
        currentPrice: 200,
        session: 'REGULAR',
        extended: false,
        stale: false,
        highWaterPrice: null,
        levels: [{ kind: 'FIXED', price: 207.08, trailPercent: null, quantity: 45 }],
      },
    ]);
    expect(row.passed).toBe(true);
    expect(row.amountAtRisk).toBeLessThan(0);
    expect(row.amountAtRisk).toBeCloseTo((200 - 207.08) * 45, 6);
  });
});

describe('trail traceability', () => {
  it('says what a trailing tier trails from', () => {
    // The row shows "$17.66" and "now $18.24" and invites subtracting them.
    // For a trail the stop is derived, so that subtraction disagrees with the
    // figures beside it — showing the basis makes it checkable.
    const [row] = computeStopDistances([
      {
        symbol: 'BITX',
        direction: 'LONG',
        avgEntry: 13.29,
        currentPrice: 18.24,
        session: 'REGULAR',
        extended: false,
        stale: false,
        highWaterPrice: 19.58,
        levels: [
          { kind: 'TRAILING', price: null, trailPercent: 9.8, quantity: 1000 },
        ],
      },
    ]);

    expect(row.trailPercent).toBe(9.8);
    expect(row.trailsFrom).toBeCloseTo(19.58, 6);
    // 19.58 * (1 - 0.098) — the number the broker shows.
    expect(row.stopPrice).toBeCloseTo(17.66, 2);
  });

  it('leaves a fixed tier unexplained, because its price was typed', () => {
    const [row] = computeStopDistances([
      {
        symbol: 'META',
        direction: 'LONG',
        avgEntry: 593.49,
        currentPrice: 605,
        session: 'REGULAR',
        extended: false,
        stale: false,
        highWaterPrice: 619,
        levels: [
          { kind: 'FIXED', price: 572.68, trailPercent: null, quantity: 20 },
        ],
      },
    ]);

    expect(row.trailPercent).toBeNull();
    expect(row.trailsFrom).toBeNull();
  });
});
