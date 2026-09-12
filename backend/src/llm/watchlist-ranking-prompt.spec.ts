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
  peRatio: 42.5,
  consensus: {
    status: 'ok',
    data: {
      recommendationMean: 1.3, recommendationKey: 'strong_buy', analystCount: 57,
      targetMean: 160, targetHigh: 200, targetLow: 90,
      revenueGrowth: 1.05, earningsGrowth: 1.2, profitMargin: 0.6, returnOnEquity: 1.1,
      trend: [{ period: '0m', strongBuy: 9, buy: 48, hold: 2, sell: 1, strongSell: 0 }],
    },
  },
  targetPrice: 130, distanceToTarget: 0.2, tags: ['semis'], note: 'breakout watch',
  trades: [
    {
      symbol: 'NVDA', direction: 'LONG', isOpen: false,
      realizedPnl: 900, rMultiple: 1.5,
      enteredAt: '2026-05-01', exitedAt: '2026-05-20',
      setups: ['breakout'], mistakes: [],
    },
  ],
};

const uncovered: RankingCandidate = {
  ...covered, symbol: 'SPY', name: 'S&P 500 ETF', consensus: { status: 'no-coverage' },
  targetPrice: null, distanceToTarget: null, tags: [], note: '',
  peRatio: null, trades: [],
};

const unavailable: RankingCandidate = {
  ...covered, symbol: 'AMD', name: 'AMD', consensus: { status: 'unavailable' },
  targetPrice: null, distanceToTarget: null, tags: [], note: '',
  peRatio: null, trades: [],
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

  /**
   * The failure that motivated the three-state fix: a Yahoo outage must not
   * read as the resolved fact "no analyst coverage". The two must render as
   * visibly different sentences, so the model (and the parser's COVERAGE
   * field downstream) can tell them apart.
   */
  it('says the view is unavailable, distinctly from no coverage, on a fetch failure', () => {
    const p = buildRankingUserPrompt([unavailable], 'BOOK', 'RECORD', 'PROFILE');
    expect(p).toMatch(/unavailable/i);
    expect(p).not.toMatch(/no analyst coverage/i);
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

  /** Restores the P/E line the ranking's copy of the tape had dropped. */
  it('carries the P/E line, restored from the shared indicator block', () => {
    const p = buildRankingUserPrompt([covered], 'BOOK', 'RECORD', 'PROFILE');
    expect(p).toMatch(/P\/E: 42\.5/);
  });

  it('says n/a for P/E when there is none', () => {
    const p = buildRankingUserPrompt([uncovered], 'BOOK', 'RECORD', 'PROFILE');
    expect(p).toMatch(/P\/E: n\/a/);
  });

  /**
   * The headline claim: the model is told to use "specifically his own
   * history in the ticker being ranked, if he has one" — a candidate with
   * prior trades must actually carry them.
   */
  it("renders a candidate's own trade history, setups and mistakes included", () => {
    const p = buildRankingUserPrompt([covered], 'BOOK', 'RECORD', 'PROFILE');
    expect(p).toContain('MY HISTORY IN THIS TICKER');
    expect(p).toContain('My history in NVDA (1)');
    expect(p).toContain('[breakout]');
  });

  it('says so plainly, in one line, when he has never traded a candidate', () => {
    const p = buildRankingUserPrompt([uncovered], 'BOOK', 'RECORD', 'PROFILE');
    expect(p).toContain('I have never closed a trade in SPY.');
  });
});
