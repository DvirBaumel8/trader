import { describe, expect, it } from 'vitest';
import { parseMessage, type Intent } from './parse.js';

const cases: [string, Intent][] = [
  ['bought LMND', { kind: 'add-holding', symbol: 'LMND', direction: 'LONG' }],
  ['Bought lmnd.', { kind: 'add-holding', symbol: 'LMND', direction: 'LONG' }],
  ['BOUGHT $LMND', { kind: 'add-holding', symbol: 'LMND', direction: 'LONG' }],
  ['buy brk.b', { kind: 'add-holding', symbol: 'BRK.B', direction: 'LONG' }],
  ['long NVDA', { kind: 'add-holding', symbol: 'NVDA', direction: 'LONG' }],
  ['I just bought some LMND', { kind: 'add-holding', symbol: 'LMND', direction: 'LONG' }],
  ['short TSLA', { kind: 'add-holding', symbol: 'TSLA', direction: 'SHORT' }],
  ['shorted tsla!', { kind: 'add-holding', symbol: 'TSLA', direction: 'SHORT' }],
  ['sold LMND', { kind: 'remove-holding', symbol: 'LMND' }],
  ['sell lmnd', { kind: 'remove-holding', symbol: 'LMND' }],
  ['closed TSLA', { kind: 'remove-holding', symbol: 'TSLA' }],
  ['covered tsla', { kind: 'remove-holding', symbol: 'TSLA' }],
  ['I sold all my LMND', { kind: 'remove-holding', symbol: 'LMND' }],
  ['watch NVDA', { kind: 'watch', symbol: 'NVDA' }],
  ['unwatch nvda', { kind: 'unwatch', symbol: 'NVDA' }],
  ['is GOOGL above 150 SMA', { kind: 'ma-check', symbol: 'GOOGL', comparator: 'above', period: 150, average: 'SMA' }],
  ['is googl above the 150 sma?', { kind: 'ma-check', symbol: 'GOOGL', comparator: 'above', period: 150, average: 'SMA' }],
  ['Is GOOGL above 150sma', { kind: 'ma-check', symbol: 'GOOGL', comparator: 'above', period: 150, average: 'SMA' }],
  ['is nvda below 50 ema', { kind: 'ma-check', symbol: 'NVDA', comparator: 'below', period: 50, average: 'EMA' }],
  ['is nvda under its 200-day ma', { kind: 'ma-check', symbol: 'NVDA', comparator: 'below', period: 200, average: 'SMA' }],
  ['is AAPL over 20 day sma', { kind: 'ma-check', symbol: 'AAPL', comparator: 'above', period: 20, average: 'SMA' }],
  // Not a ticker shape (more than 5 letters) → a prompt, not an error.
  ['bought some lemonade', { kind: 'unknown' }],
  // Two candidate tickers is ambiguous → prompt.
  ['bought LMND and TSLA', { kind: 'unknown' }],
  ['what do you think about my portfolio?', { kind: 'unknown' }],
  ['', { kind: 'unknown' }],
  ['   ', { kind: 'unknown' }],
  ['is GOOGL above 0 SMA', { kind: 'unknown' }],
  ['watch', { kind: 'unknown' }],
  // Questions must not become writes.
  ['buy NVDA?', { kind: 'unknown' }],
  ['sell lmnd?', { kind: 'unknown' }],
  ['watch NVDA?', { kind: 'unknown' }],
  // Common English words are never tickers.
  ['short term', { kind: 'unknown' }],
  ['long term', { kind: 'unknown' }],
  ['bought today', { kind: 'unknown' }],
  ['sold it', { kind: 'unknown' }],
  ['sell off', { kind: 'unknown' }],
  ['watch out', { kind: 'unknown' }],
  // ServiceNow is a real holding, so NOW is not in NOT_TICKERS.
  ['bought NOW', { kind: 'add-holding', symbol: 'NOW', direction: 'LONG' }],
  // Multi-punctuation: strip and parse normally.
  ['bought lmnd.?', { kind: 'add-holding', symbol: 'LMND', direction: 'LONG' }],
  ['bought lmnd!.', { kind: 'add-holding', symbol: 'LMND', direction: 'LONG' }],
  // Whitespace handling.
  ['\tbought\nLMND\t', { kind: 'add-holding', symbol: 'LMND', direction: 'LONG' }],
  // Coverage: share classes and large periods.
  ['is BRK.B above 200 SMA', { kind: 'ma-check', symbol: 'BRK.B', comparator: 'above', period: 200, average: 'SMA' }],
  ['is GOOGL above 10000 SMA', { kind: 'unknown' }],
];

describe('parseMessage', () => {
  it.each(cases)('%j', (text, expected) => {
    expect(parseMessage(text)).toEqual(expected);
  });
});
