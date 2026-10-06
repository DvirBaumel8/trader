import { describe, expect, it } from 'vitest';
import type { RawBar } from './yahoo.client.js';
import { buildMood, EMPTY_MOOD, trendOf, type MoodQuote } from './brief-mood.js';

function bars(closes: number[]): RawBar[] {
  return closes.map((close, i) => ({
    date: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
    close, adjClose: close, open: close, high: close + 1, low: close - 1, volume: 1_000_000,
  }));
}
const rising = bars(Array.from({ length: 60 }, (_, i) => 100 + i));
const falling = bars(Array.from({ length: 60 }, (_, i) => 160 - i));
const flat = bars(Array.from({ length: 60 }, () => 100));

function quote(price: number, previousClose: number | null, over: Partial<MoodQuote> = {}): MoodQuote {
  return { price, previousClose, stale: false, extended: false, session: 'REGULAR', regularPrice: null, ...over };
}

describe('trendOf', () => {
  it('is an uptrend when price > EMA20 > SMA50 and EMA20 is rising', () => {
    expect(trendOf(rising, 160)).toBe('uptrend');
  });
  it('is a downtrend in the mirror case', () => {
    expect(trendOf(falling, 100)).toBe('downtrend');
  });
  it('is mixed when neither holds', () => {
    expect(trendOf(flat, 100)).toBe('mixed');
  });
  it('is null, never guessed, without enough history for a 50-day average', () => {
    expect(trendOf(rising.slice(0, 30), 160)).toBeNull();
  });
  it('sorts bars itself rather than trusting their order', () => {
    expect(trendOf([...rising].reverse(), 160)).toBe('uptrend');
  });
});

describe('buildMood', () => {
  it('reports each index with its trend and change since the prior close, as a fraction', () => {
    const mood = buildMood({
      quotes: new Map([
        ['SPY', quote(502, 500)],
        ['QQQ', quote(399, 400, { extended: true })],
      ]),
      indexBars: { SPY: rising, QQQ: flat },
    });
    expect(mood.indices).toEqual([
      { symbol: 'SPY', trend: 'uptrend', changePct: 0.004, stale: false, extended: false, session: 'REGULAR' },
      { symbol: 'QQQ', trend: 'mixed', changePct: -0.0025, stale: false, extended: true, session: 'REGULAR' },
    ]);
  });

  it('keeps a stale index on the line, marked stale', () => {
    const mood = buildMood({ quotes: new Map([['SPY', quote(500, 500, { stale: true })]]), indexBars: { SPY: rising, QQQ: [] } });
    expect(mood.indices).toEqual([expect.objectContaining({ symbol: 'SPY', stale: true })]);
  });

  it('omits an index with no quote rather than inventing one', () => {
    const mood = buildMood({ quotes: new Map(), indexBars: { SPY: rising, QQQ: rising } });
    expect(mood.indices).toEqual([]);
  });

  it('gives a null change when there is no prior close', () => {
    const mood = buildMood({ quotes: new Map([['SPY', quote(500, null)]]), indexBars: { SPY: rising, QQQ: [] } });
    expect(mood.indices[0].changePct).toBeNull();
  });

  it('reports VIX as a level and a point change', () => {
    const mood = buildMood({ quotes: new Map([['^VIX', quote(17.8, 16.7)]]), indexBars: { SPY: [], QQQ: [] } });
    expect(mood.vix?.level).toBe(17.8);
    expect(mood.vix?.change).toBeCloseTo(1.1, 10);
    expect(mood.vix?.stale).toBe(false);
  });

  it('is null for VIX when the provider returned no VIX quote', () => {
    expect(buildMood({ quotes: new Map(), indexBars: { SPY: [], QQQ: [] } }).vix).toBeNull();
  });

  it('names the best and worst sector by today\'s change, skipping stale quotes', () => {
    const mood = buildMood({
      quotes: new Map([
        ['XLE', quote(101.2, 100)],
        ['XLK', quote(99.1, 100)],
        ['XLF', quote(100.5, 100)],
        ['XLU', quote(110, 100, { stale: true })],
      ]),
      indexBars: { SPY: [], QQQ: [] },
    });
    expect(mood.leader?.symbol).toBe('XLE');
    expect(mood.leader?.name).toBe('Energy');
    expect(mood.leader?.changePct).toBeCloseTo(0.012, 10);
    expect(mood.laggard?.symbol).toBe('XLK');
    expect(mood.laggard?.name).toBe('Technology');
  });

  it('names no leader or laggard when every sector moved the same', () => {
    const mood = buildMood({
      quotes: new Map([['XLE', quote(102, 100)], ['XLK', quote(102, 100)]]),
      indexBars: { SPY: [], QQQ: [] },
    });
    expect(mood.leader).toBeNull();
    expect(mood.laggard).toBeNull();
  });

  it('names no leader or laggard with fewer than two usable sectors', () => {
    const mood = buildMood({ quotes: new Map([['XLE', quote(102, 100)]]), indexBars: { SPY: [], QQQ: [] } });
    expect(mood.leader).toBeNull();
    expect(mood.laggard).toBeNull();
  });

  describe('the move per session', () => {
    const spy = (q: MoodQuote) => buildMood({ quotes: new Map([['SPY', q]]), indexBars: { SPY: [], QQQ: [] } }).indices[0].changePct;
    // previousClose 500 is the session before yesterday; the last close is 510.
    it('PRE with an extended print measures from the last regular close', () => {
      expect(spy(quote(512.04, 500, { session: 'PRE', extended: true, regularPrice: 510 }))).toBeCloseTo(0.004, 10);
    });
    it('PRE without an extended print has no move, never 0.00%', () => {
      expect(spy(quote(510, 500, { session: 'PRE', extended: false, regularPrice: 510 }))).toBeNull();
    });
    it('REGULAR measures from the previous close', () => {
      expect(spy(quote(502, 500, { session: 'REGULAR', regularPrice: 502 }))).toBeCloseTo(0.004, 10);
    });
    it('POST measures from the previous close', () => {
      expect(spy(quote(503, 500, { session: 'POST', extended: true, regularPrice: 502 }))).toBeCloseTo(0.006, 10);
    });
    it('CLOSED measures from the previous close', () => {
      expect(spy(quote(502, 500, { session: 'CLOSED', regularPrice: 502 }))).toBeCloseTo(0.004, 10);
    });
    it('VIX in PRE: from the regular close with an extended print, null without', () => {
      const vix = (q: MoodQuote) => buildMood({ quotes: new Map([['^VIX', q]]), indexBars: { SPY: [], QQQ: [] } }).vix?.change;
      expect(vix(quote(18, 16, { session: 'PRE', extended: true, regularPrice: 17.5 }))).toBeCloseTo(0.5, 10);
      expect(vix(quote(17.5, 16, { session: 'PRE', extended: false, regularPrice: 17.5 }))).toBeNull();
    });
  });

  describe('ranking sectors on one base', () => {
    const run = (quotes: [string, MoodQuote][]) => buildMood({ quotes: new Map(quotes), indexBars: { SPY: [], QQQ: [] } });
    it('in PRE counts only sectors with an extended print, from the regular close', () => {
      const mood = run([
        ['XLE', quote(103, 90, { session: 'PRE', extended: true, regularPrice: 100 })],
        ['XLK', quote(99, 90, { session: 'PRE', extended: true, regularPrice: 100 })],
        ['XLF', quote(120, 90, { session: 'PRE', extended: false, regularPrice: 120 })],
      ]);
      expect(mood.leader).toMatchObject({ symbol: 'XLE' });
      expect(mood.leader?.changePct).toBeCloseTo(0.03, 10);
      expect(mood.laggard).toMatchObject({ symbol: 'XLK' });
    });
    it('in PRE with one sector printing there is no pair', () => {
      const mood = run([
        ['XLE', quote(103, 90, { session: 'PRE', extended: true, regularPrice: 100 })],
        ['XLK', quote(100, 90, { session: 'PRE', extended: false, regularPrice: 100 })],
      ]);
      expect(mood.leader).toBeNull();
    });
    it('after the close ranks the regular-session move, not the extended print', () => {
      const mood = run([
        ['XLE', quote(110, 100, { session: 'POST', extended: true, regularPrice: 101 })],
        ['XLK', quote(95, 100, { session: 'POST', extended: true, regularPrice: 102 })],
        ['XLF', quote(100, 100, { session: 'POST', extended: false, regularPrice: 99 })],
      ]);
      expect(mood.leader).toMatchObject({ symbol: 'XLK' });
      expect(mood.leader?.changePct).toBeCloseTo(0.02, 10);
      expect(mood.laggard).toMatchObject({ symbol: 'XLF' });
    });
  });

  it('EMPTY_MOOD is what no quotes at all produce', () => {
    expect(buildMood({ quotes: new Map(), indexBars: { SPY: [], QQQ: [] } })).toEqual(EMPTY_MOOD);
  });
});
