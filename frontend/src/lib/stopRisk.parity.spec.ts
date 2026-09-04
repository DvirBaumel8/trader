import { describe, expect, it } from 'vitest';
import { draftRisk, type StopRow } from './stopRisk';
// Reaching into the backend's source on purpose. This is the one test that
// exists to compare the two implementations, so it has to see both.
import { computeRisk } from '../../../backend/src/portfolio/risk';

/**
 * The two implementations of the same rule must agree.
 *
 * `draftRisk` is not redundant: it computes over half-typed strings as the
 * owner types, with no round-trip to the server, which the backend's
 * `computeRisk` cannot do. So the duplication is deliberate — but it is
 * duplication, and it drifted. A stop above entry that locks in a gain was
 * treated as no coverage in BOTH, and the fix had to be made twice; nothing
 * would have caught it if only one had been fixed.
 *
 * This turns that silent drift into a failing test. If the rule changes on
 * one side only, this breaks and names the case.
 */
const rows = (
  ...levels: Array<[kind: 'FIXED' | 'TRAILING', value: number, qty: number]>
): StopRow[] =>
  levels.map(([kind, value, qty]) => ({
    kind,
    price: kind === 'FIXED' ? String(value) : '',
    trailPercent: kind === 'TRAILING' ? String(value) : '',
    quantity: String(qty),
  }));

const cases: Array<{
  name: string;
  entry: number;
  quantity: number;
  side: 'BUY' | 'SELL';
  levels: Array<[kind: 'FIXED' | 'TRAILING', value: number, qty: number]>;
}> = [
  {
    name: 'a single fixed stop below entry',
    entry: 100,
    quantity: 100,
    side: 'BUY',
    levels: [['FIXED', 90, 100]],
  },
  {
    name: 'two tiers, one of them locking in a gain',
    // The META plan that exposed the drift.
    entry: 593.49,
    quantity: 46,
    side: 'BUY',
    levels: [
      ['FIXED', 572.68, 20],
      ['FIXED', 602.93, 26],
    ],
  },
  {
    name: 'every tier locking in a gain',
    entry: 100,
    quantity: 100,
    side: 'BUY',
    levels: [['FIXED', 120, 100]],
  },
  {
    name: 'a percentage trail',
    entry: 100,
    quantity: 100,
    side: 'BUY',
    levels: [['TRAILING', 10, 100]],
  },
  {
    name: 'a short, where the stop sits above entry',
    entry: 100,
    quantity: 100,
    side: 'SELL',
    levels: [['FIXED', 110, 100]],
  },
  {
    name: 'partial coverage',
    entry: 100,
    quantity: 100,
    side: 'BUY',
    levels: [['FIXED', 90, 40]],
  },
  {
    name: 'tiers overshooting the position',
    entry: 100,
    quantity: 100,
    side: 'BUY',
    levels: [
      ['FIXED', 90, 80],
      ['FIXED', 95, 80],
    ],
  },
];

describe('draftRisk agrees with the backend computeRisk', () => {
  for (const c of cases) {
    it(c.name, () => {
      const front = draftRisk(
        String(c.entry),
        String(c.quantity),
        rows(...c.levels),
        c.side,
      );
      const back = computeRisk({
        avgEntry: c.entry,
        quantity: c.quantity,
        direction: c.side === 'BUY' ? 'LONG' : 'SHORT',
        levels: c.levels.map(([kind, value, qty]) => ({
          kind,
          price: kind === 'FIXED' ? value : null,
          trailPercent: kind === 'TRAILING' ? value : null,
          quantity: qty,
        })),
      });

      // The dollar figure is rounded differently on each side (cents in the
      // UI, eight places in the domain), so compare to the cent.
      if (front.amount === null || back.amount === null) {
        expect(front.amount === null).toBe(back.amount === null);
      } else {
        expect(front.amount).toBeCloseTo(back.amount, 2);
      }
      expect(front.covered).toBeCloseTo(back.coveredQuantity, 6);
      expect(front.fullyCovered).toBe(back.fullyCovered);
    });
  }
});
