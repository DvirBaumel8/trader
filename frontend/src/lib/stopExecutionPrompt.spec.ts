import { describe, expect, it } from 'vitest';
import { shouldAskAboutStop, defaultTierId } from './stopExecutionPrompt';

describe('shouldAskAboutStop', () => {
  it('asks when a sale reduces a long that has tiers', () => {
    expect(
      shouldAskAboutStop({ signedQuantity: -100, heldQuantity: 100, tierCount: 2 }),
    ).toBe(true);
  });

  it('asks when a covering buy reduces a short', () => {
    expect(
      shouldAskAboutStop({ signedQuantity: 100, heldQuantity: -100, tierCount: 1 }),
    ).toBe(true);
  });

  it('does not ask when the fill adds to a long', () => {
    expect(
      shouldAskAboutStop({ signedQuantity: 100, heldQuantity: 100, tierCount: 2 }),
    ).toBe(false);
  });

  it('does not ask when the fill adds to a short', () => {
    expect(
      shouldAskAboutStop({ signedQuantity: -100, heldQuantity: -100, tierCount: 2 }),
    ).toBe(false);
  });

  it('does not ask when there are no tiers to attribute the exit to', () => {
    expect(
      shouldAskAboutStop({ signedQuantity: -100, heldQuantity: 100, tierCount: 0 }),
    ).toBe(false);
  });

  it('does not ask when nothing is held — this fill opens the position', () => {
    expect(
      shouldAskAboutStop({ signedQuantity: -100, heldQuantity: 0, tierCount: 2 }),
    ).toBe(false);
  });
});

describe('defaultTierId', () => {
  const tiers = [
    { id: 'a', price: 36.92, trailPercent: null },
    { id: 'b', price: 30.39, trailPercent: null },
  ];

  it('pre-selects the tier nearest the fill price', () => {
    expect(defaultTierId(tiers, 36.9)).toBe('a');
    expect(defaultTierId(tiers, 30.5)).toBe('b');
  });

  it('pre-selects nothing when every tier is trailing', () => {
    // The MSTR case: a trailing tier's live level depends on the high-water
    // mark, which this form does not have. A single-candidate matcher would
    // always pick it and would have been wrong.
    expect(
      defaultTierId([{ id: 'c', price: null, trailPercent: 11.9 }], 123.07),
    ).toBeNull();
  });

  it('skips trailing tiers but still picks a priced one', () => {
    expect(
      defaultTierId(
        [
          { id: 'c', price: null, trailPercent: 11.9 },
          { id: 'd', price: 100, trailPercent: null },
        ],
        99,
      ),
    ).toBe('d');
  });

  it('pre-selects nothing for an empty plan', () => {
    expect(defaultTierId([], 10)).toBeNull();
  });
});
