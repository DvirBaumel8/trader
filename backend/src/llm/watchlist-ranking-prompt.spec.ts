import { describe, expect, it } from 'vitest';
import {
  buildRankingUserPrompt,
  RANKING_SYSTEM_PROMPT,
  type RankingCandidate,
} from './watchlist-ranking-prompt.js';

const indicators = {
  sma20: 100, sma50: 98, sma150: 95, sma200: 90,
  percentFromSma20: 0.05, percentFromSma50: 0.07,
  percentFromSma150: 0.08, percentFromSma200: 0.12,
  high52w: 120, low52w: 60,
  percentFromHigh52w: -0.1, percentFromLow52w: 0.8,
  atr14: 3, atrPercentOfPrice: 0.03,
  relativeVolume: 1.4, barsAvailable: 345,
};

const covered: RankingCandidate = {
  symbol: 'NVDA', name: 'NVIDIA', price: 108, indicators,
  consensus: {
    recommendationMean: 1.3, recommendationKey: 'strong_buy', analystCount: 57,
    targetMean: 160, targetHigh: 200, targetLow: 90,
    revenueGrowth: 1.05, earningsGrowth: 1.2, profitMargin: 0.6, returnOnEquity: 1.1,
    trend: [{ period: '0m', strongBuy: 9, buy: 48, hold: 2, sell: 1, strongSell: 0 }],
  },
  targetPrice: 130, distanceToTarget: 0.2, tags: ['semis'], note: 'breakout watch',
};

const uncovered: RankingCandidate = {
  ...covered, symbol: 'SPY', name: 'S&P 500 ETF', consensus: null,
  targetPrice: null, distanceToTarget: null, tags: [], note: '',
};

describe('buildRankingUserPrompt', () => {
  it('carries all three views for a covered ticker', () => {
    const p = buildRankingUserPrompt([covered], 'BOOK', 'RECORD', 'PROFILE');
    expect(p).toContain('NVDA');
    expect(p).toContain('57');            // the street
    expect(p).toContain('150-day');       // the tape, named as his indicator
    expect(p).toContain('BOOK');          // him
    expect(p).toContain('RECORD');
    expect(p).toContain('PROFILE');
  });

  /**
   * The missing view is neutral, and SAID to be missing. A ticker ranked on
   * two views beside one ranked on three, with nothing to tell them apart, is
   * a judgement wearing confidence it has not earned.
   */
  it('says plainly when a ticker has no analyst coverage', () => {
    const p = buildRankingUserPrompt([uncovered], 'BOOK', 'RECORD', 'PROFILE');
    expect(p).toMatch(/no analyst coverage/i);
  });

  it('tells the model to treat a missing view as mid-range, not as zero', () => {
    expect(RANKING_SYSTEM_PROMPT).toMatch(/middle of the range|neutral/i);
    expect(RANKING_SYSTEM_PROMPT).toMatch(/not.*zero|never.*penalis/i);
  });

  it('forbids a numeric score in the output', () => {
    expect(RANKING_SYSTEM_PROMPT).toMatch(/do not .*score|no numeric/i);
  });

  it('lists every candidate given to it', () => {
    const p = buildRankingUserPrompt([covered, uncovered], 'B', 'R', 'P');
    expect(p).toContain('NVDA');
    expect(p).toContain('SPY');
  });
});
