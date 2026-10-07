import { describe, expect, it } from 'vitest';
import {
  emptyDraft,
  signedReportedNetCash,
  parsedReportedBalance,
  computedBalanceFromReportedCash,
  computedPriceFromReportedCash,
  computedNetCashFromPrice,
  type EntryDraft,
} from './entryDraft';

function draft(overrides: Partial<EntryDraft> = {}): EntryDraft {
  return { ...emptyDraft(4), ...overrides };
}

describe('emptyDraft', () => {
  it('starts with blank reconciliation fields', () => {
    const d = emptyDraft(4);
    expect(d.reportedNetCash).toBe('');
    expect(d.reportedBalance).toBe('');
  });
});

describe('signedReportedNetCash', () => {
  it('is undefined when left blank', () => {
    expect(signedReportedNetCash(draft({ reportedNetCash: '' }))).toBeUndefined();
  });

  it('is negative for a buy, from a plain positive amount typed in', () => {
    expect(
      signedReportedNetCash(draft({ side: 'BUY', reportedNetCash: '1004' })),
    ).toBe(-1004);
  });

  it('is positive for a sell, from a plain positive amount typed in', () => {
    expect(
      signedReportedNetCash(draft({ side: 'SELL', reportedNetCash: '22146' })),
    ).toBe(22146);
  });

  it('takes the magnitude even if a minus sign was typed', () => {
    expect(
      signedReportedNetCash(draft({ side: 'BUY', reportedNetCash: '-1004' })),
    ).toBe(-1004);
  });
});

describe('parsedReportedBalance', () => {
  it('is undefined when left blank', () => {
    expect(parsedReportedBalance(draft({ reportedBalance: '' }))).toBeUndefined();
  });

  it('passes a negative balance through as-is, since margin is legitimate', () => {
    expect(parsedReportedBalance(draft({ reportedBalance: '-165188' }))).toBe(
      -165188,
    );
  });

  it('parses a positive balance', () => {
    expect(parsedReportedBalance(draft({ reportedBalance: '8996' }))).toBe(8996);
  });
});

describe('computedBalanceFromReportedCash', () => {
  it('is undefined when the previous balance is not known yet', () => {
    expect(
      computedBalanceFromReportedCash(
        draft({ side: 'BUY', reportedNetCash: '1004' }),
        null,
      ),
    ).toBeUndefined();
  });

  it('is undefined when net cash has not been given', () => {
    expect(
      computedBalanceFromReportedCash(draft({ reportedNetCash: '' }), -165188),
    ).toBeUndefined();
  });

  it('subtracts a buy\'s net cash and its fee from the previous balance', () => {
    // BUY 100 shares, net 10,000, fee 5: cash moves -10,000 - 5.
    expect(
      computedBalanceFromReportedCash(
        draft({ side: 'BUY', quantity: '100', fee: '5', reportedNetCash: '10000' }),
        50000,
      ),
    ).toBe(39995);
  });

  it('adds a sell\'s net cash and takes its fee off the previous balance', () => {
    // SELL 1000 BITX, net 19,560, fee 10: cash moves +19,560 - 10.
    expect(
      computedBalanceFromReportedCash(
        draft({ side: 'SELL', quantity: '1000', fee: '10', reportedNetCash: '19560' }),
        -205881,
      ),
    ).toBe(-186331);
  });

  it('treats a blank fee as zero', () => {
    expect(
      computedBalanceFromReportedCash(
        draft({ side: 'SELL', fee: '', reportedNetCash: '12039' }),
        -205881,
      ),
    ).toBe(-193842);
  });

  it('rounds to the cent', () => {
    expect(
      computedBalanceFromReportedCash(
        draft({ side: 'BUY', fee: '0', reportedNetCash: '10.005' }),
        100,
      ),
    ).toBe(90);
  });
});

describe('computedPriceFromReportedCash', () => {
  it('is the reported magnitude over the quantity, whatever the fee', () => {
    expect(
      computedPriceFromReportedCash(
        draft({ side: 'SELL', quantity: '1000', fee: '10', reportedNetCash: '19560' }),
      ),
    ).toBeCloseTo(19.56, 8);
    expect(
      computedPriceFromReportedCash(
        draft({ side: 'BUY', quantity: '100', fee: '5', reportedNetCash: '10000' }),
      ),
    ).toBe(100);
  });

  it('works from the displayed quantity when the draft has none typed', () => {
    // The held-position suggestion lives outside the draft, so the caller
    // feeds it in as the draft's quantity.
    expect(
      computedPriceFromReportedCash(
        draft({ side: 'SELL', quantity: '600', fee: '6', reportedNetCash: '22155' }),
      ),
    ).toBeCloseTo(36.925, 6);
    expect(
      computedPriceFromReportedCash(
        draft({ side: 'SELL', quantity: '', reportedNetCash: '22155' }),
      ),
    ).toBeUndefined();
  });
});

describe('computedNetCashFromPrice', () => {
  it('is qty x price on a buy, with no fee added', () => {
    expect(
      computedNetCashFromPrice(
        draft({ side: 'BUY', quantity: '10', price: '100.5', fee: '4' }),
      ),
    ).toBe(1005);
  });

  it('is qty x price on a sell, with no fee taken off', () => {
    expect(
      computedNetCashFromPrice(
        draft({ side: 'SELL', quantity: '600', price: '36.925', fee: '6' }),
      ),
    ).toBe(22155);
  });

  it('previews the BITX example: 1000 x 19.56 = 19560', () => {
    expect(
      computedNetCashFromPrice(
        draft({ side: 'SELL', quantity: '1000', price: '19.56', fee: '10' }),
      ),
    ).toBe(19560);
  });

  it('rounds to the cent', () => {
    expect(
      computedNetCashFromPrice(
        draft({ side: 'BUY', quantity: '3', price: '10.333', fee: '0' }),
      ),
    ).toBe(31);
    expect(
      computedNetCashFromPrice(
        draft({ side: 'BUY', quantity: '1', price: '10.126', fee: '0' }),
      ),
    ).toBe(10.13);
  });

  it('is undefined without a usable quantity or price', () => {
    expect(computedNetCashFromPrice(draft({ quantity: '', price: '10' }))).toBeUndefined();
    expect(computedNetCashFromPrice(draft({ quantity: '10', price: '' }))).toBeUndefined();
    expect(computedNetCashFromPrice(draft({ quantity: '0', price: '10' }))).toBeUndefined();
    expect(computedNetCashFromPrice(draft({ quantity: '10', price: '0' }))).toBeUndefined();
  });
});
