import type { RawBar } from './yahoo.client.js';

export type BriefSource = 'PORTFOLIO' | 'WATCHLIST';
export type BriefKind = 'ATR_MOVE' | 'MOMENTUM' | 'BREAKOUT';

export interface BriefSymbolInput {
  symbol: string;
  source: BriefSource;
  price: number;
  bars: RawBar[];
  spyBars: RawBar[];
}

export interface BriefNote {
  kind: BriefKind;
  symbol: string;
  source: BriefSource;
  title: string;
  detail: string;
}

const ATR_PERIOD = 14;
const TREND_PERIOD = 20;
const LONG_TREND_PERIOD = 50;
const BREAKOUT_LOOKBACK = 20;
const BREAKOUT_RELATIVE_VOLUME = 1.5;
const MOMENTUM_STREAK_CAP = 30;

function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const multiplier = 2 / (period + 1);
  let value = values.slice(0, period).reduce((sum, n) => sum + n, 0) / period;
  for (const next of values.slice(period)) value = (next - value) * multiplier + value;
  return value;
}

function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  return values.slice(-period).reduce((sum, n) => sum + n, 0) / period;
}

function trueRange(bar: RawBar, previous: RawBar): number | null {
  if (bar.high === null || bar.low === null) return null;
  return Math.max(
    bar.high - bar.low,
    Math.abs(bar.high - previous.close),
    Math.abs(bar.low - previous.close),
  );
}

function priorAtr(bars: RawBar[]): number | null {
  if (bars.length < ATR_PERIOD + 1) return null;
  const end = bars.length - 1;
  const ranges: number[] = [];
  for (let i = end - ATR_PERIOD; i < end; i++) {
    const range = trueRange(bars[i], bars[i - 1]);
    if (range === null) return null;
    ranges.push(range);
  }
  return ranges.reduce((sum, range) => sum + range, 0) / ranges.length;
}

function relativeVolume(bars: RawBar[]): number | null {
  if (bars.length < BREAKOUT_LOOKBACK + 1) return null;
  const latest = bars.at(-1)?.volume;
  const prior = bars.slice(-(BREAKOUT_LOOKBACK + 1), -1)
    .map((bar) => bar.volume)
    .filter((volume): volume is number => volume !== null && volume > 0);
  if (latest === undefined || latest === null || prior.length < BREAKOUT_LOOKBACK) return null;
  const average = prior.reduce((sum, volume) => sum + volume, 0) / prior.length;
  return average > 0 ? latest / average : null;
}

function fiveDayEmaAgo(bars: RawBar[]): number | null {
  if (bars.length < TREND_PERIOD + 5) return null;
  return ema(bars.slice(0, -5).map((bar) => bar.close), TREND_PERIOD);
}

function twentyDayReturn(bars: RawBar[]): number | null {
  if (bars.length < TREND_PERIOD + 1) return null;
  const start = bars.at(-(TREND_PERIOD + 1))!.close;
  const end = bars.at(-1)!.close;
  return start > 0 ? (end - start) / start : null;
}

/** The MOMENTUM rule's own condition, factored out so a streak can replay it against earlier days. */
function momentumHolds(
  bars: RawBar[],
  spyBars: RawBar[],
  priceAt: number,
): boolean {
  const closes = bars.map((bar) => bar.close);
  const ema20 = ema(closes, TREND_PERIOD);
  const sma50 = sma(closes, LONG_TREND_PERIOD);
  const ema20FiveDaysAgo = fiveDayEmaAgo(bars);
  const stockReturn = twentyDayReturn(bars);
  const spyReturn = twentyDayReturn(spyBars);
  return (
    ema20 !== null &&
    sma50 !== null &&
    ema20FiveDaysAgo !== null &&
    stockReturn !== null &&
    spyReturn !== null &&
    priceAt > ema20 &&
    ema20 > sma50 &&
    ema20 > ema20FiveDaysAgo &&
    stockReturn > spyReturn
  );
}

/**
 * How many consecutive trading days (ending today) the MOMENTUM condition
 * has held, by replaying it against progressively earlier days — not stored
 * anywhere, recomputed fresh from the same bars every time, the same way
 * every other derived figure in this app is. Without this, a trend that
 * started two weeks ago repeats the identical "has good momentum" sentence
 * every single day, which is exactly the kind of stale alert a daily reader
 * learns to stop reading. Capped rather than walking the whole history: the
 * exact count stops mattering once it is "over a month".
 */
export function momentumStreakDays(bars: RawBar[], spyBars: RawBar[]): number {
  const sortedBars = [...bars].sort((a, b) => a.date.localeCompare(b.date));
  const sortedSpy = [...spyBars].sort((a, b) => a.date.localeCompare(b.date));
  let streak = 0;
  for (let back = 0; back < MOMENTUM_STREAK_CAP; back++) {
    const end = sortedBars.length - back;
    if (end < LONG_TREND_PERIOD + 5) break;
    const slice = sortedBars.slice(0, end);
    const spySlice = sortedSpy.slice(0, Math.min(end, sortedSpy.length));
    if (!momentumHolds(slice, spySlice, slice.at(-1)!.close)) break;
    streak++;
  }
  return streak;
}

export function buildDailyBriefNotes(input: BriefSymbolInput): BriefNote[] {
  const bars = [...input.bars].sort((a, b) => a.date.localeCompare(b.date));
  const notes: BriefNote[] = [];
  const latest = bars.at(-1);
  const previous = bars.at(-2);
  const atr = priorAtr(bars);

  if (latest && previous && atr !== null && atr > 0) {
    const move = Math.abs(latest.close - previous.close);
    if (move >= atr) {
      notes.push({
        kind: 'ATR_MOVE',
        symbol: input.symbol,
        source: input.source,
        title: `${input.symbol} moved ${(move / atr).toFixed(1)}× its daily ATR`,
        detail: `Today’s move was ${(move / atr).toFixed(1)} ATR from the prior close.`,
      });
    }
  }

  const closes = bars.map((bar) => bar.close);
  const ema20 = ema(closes, TREND_PERIOD);
  const sma50 = sma(closes, LONG_TREND_PERIOD);
  const ema20FiveDaysAgo = fiveDayEmaAgo(bars);
  const stockReturn = twentyDayReturn(bars);
  const spyReturn = twentyDayReturn([...input.spyBars].sort((a, b) => a.date.localeCompare(b.date)));
  if (
    ema20 !== null &&
    sma50 !== null &&
    ema20FiveDaysAgo !== null &&
    stockReturn !== null &&
    spyReturn !== null &&
    input.price > ema20 &&
    ema20 > sma50 &&
    ema20 > ema20FiveDaysAgo &&
    stockReturn > spyReturn
  ) {
    const streak = momentumStreakDays(bars, input.spyBars);
    const title =
      streak > 1
        ? `${input.symbol} has been in a momentum trend for ${
            streak >= MOMENTUM_STREAK_CAP ? `${MOMENTUM_STREAK_CAP}+` : streak
          } days`
        : `${input.symbol} has good momentum`;
    notes.push({
      kind: 'MOMENTUM',
      symbol: input.symbol,
      source: input.source,
      title,
      detail: `Above rising trend averages and outperforming SPY by ${((stockReturn - spyReturn) * 100).toFixed(1)}%.`,
    });
  }

  if (bars.length >= BREAKOUT_LOOKBACK + 1 && latest) {
    const prior = bars.slice(-(BREAKOUT_LOOKBACK + 1), -1);
    const priorHighs = prior.map((bar) => bar.high ?? bar.close);
    const priorHigh = Math.max(...priorHighs);
    const volume = relativeVolume(bars);
    if (latest.close > priorHigh && volume !== null && volume >= BREAKOUT_RELATIVE_VOLUME) {
      notes.push({
        kind: 'BREAKOUT',
        symbol: input.symbol,
        source: input.source,
        title: `${input.symbol} confirmed a breakout`,
        detail: `Closed above its prior 20-day high on ${volume.toFixed(1)}× average volume.`,
      });
    }
  }

  return notes;
}
