import type { RawBar } from './yahoo.client.js';

/**
 * How the ticker has actually traded lately: today, the past week, and the
 * shape of the last ten sessions.
 *
 * The indicators in `indicators.ts` say where price sits relative to its
 * averages; they say nothing about what it just did. An opinion on a
 * cup-and-handle breakout needs both — "+8% today on a reversal off the lows"
 * and "flat all week" are different trades at the same distance from the
 * 20-day average.
 *
 * Pure, so it is fixture-tested with no network: the house style of
 * `derive.ts` and `indicators.ts`. Costs no extra provider call, because
 * `TickerFactsService` has already fetched these bars.
 */
export interface SessionBar {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
}

export interface PriceAction {
  today: SessionBar & {
    /** Against the PREVIOUS close, the way every quote screen reports it. */
    changePercent: number | null;
  };
  week: {
    changePercent: number | null;
    high: number | null;
    low: number | null;
    /** How many sessions that covers — fewer than 6 when history is short. */
    sessions: number;
  };
  /** The last ten sessions, oldest first. */
  recent: SessionBar[];
}

const WEEK_SESSIONS = 6;
const RECENT_SESSIONS = 10;

function toSession(bar: RawBar): SessionBar {
  return {
    date: bar.date,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  };
}

/** Highest of the values that exist. Null when none do — never 0. */
function maxOf(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? null : Math.max(...present);
}

function minOf(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? null : Math.min(...present);
}

export function computePriceAction(bars: RawBar[]): PriceAction | null {
  if (bars.length === 0) return null;

  const last = bars[bars.length - 1];
  const previous = bars.length > 1 ? bars[bars.length - 2] : null;

  // Against the previous close, not the open: that is what "up 8% today"
  // means on every screen he reads, and a gap would otherwise vanish.
  const changePercent =
    previous !== null && previous.close > 0
      ? (last.close - previous.close) / previous.close
      : null;

  const window = bars.slice(-WEEK_SESSIONS);
  const weekBase = window.length > 1 ? window[0].close : null;

  return {
    today: { ...toSession(last), changePercent },
    week: {
      changePercent:
        weekBase !== null && weekBase > 0
          ? (last.close - weekBase) / weekBase
          : null,
      // Falls back to the close when a bar has no high or low, so a missing
      // field can never make the range appear to run to zero.
      high: maxOf(window.map((b) => b.high ?? b.close)),
      low: minOf(window.map((b) => b.low ?? b.close)),
      sessions: window.length,
    },
    recent: bars.slice(-RECENT_SESSIONS).map(toSession),
  };
}
