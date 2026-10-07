import { describe, expect, it } from 'vitest';
import { rankMovers, type MoverInput } from './brief-movers.js';

function pos(symbol: string, dayChange: number | null, over: Partial<MoverInput> = {}): MoverInput {
  return { symbol, dayChange, dayChangePct: dayChange === null ? null : dayChange / 100, dayPnl: dayChange === null ? null : dayChange * 10, extended: false, stale: false, session: 'REGULAR', ...over };
}

describe('rankMovers', () => {
  it('keeps holdings that moved at least 1 ATR, largest first, with the portfolio\'s own figures', () => {
    const rows = rankMovers(
      [pos('SMALL', 1), pos('BIG', 6), pos('MID', 3)],
      new Map([['SMALL', 2], ['BIG', 2], ['MID', 2]]),
      new Map(),
    );
    expect(rows.map((r) => r.symbol)).toEqual(['BIG', 'MID']);
    expect(rows[0]).toEqual({
      symbol: 'BIG', changePct: 0.06, atrMultiple: 3, dollarChange: 60,
      extended: false, stale: false, session: 'REGULAR', reasons: [], headline: null, thesis: null,
    });
  });

  it('ranks a fall the same as a rise', () => {
    const rows = rankMovers([pos('UP', 3), pos('DOWN', -5)], new Map([['UP', 2], ['DOWN', 2]]), new Map());
    expect(rows.map((r) => r.symbol)).toEqual(['DOWN', 'UP']);
    expect(rows[0].atrMultiple).toBe(2.5);
  });

  it('keeps a short\'s signs from the portfolio: price up, position down', () => {
    const [row] = rankMovers([pos('SHRT', 4, { dayChangePct: 0.04, dayPnl: -400 })], new Map([['SHRT', 2]]), new Map());
    expect(row.changePct).toBe(0.04);
    expect(row.dollarChange).toBe(-400);
  });

  it('caps at five', () => {
    const symbols = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const rows = rankMovers(symbols.map((s, i) => pos(s, 10 + i)), new Map(symbols.map((s) => [s, 1])), new Map());
    expect(rows.map((r) => r.symbol)).toEqual(['G', 'F', 'E', 'D', 'C']);
  });

  it('skips a holding with no ATR, no move, or a zero move (pre-market without a print)', () => {
    const rows = rankMovers(
      [pos('NOATR', 9), pos('NOMOVE', null), pos('FLAT', 0)],
      new Map([['NOMOVE', 1], ['FLAT', 1]]),
      new Map(),
    );
    expect(rows).toEqual([]);
  });

  it('carries extended, stale and session for the screen to label', () => {
    const [row] = rankMovers([pos('X', 5, { extended: true, stale: true, session: 'PRE' })], new Map([['X', 2]]), new Map());
    expect(row).toMatchObject({ extended: true, stale: true, session: 'PRE' });
  });

  it('labels entry reasons from the shared vocabulary and drops unknown codes', () => {
    const [row] = rankMovers([pos('X', 5)], new Map([['X', 2]]), new Map([['X', ['ENTRY_BREAKOUT', 'ENTRY_VOLUME', 'NOT_A_CODE']]]));
    expect(row.reasons).toEqual([{ code: 'ENTRY_BREAKOUT', label: 'Breakout' }, { code: 'ENTRY_VOLUME', label: 'Volume' }]);
  });
});
