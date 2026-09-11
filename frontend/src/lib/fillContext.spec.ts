import { describe, expect, it } from 'vitest';
import { fillContext } from './fillContext';

const positions = [
  { symbol: 'NVDA', quantity: 500 },
  { symbol: 'LMND', quantity: -300 },
];

describe('fillContext', () => {
  it('calls a sell against a long a closing fill, and offers what is held', () => {
    expect(fillContext(positions, 'NVDA', 'SELL')).toEqual({
      held: 500,
      closing: true,
      suggested: '500',
    });
  });

  /**
   * On margin a BUY closes too — covering a short. Keying off side alone is
   * the bug this exists to avoid; the backend's own guard checks net
   * quantity for the same reason.
   */
  it('calls a buy against a short a closing fill, and offers the magnitude', () => {
    expect(fillContext(positions, 'LMND', 'BUY')).toEqual({
      held: -300,
      closing: true,
      suggested: '300',
    });
  });

  it('does not treat adding to a long as closing', () => {
    expect(fillContext(positions, 'NVDA', 'BUY')).toMatchObject({
      closing: false,
      suggested: null,
    });
  });

  it('does not treat shorting more as closing', () => {
    expect(fillContext(positions, 'LMND', 'SELL')).toMatchObject({
      closing: false,
      suggested: null,
    });
  });

  it('holds nothing in a symbol that is not in the portfolio', () => {
    expect(fillContext(positions, 'TSLA', 'SELL')).toEqual({
      held: 0,
      closing: false,
      suggested: null,
    });
  });

  it('reads a lowercase symbol with spaces around it', () => {
    expect(fillContext(positions, ' nvda ', 'SELL')).toMatchObject({
      held: 500,
      closing: true,
    });
  });

  it('holds nothing while the portfolio is still loading', () => {
    expect(fillContext(undefined, 'NVDA', 'SELL')).toEqual({
      held: 0,
      closing: false,
      suggested: null,
    });
  });

  it('keeps a fractional holding intact', () => {
    expect(fillContext([{ symbol: 'SPY', quantity: 2.5 }], 'SPY', 'SELL'))
      .toMatchObject({ suggested: '2.5' });
  });
});
