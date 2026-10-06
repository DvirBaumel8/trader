import type { RawBar } from './yahoo.client.js';
import { ema, fiveDayEmaAgo, sma } from './daily-brief.js';

/**
 * The Brief's one-line read of the market's mood, before any single name:
 * a swing trader's morning starts with regime — are the indexes trending,
 * is fear rising, where is money rotating — and only then the book. Pure
 * and dependency-free; the service fetches the quotes and bars.
 */

export type MoodIndex = 'SPY' | 'QQQ';
export const MOOD_INDICES: readonly MoodIndex[] = ['SPY', 'QQQ'];
export const VIX_SYMBOL = '^VIX';

/** The 11 SPDR sector ETFs, with the name the screen shows for each. */
export const SECTOR_ETFS: Readonly<Record<string, string>> = {
  XLK: 'Technology',
  XLF: 'Financials',
  XLE: 'Energy',
  XLV: 'Health care',
  XLI: 'Industrials',
  XLY: 'Consumer discretionary',
  XLP: 'Consumer staples',
  XLU: 'Utilities',
  XLB: 'Materials',
  XLRE: 'Real estate',
  XLC: 'Communication services',
};

export const MOOD_QUOTE_SYMBOLS: readonly string[] = [
  ...MOOD_INDICES,
  VIX_SYMBOL,
  ...Object.keys(SECTOR_ETFS),
];

export type Trend = 'uptrend' | 'downtrend' | 'mixed';

export interface MoodQuote {
  price: number;
  previousClose: number | null;
  stale: boolean;
  extended: boolean;
}

export interface MoodInput {
  quotes: ReadonlyMap<string, MoodQuote>;
  indexBars: Readonly<Record<MoodIndex, RawBar[]>>;
}

export interface MoodSector {
  symbol: string;
  name: string;
  changePct: number;
}

export interface MoodIndexRow {
  symbol: MoodIndex;
  trend: Trend | null;
  changePct: number | null;
  stale: boolean;
  extended: boolean;
}

export interface Mood {
  indices: MoodIndexRow[];
  vix: { level: number; change: number | null; stale: boolean } | null;
  leader: MoodSector | null;
  laggard: MoodSector | null;
}

export const EMPTY_MOOD: Mood = { indices: [], vix: null, leader: null, laggard: null };

const TREND_PERIOD = 20;
const LONG_TREND_PERIOD = 50;

function changePct(quote: MoodQuote): number | null {
  return quote.previousClose !== null && quote.previousClose > 0
    ? (quote.price - quote.previousClose) / quote.previousClose
    : null;
}

/**
 * The same trend test the momentum rule uses, minus relative strength: an
 * index cannot outperform itself. Null without enough history — a trend
 * label from 30 bars would be a guess.
 */
export function trendOf(bars: RawBar[], price: number): Trend | null {
  const sorted = [...bars].sort((a, b) => a.date.localeCompare(b.date));
  const closes = sorted.map((bar) => bar.close);
  const ema20 = ema(closes, TREND_PERIOD);
  const sma50 = sma(closes, LONG_TREND_PERIOD);
  const ema20FiveDaysAgo = fiveDayEmaAgo(sorted);
  if (ema20 === null || sma50 === null || ema20FiveDaysAgo === null) return null;
  if (price > ema20 && ema20 > sma50 && ema20 > ema20FiveDaysAgo) return 'uptrend';
  if (price < ema20 && ema20 < sma50 && ema20 < ema20FiveDaysAgo) return 'downtrend';
  return 'mixed';
}

export function buildMood(input: MoodInput): Mood {
  const indices = MOOD_INDICES.flatMap((symbol): MoodIndexRow[] => {
    const quote = input.quotes.get(symbol);
    if (!quote) return [];
    return [{
      symbol,
      trend: trendOf(input.indexBars[symbol], quote.price),
      changePct: changePct(quote),
      stale: quote.stale,
      extended: quote.extended,
    }];
  });

  const vixQuote = input.quotes.get(VIX_SYMBOL);
  const vix = vixQuote
    ? {
        level: vixQuote.price,
        change: vixQuote.previousClose !== null ? vixQuote.price - vixQuote.previousClose : null,
        stale: vixQuote.stale,
      }
    : null;

  // A stale sector quote is yesterday's move; ranking it against today's
  // would name a "leader" that is not leading anything today.
  const sectors = Object.entries(SECTOR_ETFS)
    .flatMap(([symbol, name]): MoodSector[] => {
      const quote = input.quotes.get(symbol);
      if (!quote || quote.stale) return [];
      const pct = changePct(quote);
      return pct === null ? [] : [{ symbol, name, changePct: pct }];
    })
    .sort((a, b) => b.changePct - a.changePct);
  const best = sectors[0];
  const worst = sectors.at(-1);
  // With every sector level, "leading" and "lagging" would name two
  // sectors at the same number — a distinction that is not there.
  const ranked = sectors.length >= 2 && best.changePct !== worst!.changePct;

  return {
    indices,
    vix,
    leader: ranked ? best : null,
    laggard: ranked ? worst! : null,
  };
}
