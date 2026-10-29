import { Injectable } from '@nestjs/common';
import { etDate } from '../earnings/week.js';
import { trailingCompleteRun, wilderAtr } from '../market-data/atr.js';
import { closeMinutes, currentSession, etMinutes, previousTradingDay } from '../market-data/session.js';
import { DailyBar, RegularQuote, YahooClient } from '../market-data/yahoo.client.js';

export interface Move {
  symbol: string;
  /** Wilder 14-day ATR as a percent of the reference close, 1 decimal. */
  atrPercent: number | null;
  /** Regular-session move in percent, 1 decimal. */
  movePercent: number | null;
  live: boolean;
  /** ET date of the session the move belongs to. */
  asOf: string | null;
}

const PERIOD = 14;
// Long enough for Wilder's smoothing to converge like charting platforms do.
const LOOKBACK_DAYS = 150;
const SETTLE_MINUTES = 30;
const PROVISIONAL_TTL_MS = 10 * 60_000;
const QUOTE_TTL_MS = 60_000;
const CONCURRENCY = 5;

/** One decimal, half away from zero, never -0. */
export function round1(n: number): number {
  const r = Math.round(Math.abs(n) * 10) / 10;
  return r === 0 ? 0 : n < 0 ? -r : r;
}

/** ATR over the longest trailing run of complete bars; null if it is shorter than period + 1. */
const atrOf = (bars: DailyBar[]) => wilderAtr(trailingCompleteRun(bars), PERIOD);

const isWeekend = (ymd: string) => {
  const d = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
};

/**
 * Daily ATR% and regular-session move% for a list of symbols. All numbers and
 * rounding are decided here; the frontend only displays them.
 *
 * Session rule (America/New_York): while the regular session is open the move
 * is the regular-market price against the previous close, and ATR comes from
 * the completed sessions before today (a bar still forming is dropped).
 * Otherwise the move is the last completed session's close against the one
 * before it, ATR from the sessions before that. Pre-market and after-hours
 * prices are never used. Every failure degrades to null for that symbol.
 */
@Injectable()
export class MovesService {
  /** Bars per symbol, valid for one (asOf, live) session state. */
  private readonly barCache = new Map<string, { key: string; bars: DailyBar[]; expiresAt: number }>();
  private readonly quoteCache = new Map<string, { at: number; quote: RegularQuote | null }>();

  constructor(private readonly yahoo: YahooClient) {}

  async moves(symbols: string[], now = new Date()): Promise<Move[]> {
    const unique = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
    const out: Move[] = new Array(unique.length);
    let next = 0;
    const worker = async () => {
      while (next < unique.length) {
        const i = next++;
        out[i] = await this.one(unique[i], now);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length) }, worker));
    return out;
  }

  private async one(symbol: string, now: Date): Promise<Move> {
    const { live, asOf } = currentSession(now);
    const empty: Move = { symbol, atrPercent: null, movePercent: null, live, asOf };
    try {
      const all = await this.bars(symbol, now, live, asOf);
      // Weekend bars mean a 24/7 symbol (crypto): "regular session" does not apply.
      if (all.some((b) => isWeekend(b.date))) return empty;
      // Completed regular sessions only: a bar still forming today is dropped.
      const completed = live ? all.filter((b) => b.date < asOf) : all.filter((b) => b.date <= asOf);
      const last = completed[completed.length - 1];
      const prevSession = previousTradingDay(asOf);

      if (live) {
        // ATR only if the session just before today is present (no silent older data).
        const atr = last?.date === prevSession ? atrOf(completed) : null;
        const quote = await this.quote(symbol, now).catch(() => null);
        return {
          ...empty,
          atrPercent: atr !== null ? round1((atr / last.close) * 100) : null,
          movePercent: quoteMove(quote),
        };
      }

      if (last?.date === asOf) {
        // The move belongs to `last`; ATR and move share the close before it.
        const before = completed.slice(0, -1);
        const ref = before[before.length - 1];
        if (!ref) return empty;
        const atr = atrOf(before);
        return {
          ...empty,
          atrPercent: atr !== null ? round1((atr / ref.close) * 100) : null,
          movePercent: ref.close > 0 ? round1(((last.close - ref.close) / ref.close) * 100) : null,
        };
      }

      if (last?.date === prevSession) {
        // Closed, but the provider has not published today's bar yet: the
        // regular-market quote carries the close. (bars() leaves this uncached.)
        const atr = atrOf(completed);
        const quote = await this.quote(symbol, now).catch(() => null);
        return {
          ...empty,
          atrPercent: atr !== null ? round1((atr / last.close) * 100) : null,
          movePercent: quoteMove(quote),
        };
      }
      return empty;
    } catch {
      return empty;
    }
  }

  private async bars(symbol: string, now: Date, live: boolean, asOf: string): Promise<DailyBar[]> {
    const today = etDate(now);
    const key = `${today}|${asOf}|${live}`;
    const hit = this.barCache.get(symbol);
    if (hit && hit.key === key && now.getTime() < hit.expiresAt) return hit.bars;
    const from = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);
    const bars = await this.yahoo.dailyBars(symbol, from);
    // After the close the provider may be late with the session's bar, so
    // without it nothing is cached. Once it is there it can still be
    // provisional until the official close lands, so for the first
    // SETTLE_MINUTES after the close it is kept only briefly.
    const complete = live || bars.some((b) => b.date === asOf);
    if (complete) {
      const settling = !live && asOf === today && etMinutes(now) < closeMinutes(today) + SETTLE_MINUTES;
      this.barCache.set(symbol, {
        key,
        bars,
        expiresAt: settling ? now.getTime() + PROVISIONAL_TTL_MS : Infinity,
      });
    }
    return bars;
  }

  private async quote(symbol: string, now: Date): Promise<RegularQuote | null> {
    const hit = this.quoteCache.get(symbol);
    if (hit && now.getTime() - hit.at < QUOTE_TTL_MS && now.getTime() >= hit.at) return hit.quote;
    const quote = await this.yahoo.quote(symbol);
    this.quoteCache.set(symbol, { at: now.getTime(), quote });
    return quote;
  }
}

function quoteMove(quote: RegularQuote | null): number | null {
  return quote && quote.previousClose > 0
    ? round1(((quote.price - quote.previousClose) / quote.previousClose) * 100)
    : null;
}
