import { describe, expect, it } from 'vitest';
import { renderIndicatorLines, level, pct } from './indicator-lines.js';
import type { IndicatorSet } from '../market-data/indicators.js';

const full: IndicatorSet = {
  sma20: 100, sma50: 98, sma150: 95, sma200: 90,
  percentFromSma20: 0.05, percentFromSma50: 0.07,
  percentFromSma150: 0.08, percentFromSma200: 0.12,
  high52w: 120, low52w: 60,
  percentFromHigh52w: -0.1, percentFromLow52w: 0.8,
  atr14: 3, atrPercentOfPrice: 0.03,
  relativeVolume: 1.4, barsAvailable: 260,
};

describe('renderIndicatorLines', () => {
  it('names the 150-day average as his own trend indicator', () => {
    const lines = renderIndicatorLines(full).join('\n');
    expect(lines).toMatch(/150-day average \(HIS trend indicator\)/);
  });

  it('warns when history is thin, and stays silent when it is not', () => {
    const thin = { ...full, barsAvailable: 45 };
    expect(renderIndicatorLines(thin).join('\n')).toMatch(/thin/);
    expect(renderIndicatorLines(full).join('\n')).not.toMatch(/thin/);
  });

  it('says n/a rather than a number for anything null', () => {
    const empty: IndicatorSet = {
      sma20: null, sma50: null, sma150: null, sma200: null,
      percentFromSma20: null, percentFromSma50: null,
      percentFromSma150: null, percentFromSma200: null,
      high52w: null, low52w: null,
      percentFromHigh52w: null, percentFromLow52w: null,
      atr14: null, atrPercentOfPrice: null,
      relativeVolume: null, barsAvailable: 10,
    };
    const lines = renderIndicatorLines(empty).join('\n');
    expect(lines).not.toMatch(/\$/);
    expect(lines).toMatch(/n\/a/);
  });
});

describe('level/pct formatters', () => {
  it('formats a level as currency and n/a for null', () => {
    expect(level(100)).toBe('$100.00');
    expect(level(null)).toBe('n/a');
  });

  it('signs a positive percent and leaves null as n/a', () => {
    expect(pct(0.05)).toBe('+5.0%');
    expect(pct(-0.05)).toBe('-5.0%');
    expect(pct(null)).toBe('n/a');
  });
});
