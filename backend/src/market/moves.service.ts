import { Injectable } from '@nestjs/common';
import { etDate } from '../earnings/week.js';
import { wilderAtr } from '../market-data/atr.js';
import { currentSession } from '../market-data/session.js';
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
const LOOKBACK_DAYS = 45;
const QUOTE_TTL_MS = 60_000;
const CONCURRENCY = 5;

const round1 = (n: number) => Math.round(n * 10) / 10;

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
  private readonly barCache = new Map<string, { key: string; bars: DailyBar[] }>();
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
      // Completed regular sessions only: a bar still forming today is dropped.
      const completed = live ? all.filter((b) => b.date < asOf) : all.filter((b) => b.date <= asOf);

      if (live) {
        const last = completed[completed.length - 1];
        const atr = wilderAtr(completed, PERIOD);
        const quote = await this.quote(symbol, now).catch(() => null);
        return {
          ...empty,
          atrPercent: atr !== null && last ? round1((atr / last.close) * 100) : null,
          movePercent:
            quote && quote.previousClose > 0
              ? round1(((quote.price - quote.previousClose) / quote.previousClose) * 100)
              : null,
        };
      }

      // Not live: the move belongs to the last completed session, which must be asOf.
      const last = completed[completed.length - 1];
      if (!last || last.date !== asOf) return empty;
      const before = completed.slice(0, -1);
      const ref = before[before.length - 1];
      if (!ref) return empty;
      const atr = wilderAtr(before, PERIOD);
      return {
        ...empty,
        atrPercent: atr !== null ? round1((atr / ref.close) * 100) : null,
        movePercent: ref.close > 0 ? round1(((last.close - ref.close) / ref.close) * 100) : null,
      };
    } catch {
      return empty;
    }
  }

  private async bars(symbol: string, now: Date, live: boolean, asOf: string): Promise<DailyBar[]> {
    const key = `${etDate(now)}|${asOf}|${live}`;
    const hit = this.barCache.get(symbol);
    if (hit && hit.key === key) return hit.bars;
    const from = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);
    const bars = await this.yahoo.dailyBars(symbol, from);
    // After the close, bars that do not yet include the session are not cached:
    // the provider may simply be late, and a stale answer would stick all day.
    const complete = live || bars.some((b) => b.date === asOf);
    if (complete) this.barCache.set(symbol, { key, bars });
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
