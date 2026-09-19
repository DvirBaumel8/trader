import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PortfolioService } from '../portfolio/portfolio.service.js';
import { WatchlistService } from '../watchlist/watchlist.service.js';
import { DailyClose } from './daily-close.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { HistoryService } from './history.service.js';
import { EconomicCalendarClient } from './economic-calendar.client.js';
import { buildDailyBriefNotes, type BriefNote } from './daily-brief.js';
import type { MarketSession } from './select-price.js';
import { LlmClient } from '../llm/llm.client.js';
import { buildDailyBriefContext } from '../llm/daily-brief-context.js';
import { buildDailyBriefUserPrompt } from '../llm/daily-brief-prompt.js';
import { buildSystemPrompt } from '../llm/prompts.js';
import { readTraderProfile } from '../llm/trader-profile.js';

export interface DailyBriefResponse {
  generatedAt: string;
  refreshAfterSeconds: number;
  marketDataAvailable: boolean;
  coverage: {
    source: 'PORTFOLIO' | 'WATCHLIST';
    symbol: string;
    price: number | null;
    regularPrice: number | null;
    stale: boolean;
    session: MarketSession | null;
    extended: boolean;
  }[];
  notes: (BriefNote | {
    kind: 'EARNINGS' | 'ECONOMIC' | 'QUIET_DAY';
    source: 'PORTFOLIO' | 'WATCHLIST' | 'MARKET';
    symbol: string | null;
    title: string;
    detail: string;
    eventAt?: string;
    actual?: number | null;
    expected?: number | null;
  })[];
  /**
   * A short, prioritized read over the notes/coverage above, from the same
   * app-computed facts — never a source of numbers itself, only judgement
   * and prioritization on top of them (see prompts.ts's governing rule).
   * Null whenever there is nothing to show it: no LLM configured, or the
   * call failed — silent by design, the same as an unconfigured Finnhub or
   * Twelve Data key, since the notes and coverage below stand on their own.
   */
  narrative: string | null;
}

/** Read first, gets the reader's attention first — a loud move or an event risk outranks a slow-moving trend. */
const NOTE_KIND_PRIORITY: Record<string, number> = {
  EARNINGS: 0,
  ATR_MOVE: 1,
  BREAKOUT: 2,
  MOMENTUM: 3,
  ECONOMIC: 4,
  QUIET_DAY: 5,
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfWeek(now: Date): Date {
  const start = new Date(now);
  const day = start.getUTCDay();
  start.setUTCDate(start.getUTCDate() - (day === 0 ? 6 : day - 1));
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

@Injectable()
export class DailyBriefService {
  private readonly logger = new Logger(DailyBriefService.name);

  constructor(
    private readonly portfolio: PortfolioService,
    private readonly watchlist: WatchlistService,
    @InjectRepository(DailyClose)
    private readonly closes: Repository<DailyClose>,
    @InjectRepository(Instrument)
    private readonly instruments: Repository<Instrument>,
    private readonly history: HistoryService,
    private readonly calendar: EconomicCalendarClient,
    // Optional, defaulting to "no client": every constructor call site that
    // predates the AI narrative (all of this file's own tests included)
    // keeps working unchanged, reading as "unconfigured" — the same
    // first-class state a missing API key already produces.
    private readonly llm?: LlmClient,
  ) {}

  async get(options: { refresh?: boolean; now?: Date } = {}): Promise<DailyBriefResponse> {
    const now = options.now ?? new Date();
    const refresh = options.refresh === true;
    void this.history.ensureFresh().catch(() => {});
    const weekStart = startOfWeek(now);
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    const [portfolio, watched, calendar] = await Promise.all([
      this.portfolio.getPortfolio({ refresh }),
      this.watchlist.list({ refresh }),
      this.calendar.week(isoDate(weekStart), isoDate(weekEnd)),
    ]);
    const coverageBySymbol = new Map<string, DailyBriefResponse['coverage'][number]>();
    for (const position of portfolio.positions) coverageBySymbol.set(position.symbol, {
      source: 'PORTFOLIO', symbol: position.symbol, price: position.price,
      regularPrice: position.regularPrice, stale: position.stale,
      session: position.session, extended: position.extended,
    });
    for (const row of watched) if (!coverageBySymbol.has(row.symbol)) coverageBySymbol.set(row.symbol, {
      source: 'WATCHLIST', symbol: row.symbol, price: row.price,
      regularPrice: row.regularPrice, stale: row.stale,
      session: row.session, extended: row.extended,
    });

    const symbols = [...coverageBySymbol.keys()];
    const instruments = await this.instruments.find({ where: { symbol: In([...symbols, 'SPY']) } });
    const instrumentBySymbol = new Map(instruments.map((instrument) => [instrument.symbol, instrument]));
    const bars = await this.closes.find({
      where: { instrumentId: In(instruments.map((instrument) => instrument.id)) },
      order: { date: 'ASC' },
    });
    const barsByInstrument = new Map<string, typeof bars>();
    for (const bar of bars) {
      const current = barsByInstrument.get(bar.instrumentId) ?? [];
      current.push(bar);
      barsByInstrument.set(bar.instrumentId, current);
    }
    const spyBars = barsByInstrument.get(instrumentBySymbol.get('SPY')?.id ?? '') ?? [];
    // Positions with a notable move but nothing protecting them are exactly
    // what a margin trader most needs flagged, not left for the Stops page
    // to surface separately — this is already computed there, just reused.
    const symbolsWithoutStop = new Set<string>(
      portfolio.atRisk?.positionsWithoutStop?.symbols ?? [],
    );
    const notes: DailyBriefResponse['notes'] = [];
    for (const symbol of symbols) {
      const price = coverageBySymbol.get(symbol)?.price;
      const instrument = instrumentBySymbol.get(symbol);
      if (price !== undefined && price !== null && instrument) {
        const symbolNotes = buildDailyBriefNotes({
          symbol,
          source: coverageBySymbol.get(symbol)!.source,
          price,
          bars: barsByInstrument.get(instrument.id) ?? [],
          spyBars,
        });
        if (symbolsWithoutStop.has(symbol)) {
          for (const note of symbolNotes) {
            note.detail = `${note.detail} No stop is set on this position.`;
          }
        }
        notes.push(...symbolNotes);
      }
    }

    const weekDays = (days: number | null) => days !== null && days >= 0 && days <= 6;
    for (const position of portfolio.positions) {
      if (weekDays(position.daysUntilEarnings)) notes.push({ kind: 'EARNINGS', source: 'PORTFOLIO', symbol: position.symbol, title: `${position.symbol} has earnings this week`, detail: position.daysUntilEarnings === 0 ? 'Earnings are today.' : `Earnings are in ${position.daysUntilEarnings} days.` });
    }
    for (const row of watched) {
      if (weekDays(row.daysUntilEarnings) && !portfolio.positions.some((position) => position.symbol === row.symbol)) notes.push({ kind: 'EARNINGS', source: 'WATCHLIST', symbol: row.symbol, title: `${row.symbol} has earnings this week`, detail: row.daysUntilEarnings === 0 ? 'Earnings are today.' : `Earnings are in ${row.daysUntilEarnings} days.` });
    }
    for (const event of calendar.events) notes.push({ kind: 'ECONOMIC', source: 'MARKET', symbol: null, title: event.title, detail: event.detail, eventAt: event.date });

    // Never a blank screen on an uneventful day — the whole point of a daily
    // read is confirming there is nothing to worry about, not wondering
    // whether the page is broken. Only reached when nothing else fired, and
    // only says something when there is real bar data to say it from.
    if (notes.length === 0) {
      const quietDayNote = biggestMoverNote(symbols, coverageBySymbol, instrumentBySymbol, barsByInstrument);
      if (quietDayNote) notes.push(quietDayNote);
    }

    notes.sort((a, b) => (NOTE_KIND_PRIORITY[a.kind] ?? 99) - (NOTE_KIND_PRIORITY[b.kind] ?? 99));

    const coverage = [...coverageBySymbol.values()];
    const narrative = await this.buildNarrative(now, notes, coverage);

    return { generatedAt: now.toISOString(), refreshAfterSeconds: 300, marketDataAvailable: calendar.available, coverage, notes, narrative };
  }

  /**
   * Never throws, never blocks the rest of the brief on a model hiccup — the
   * notes and coverage above are the source of truth and stand on their own
   * whether or not this succeeds.
   */
  private async buildNarrative(
    now: Date,
    notes: DailyBriefResponse['notes'],
    coverage: DailyBriefResponse['coverage'],
  ): Promise<string | null> {
    if (!this.llm || !this.llm.isConfigured()) return null;
    try {
      const facts = buildDailyBriefContext({
        generatedAt: now.toISOString(),
        notes: notes.map((note) => ({ source: note.source, title: note.title, detail: note.detail })),
        coverage,
      });
      const profile = await readTraderProfile();
      const system = buildSystemPrompt(profile);
      const user = buildDailyBriefUserPrompt(facts);
      return await this.llm.complete({ system, user, grounded: false });
    } catch (err) {
      this.logger.warn(
        `daily brief narrative failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}

/**
 * The single biggest day-over-day close-to-close mover across everything
 * covered, or null when there isn't enough bar history anywhere to say —
 * never a fabricated "quiet day" when the real answer is "no data yet".
 */
function biggestMoverNote(
  symbols: string[],
  coverageBySymbol: Map<string, DailyBriefResponse['coverage'][number]>,
  instrumentBySymbol: Map<string, { id: string; symbol: string }>,
  barsByInstrument: Map<string, { close: number }[]>,
): DailyBriefResponse['notes'][number] | null {
  let best: { symbol: string; source: 'PORTFOLIO' | 'WATCHLIST'; changePercent: number } | null = null;
  for (const symbol of symbols) {
    const instrument = instrumentBySymbol.get(symbol);
    if (!instrument) continue;
    const bars = barsByInstrument.get(instrument.id) ?? [];
    if (bars.length < 2) continue;
    const previous = bars.at(-2)!.close;
    const latest = bars.at(-1)!.close;
    if (!(previous > 0)) continue;
    const changePercent = ((latest - previous) / previous) * 100;
    if (!best || Math.abs(changePercent) > Math.abs(best.changePercent)) {
      best = { symbol, source: coverageBySymbol.get(symbol)!.source, changePercent };
    }
  }
  if (!best) return null;
  const sign = best.changePercent >= 0 ? '+' : '';
  return {
    kind: 'QUIET_DAY',
    source: best.source,
    symbol: best.symbol,
    title: 'Quiet day across your coverage',
    detail: `${best.symbol} moved the most today, at ${sign}${best.changePercent.toFixed(1)}%.`,
  };
}
