import { describe, expect, it } from 'vitest';
import { toIntent, MAX_SYMBOLS } from './router.js';

describe('toIntent', () => {
  it('accepts a buy with normalised, de-duplicated symbols', () => {
    expect(toIntent({ action: 'buy', symbols: ['lmnd', '$TSLA', '4. GSIT', 'LMND', ' brk.b '] }, 'bought stuff')).toEqual({
      kind: 'buy',
      symbols: ['LMND', 'TSLA', 'GSIT', 'BRK.B'],
      rejected: [],
    });
  });
  it('puts non-ticker strings in rejected', () => {
    expect(toIntent({ action: 'watch', symbols: ['NVDA', 'Lemonade', 'BTC-USD', ''] }, 'watch these')).toEqual({
      kind: 'watch',
      symbols: ['NVDA'],
      rejected: ['LEMONADE', 'BTC-USD'],
    });
  });
  it.each(['sell', 'unwatch'])('accepts %s', (action) => {
    expect(toIntent({ action, symbols: ['NVDA'] }, 'x')).toEqual({ kind: action, symbols: ['NVDA'], rejected: [] });
  });
  it('a message with "?" is never an action, whatever the model says', () => {
    expect(toIntent({ action: 'buy', symbols: ['NVDA'] }, 'should I buy NVDA?')).toEqual({ kind: 'none' });
  });
  it.each([
    [null],
    ['buy NVDA'],
    [{ action: 'short', symbols: ['NVDA'] }],
    [{ action: 'buy' }],
    [{ action: 'buy', symbols: 'NVDA' }],
    [{ action: 'buy', symbols: [42] }],
    [{ action: 'buy', symbols: [] }],
    [{ action: 'buy', symbols: ['zz zz', '???'] }],
    [{ action: 'none', symbols: [] }],
  ])('invalid or empty output %j is none', (raw) => {
    expect(toIntent(raw, 'bought something')).toEqual({ kind: 'none' });
  });
  it('more than MAX_SYMBOLS is none', () => {
    const symbols = Array.from({ length: MAX_SYMBOLS + 1 }, (_, i) => `A${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`);
    expect(toIntent({ action: 'buy', symbols }, 'bought')).toEqual({ kind: 'none' });
  });
});
