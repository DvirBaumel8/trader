import {
  buildValuationSeries,
  toCumulativeReturns,
  pricesToReturns,
  rebase,
  type DayInput,
} from './series.js';

const day = (date: string, value: number, flow = 0): DayInput => ({
  date,
  value,
  externalFlow: flow,
});

const buy = (symbol: string, quantity: number, price: number, iso: string) => ({
  symbol,
  side: 'BUY' as const,
  quantity,
  price,
  fee: 0,
  executedAt: new Date(iso),
});

const deposit = (amount: number, iso: string) => ({
  direction: 'DEPOSIT' as const,
  amount,
  occurredAt: new Date(iso),
});

describe('toCumulativeReturns', () => {
  it('is empty for no days', () => {
    expect(toCumulativeReturns([])).toEqual([]);
  });

  it('starts the first day at zero', () => {
    // The opening capital arrives against a prior value of zero, which has no
    // defined return. The first day is the baseline by definition.
    expect(toCumulativeReturns([day('2026-08-28', 10000, 10000)])).toEqual([
      { date: '2026-08-28', cumulative: 0 },
    ]);
  });

  it('computes a simple gain', () => {
    const r = toCumulativeReturns([
      day('2026-08-28', 10000, 10000),
      day('2026-08-31', 11000),
    ]);
    expect(r[1].cumulative).toBeCloseTo(0.1, 10);
  });

  it('chains two days multiplicatively', () => {
    const r = toCumulativeReturns([
      day('2026-08-28', 100, 100),
      day('2026-08-29', 110),
      day('2026-08-30', 121),
    ]);
    expect(r[2].cumulative).toBeCloseTo(0.21, 10);
  });

  it('does not count a deposit as a gain', () => {
    // The single most important property in this file: adding money must not
    // register as performance.
    const r = toCumulativeReturns([
      day('2026-08-28', 10000, 10000),
      day('2026-08-29', 20000, 10000),
    ]);
    expect(r[1].cumulative).toBeCloseTo(0, 10);
  });

  it('does not count a withdrawal as a loss', () => {
    const r = toCumulativeReturns([
      day('2026-08-28', 10000, 10000),
      day('2026-08-29', 5000, -5000),
    ]);
    expect(r[1].cumulative).toBeCloseTo(0, 10);
  });

  it('separates a deposit from real performance on the same day', () => {
    // Started at 10k, deposited 5k, ended at 16k => the 1k is the return.
    const r = toCumulativeReturns([
      day('2026-08-28', 10000, 10000),
      day('2026-08-29', 16000, 5000),
    ]);
    expect(r[1].cumulative).toBeCloseTo(0.1, 10);
  });

  it('compounds a loss then a gain correctly', () => {
    const r = toCumulativeReturns([
      day('2026-08-28', 100, 100),
      day('2026-08-29', 50),
      day('2026-08-30', 100),
    ]);
    // -50% then +100% returns to flat, not to +50%.
    expect(r[2].cumulative).toBeCloseTo(0, 10);
  });

  it('holds flat rather than dividing by a zero prior value', () => {
    const r = toCumulativeReturns([
      day('2026-08-28', 100, 100),
      day('2026-08-29', 0),
      day('2026-08-30', 0),
    ]);
    expect(r[1].cumulative).toBeCloseTo(-1, 10);
    expect(Number.isFinite(r[2].cumulative)).toBe(true);
  });
});

describe('rebase', () => {
  it('shifts a series so the first point is zero', () => {
    const r = rebase([
      { date: 'a', cumulative: 0.1 },
      { date: 'b', cumulative: 0.21 },
    ]);
    expect(r[0].cumulative).toBeCloseTo(0, 10);
    expect(r[1].cumulative).toBeCloseTo(0.1, 10); // (1.21 / 1.1) - 1
  });

  it('is empty for an empty series', () => {
    expect(rebase([])).toEqual([]);
  });

  it('handles a series already starting at zero', () => {
    const r = rebase([
      { date: 'a', cumulative: 0 },
      { date: 'b', cumulative: 0.5 },
    ]);
    expect(r[1].cumulative).toBeCloseTo(0.5, 10);
  });
});

describe('pricesToReturns', () => {
  it('measures each day against the first price', () => {
    const r = pricesToReturns(
      ['2026-08-28', '2026-08-31'],
      new Map([
        ['2026-08-28', 100],
        ['2026-08-31', 110],
      ]),
    );
    expect(r[0].cumulative).toBe(0);
    expect(r[1].cumulative).toBeCloseTo(0.1, 10);
  });

  it('carries the last price forward through a missing bar', () => {
    const r = pricesToReturns(
      ['2026-08-28', '2026-08-29', '2026-08-31'],
      new Map([
        ['2026-08-28', 100],
        ['2026-08-31', 110],
      ]),
    );
    expect(r[1].cumulative).toBe(0);
    expect(r[2].cumulative).toBeCloseTo(0.1, 10);
  });

  it('is empty when there are no prices at all', () => {
    expect(pricesToReturns(['2026-08-28'], new Map())).toEqual([]);
  });
});

describe('buildValuationSeries', () => {
  const closes = new Map([
    [
      'NVDA',
      new Map([
        ['2026-08-28', 100],
        ['2026-08-31', 110],
      ]),
    ],
  ]);

  it('prices held positions at each day close and adds cash', () => {
    const s = buildValuationSeries({
      dates: ['2026-08-28', '2026-08-31'],
      closes,
      txns: [buy('NVDA', 10, 100, '2026-08-28T12:00:00Z')],
      flows: [deposit(1000, '2026-08-28T12:00:00Z')],
      dividends: [],
    });

    // Day 1: bought 10 @ 100 with 1000 deposited => cash 0, positions 1000.
    expect(s[0]).toMatchObject({
      date: '2026-08-28',
      value: 1000,
      externalFlow: 1000,
    });
    // Day 2: same 10 shares at 110.
    expect(s[1]).toMatchObject({
      date: '2026-08-31',
      value: 1100,
      externalFlow: 0,
    });
  });

  it('carries the last known close forward when a bar is missing', () => {
    const s = buildValuationSeries({
      dates: ['2026-08-28', '2026-08-31'],
      // No bar on the 31st: a holiday, a halt, or a thin name.
      closes: new Map([['NVDA', new Map([['2026-08-28', 100]])]]),
      txns: [buy('NVDA', 10, 100, '2026-08-28T12:00:00Z')],
      flows: [deposit(1000, '2026-08-28T12:00:00Z')],
      dividends: [],
    });
    // Held at the last known 100 rather than valued at zero.
    expect(s[0].value).toBe(1000);
    expect(s[1].value).toBe(1000);
  });

  it('treats dividends as internal, not as flows', () => {
    // A dividend moves cash but is not money the owner put in.
    const s = buildValuationSeries({
      dates: ['2026-08-28'],
      closes: new Map(),
      txns: [],
      flows: [deposit(1000, '2026-08-28T12:00:00Z')],
      dividends: [
        {
          symbol: 'NVDA',
          amount: 50,
          occurredAt: new Date('2026-08-28T12:00:00Z'),
        },
      ],
    });
    expect(s[0].value).toBe(1050);
    expect(s[0].externalFlow).toBe(1000);
  });

  it('excludes a trade that has not happened yet', () => {
    const s = buildValuationSeries({
      dates: ['2026-08-28', '2026-08-31'],
      closes,
      txns: [buy('NVDA', 10, 100, '2026-08-31T12:00:00Z')],
      flows: [],
      dividends: [],
    });
    expect(s[0].value).toBe(0);
    expect(s[1].value).toBe(1100 - 1000);
  });

  it('values a short position negatively', () => {
    const s = buildValuationSeries({
      dates: ['2026-08-28'],
      closes,
      txns: [
        {
          symbol: 'NVDA',
          side: 'SELL',
          quantity: 10,
          price: 100,
          fee: 0,
          executedAt: new Date('2026-08-28T12:00:00Z'),
        },
      ],
      flows: [],
      dividends: [],
    });
    // Short proceeds raise cash by 1000; the position is worth -1000.
    expect(s[0].value).toBe(0);
  });
});
