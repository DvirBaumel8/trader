import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PortfolioService } from '../portfolio/portfolio.service.js';
import { WatchlistService } from '../watchlist/watchlist.service.js';
import { DailyClose } from './daily-close.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { HistoryService } from './history.service.js';
import { EconomicCalendarClient } from './economic-calendar.client.js';
import { buildDailyBriefNotes, isWatchTrigger } from './daily-brief.js';
import { MarketDataService } from './market-data.service.js';
import { computeMarketSession, type MarketSession } from './market-session.js';
import { buildMood, MOOD_INDICES, MOOD_QUOTE_SYMBOLS, type Mood, type MoodQuote } from './brief-mood.js';
import { LlmClient } from '../llm/llm.client.js';
import { buildDailyBriefContext } from '../llm/daily-brief-context.js';
import { buildDailyBriefUserPrompt } from '../llm/daily-brief-prompt.js';
import { buildSystemPrompt } from '../llm/prompts.js';
import { readTraderProfile } from '../llm/trader-profile.js';
import { UsersService } from '../users/users.service.js';

export interface BriefEvent { title: string; detail: string; eventAt: string }
export interface HoldingNote { kind: 'ATR_MOVE' | 'MOMENTUM' | 'BREAKOUT' | 'EARNINGS'; symbol: string; title: string; detail: string }
export interface WatchTrigger { kind: 'BREAKOUT' | 'MOMENTUM'; symbol: string; title: string; detail: string }

export interface DailyBriefResponse {
  generatedAt: string;
  refreshAfterSeconds: number;
  session: MarketSession;
  marketDataAvailable: boolean;
  mood: Mood;
  events: BriefEvent[];
  /** Interim (Brief redesign slice 1): replaced by the decision queue and movers in slices 2–3. */
  holdingNotes: HoldingNote[];
  watchTriggers: WatchTrigger[];
  /**
   * A short, prioritized read over the facts above, from the same
   * app-computed facts — never a source of numbers itself, only judgement
   * and prioritization on top of them (see prompts.ts's governing rule).
   * Null whenever there is nothing to show it: no LLM configured, or the
   * call failed — silent by design, the same as an unconfigured Finnhub or
   * Twelve Data key, since the facts above stand on their own.
   */
  narrative: string | null;
  /** When the narrative was written — earlier than generatedAt when reused. */
  narrativeAt: string | null;
}

/** How long a narrative is reused while the same events stand. */
const NARRATIVE_MAX_AGE_MS = 30 * 60 * 1000;

/** Read first, gets the reader's attention first — a loud move or an event risk outranks a slow-moving trend. */
const HOLDING_NOTE_PRIORITY: Record<HoldingNote['kind'], number> = { EARNINGS: 0, ATR_MOVE: 1, BREAKOUT: 2, MOMENTUM: 3 };

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

/** What the narrative is written from: the response's facts, before they are serialised. */
interface BriefFacts {
  session: MarketSession;
  mood: Mood;
  events: BriefEvent[];
  holdingNotes: HoldingNote[];
  watchTriggers: WatchTrigger[];
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
    // Optional for the same reason; without it no profile is sent.
    private readonly users?: UsersService,
    // Optional for the same reason: existing positional call sites read as
    // "no mood" (an empty one), not as a missing dependency.
    private readonly marketData?: MarketDataService,
  ) {}

  /**
   * Last narrative per user, with the events it was written from and when.
   * The brief is prefetched on every app open and refetched every five
   * minutes; asking the model each time spent the free tier's ~20 requests
   * a day on repeats, and the features the owner asks for on purpose then
   * failed on quota. A narrative is reused while the same events stand, for
   * at most NARRATIVE_MAX_AGE_MS — note details carry live percentages that
   * change every refresh in session, so matching on them would never hit.
   * Its own timestamp goes out with it, so the screen can say how old its
   * figures are. One entry per user, so it cannot grow unbounded.
   */
  private readonly narratives = new Map<
    string,
    { signature: string; text: string; at: Date }
  >();

  async get(options: { refresh?: boolean; now?: Date } = {}): Promise<DailyBriefResponse> {
    const now = options.now ?? new Date();
    const refresh = options.refresh === true;
    void this.history.ensureFresh().catch(() => {});
    const weekStart = startOfWeek(now);
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    const [portfolio, watched, calendar, moodQuotes] = await Promise.all([
      this.portfolio.getPortfolio({ refresh }),
      this.watchlist.list({ refresh }),
      this.calendar.week(isoDate(weekStart), isoDate(weekEnd)),
      this.moodQuotes(refresh),
    ]);
    const held = new Set<string>(portfolio.positions.map((position: { symbol: string }) => position.symbol));
    const watchOnly = watched.filter((row) => !held.has(row.symbol));
    const symbols = [...held, ...watchOnly.map((row) => row.symbol)];

    const instruments = await this.instruments.find({ where: { symbol: In([...symbols, ...MOOD_INDICES]) } });
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
    const barsFor = (symbol: string) => barsByInstrument.get(instrumentBySymbol.get(symbol)?.id ?? '') ?? [];
    const spyBars = barsFor('SPY');
    // Positions with a notable move but nothing protecting them are exactly
    // what a margin trader most needs flagged, not left for the Stops page
    // to surface separately — this is already computed there, just reused.
    const symbolsWithoutStop = new Set<string>(
      portfolio.atRisk?.positionsWithoutStop?.symbols ?? [],
    );
    // A healthy plan that simply covers fewer shares than are held — the
    // uncovered remainder is exactly as unbounded a risk as no stop at
    // all, so a notable move on it deserves the same callout, worded for
    // what's actually true of it.
    const partialStopBySymbol = new Map<string, { coveredQuantity: number; heldQuantity: number }>(
      (portfolio.atRisk?.positionsWithPartialStop?.positions ?? []).map(
        (p: { symbol: string; coveredQuantity: number; heldQuantity: number }) => [
          p.symbol,
          { coveredQuantity: p.coveredQuantity, heldQuantity: p.heldQuantity },
        ],
      ),
    );
    const holdingNotes: HoldingNote[] = [];
    for (const position of portfolio.positions) {
      if (position.price !== null && position.price !== undefined && instrumentBySymbol.has(position.symbol)) {
        const notes = buildDailyBriefNotes({ symbol: position.symbol, source: 'PORTFOLIO', price: position.price, bars: barsFor(position.symbol), spyBars });
        const partialStop = partialStopBySymbol.get(position.symbol);
        for (const note of notes) {
          let detail = note.detail;
          if (symbolsWithoutStop.has(position.symbol)) detail = `${detail} No stop is set on this position.`;
          else if (partialStop) detail = `${detail} Partial stop: only ${partialStop.coveredQuantity} of ${partialStop.heldQuantity} shares are covered.`;
          holdingNotes.push({ kind: note.kind, symbol: note.symbol, title: note.title, detail });
        }
      }
      const days = position.daysUntilEarnings;
      if (days !== null && days !== undefined && days >= 0 && days <= 6) {
        holdingNotes.push({
          kind: 'EARNINGS', symbol: position.symbol,
          title: `${position.symbol} has earnings this week`,
          detail: days === 0 ? 'Earnings are today.' : `Earnings are in ${days} days.`,
        });
      }
    }
    holdingNotes.sort((a, b) => HOLDING_NOTE_PRIORITY[a.kind] - HOLDING_NOTE_PRIORITY[b.kind]);

    const watchTriggers: WatchTrigger[] = [];
    for (const row of watchOnly) {
      if (row.price === null || row.price === undefined || !instrumentBySymbol.has(row.symbol)) continue;
      const notes = buildDailyBriefNotes({ symbol: row.symbol, source: 'WATCHLIST', price: row.price, bars: barsFor(row.symbol), spyBars });
      for (const note of notes) {
        if (isWatchTrigger(note)) {
          watchTriggers.push({ kind: note.kind as WatchTrigger['kind'], symbol: note.symbol, title: note.title, detail: note.detail });
        }
      }
    }

    const events: BriefEvent[] = calendar.events.map((event) => ({ title: event.title, detail: event.detail, eventAt: event.date }));
    const mood = buildMood({ quotes: moodQuotes, indexBars: { SPY: barsFor('SPY'), QQQ: barsFor('QQQ') } });
    const session = computeMarketSession(now);
    const narrative = await this.buildNarrative(now, { session, mood, events, holdingNotes, watchTriggers });

    return {
      generatedAt: now.toISOString(), refreshAfterSeconds: 300, session,
      marketDataAvailable: calendar.available, mood, events, holdingNotes, watchTriggers,
      narrative: narrative?.text ?? null, narrativeAt: narrative?.at.toISOString() ?? null,
    };
  }

  /**
   * Never throws: the mood is context, not a fact the rest of the brief
   * depends on. `augment: false` leaves Twelve Data's free budget to the
   * positions and stops that must be right (see MarketDataService.getQuotes).
   */
  private async moodQuotes(refresh: boolean): Promise<Map<string, MoodQuote>> {
    if (!this.marketData) return new Map();
    try {
      const quotes = await this.marketData.getQuotes([...MOOD_QUOTE_SYMBOLS], refresh, false);
      return new Map([...quotes].map(([symbol, q]) => [symbol, { price: q.price, previousClose: q.previousClose, stale: q.stale, extended: q.extended }]));
    } catch (err) {
      this.logger.warn(`daily brief mood quotes failed: ${err instanceof Error ? err.message : String(err)}`);
      return new Map();
    }
  }

  /**
   * Never throws, never blocks the rest of the brief on a model hiccup — the
   * brief's facts are the source of truth and stand on their own
   * whether or not this succeeds.
   */
  private async buildNarrative(
    now: Date,
    facts: BriefFacts,
  ): Promise<{ text: string; at: Date } | null> {
    if (!this.llm || !this.llm.isConfigured()) return null;
    const userKey = this.users ? (await this.users.currentUser()).id : 'default';
    const signature = JSON.stringify({
      day: now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }),
      events: [...facts.holdingNotes, ...facts.watchTriggers].map((n) => [n.kind, n.symbol]),
      macro: facts.events.map((e) => e.title),
    });
    const cached = this.narratives.get(userKey);
    if (
      cached?.signature === signature &&
      now.getTime() - cached.at.getTime() < NARRATIVE_MAX_AGE_MS
    ) {
      return { text: cached.text, at: cached.at };
    }
    try {
      const context = buildDailyBriefContext({ generatedAt: now.toISOString(), ...facts });
      const profile = await readTraderProfile(this.users);
      const system = buildSystemPrompt(profile);
      const user = buildDailyBriefUserPrompt(context);
      const text = await this.llm.complete({ system, user, grounded: false });
      this.narratives.set(userKey, { signature, text, at: now });
      return { text, at: now };
    } catch (err) {
      this.logger.warn(
        `daily brief narrative failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
