import { describe, expect, it } from 'vitest';
import { resolvedStopLines, unresolvedTrailingStops } from './stopSummary';

describe('resolvedStopLines', () => {
  it('includes a fixed stop with its price as the label', () => {
    expect(
      resolvedStopLines([
        { kind: 'FIXED', resolvedPrice: 118.5, trailPercent: null },
      ]),
    ).toEqual([{ kind: 'FIXED', price: 118.5, label: '118.50' }]);
  });

  it('includes a trailing stop with its resolved price and trail percent in the label', () => {
    expect(
      resolvedStopLines([
        { kind: 'TRAILING', resolvedPrice: 15.02, trailPercent: 11.9 },
      ]),
    ).toEqual([
      { kind: 'TRAILING', price: 15.02, label: '15.02 (11.9% trail)' },
    ]);
  });

  it('drops a stop whose resolvedPrice is null — a trailing tier missing high-water data', () => {
    expect(
      resolvedStopLines([
        { kind: 'TRAILING', resolvedPrice: null, trailPercent: 11.9 },
      ]),
    ).toEqual([]);
  });

  it('drops a stop whose resolvedPrice is undefined — the API not yet shipping the field', () => {
    expect(
      resolvedStopLines([
        {
          kind: 'FIXED',
          resolvedPrice: undefined,
          trailPercent: null,
        },
      ]),
    ).toEqual([]);
  });

  it('sorts resolved lines highest price first, mixing kinds', () => {
    expect(
      resolvedStopLines([
        { kind: 'FIXED', resolvedPrice: 100, trailPercent: null },
        { kind: 'TRAILING', resolvedPrice: 150, trailPercent: 10 },
        { kind: 'FIXED', resolvedPrice: 90, trailPercent: null },
      ]).map((l) => l.price),
    ).toEqual([150, 100, 90]);
  });
});

describe('unresolvedTrailingStops', () => {
  it('keeps a trailing stop with a null resolvedPrice', () => {
    expect(
      unresolvedTrailingStops([
        { kind: 'TRAILING', resolvedPrice: null },
      ]),
    ).toEqual([{ kind: 'TRAILING', resolvedPrice: null }]);
  });

  it('keeps a trailing stop when resolvedPrice is absent entirely', () => {
    expect(
      unresolvedTrailingStops([{ kind: 'TRAILING', resolvedPrice: undefined }]),
    ).toEqual([{ kind: 'TRAILING', resolvedPrice: undefined }]);
  });

  it('drops a trailing stop that has resolved', () => {
    expect(
      unresolvedTrailingStops([{ kind: 'TRAILING', resolvedPrice: 15.02 }]),
    ).toEqual([]);
  });

  it('never includes a fixed stop, resolved or not', () => {
    expect(
      unresolvedTrailingStops([
        { kind: 'FIXED', resolvedPrice: null },
        { kind: 'FIXED', resolvedPrice: 100 },
      ]),
    ).toEqual([]);
  });
});
