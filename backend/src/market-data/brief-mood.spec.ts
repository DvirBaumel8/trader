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
  return { price, previousClose, stale: false, extended: false, ...over };
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
      { symbol: 'SPY', trend: 'uptrend', changePct: 0.004, stale: false, extended: false },
      { symbol: 'QQQ', trend: 'mixed', changePct: -0.0025, stale: false, extended: true },
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

  it('EMPTY_MOOD is what no quotes at all produce', () => {
    expect(buildMood({ quotes: new Map(), indexBars: { SPY: [], QQQ: [] } })).toEqual(EMPTY_MOOD);
  });
});
