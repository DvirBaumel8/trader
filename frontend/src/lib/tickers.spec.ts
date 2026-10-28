import { expect, it } from 'vitest';
import { parseTickers, summarize } from './tickers';

it('splits on whitespace, commas and semicolons', () => {
  expect(parseTickers('GSIT, LMND NVDA;AMD\nTSLA')).toEqual(['GSIT', 'LMND', 'NVDA', 'AMD', 'TSLA']);
});

it('strips list numbering', () => {
  expect(parseTickers('1. GSIT 2) LMND 3.NVDA')).toEqual(['GSIT', 'LMND', 'NVDA']);
});

it('keeps dotted tickers and ignores blanks', () => {
  expect(parseTickers('  BRK.B ,, ')).toEqual(['BRK.B']);
  expect(parseTickers('   ')).toEqual([]);
});

it('omits empty groups', () => {
  expect(summarize([['Added', ['A', 'B']], ['Already held', []], ["Couldn't find", ['X']]])).toBe(
    "Added: A, B · Couldn't find: X",
  );
});
