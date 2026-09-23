import { describe, expect, it } from 'vitest';
import {
  emptyDraft,
  signedReportedNetCash,
  parsedReportedBalance,
  computedBalanceFromReportedCash,
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

  it('subtracts a buy\'s net cash from the previous balance', () => {
    expect(
      computedBalanceFromReportedCash(
        draft({ side: 'BUY', reportedNetCash: '24924' }),
        -165188,
      ),
    ).toBe(-190112);
  });

  it('adds a sell\'s net cash to the previous balance', () => {
    expect(
      computedBalanceFromReportedCash(
        draft({ side: 'SELL', reportedNetCash: '12039' }),
        -205881,
      ),
    ).toBe(-193842);
  });

  it('rounds to the cent', () => {
    expect(
      computedBalanceFromReportedCash(
        draft({ side: 'BUY', reportedNetCash: '10.005' }),
        100,
      ),
    ).toBe(90);
  });
});
