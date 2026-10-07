import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PortfolioService } from '../portfolio/portfolio.service.js';
import { WatchlistService } from '../watchlist/watchlist.service.js';
import { DailyClose } from './daily-close.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { HistoryService } from './history.service.js';
import { EconomicCalendarClient } from './economic-calendar.client.js';
import { buildDailyBriefNotes, isWatchTrigger, priorAtr } from './daily-brief.js';
import { buildQueue, type QueueItem } from './brief-queue.js';
import { rankMovers, type MoverRow } from './brief-movers.js';
import { NewsService } from './news.service.js';
import { MarketDataService } from './market-data.service.js';
import { lastExpectedSession, marketDate } from './trading-day.js';
import { computeMarketSession, type MarketSession } from './market-session.js';
import { buildMood, MOOD_INDICES, MOOD_QUOTE_SYMBOLS, type Mood, type MoodQuote } from './brief-mood.js';
import { LlmClient } from '../llm/llm.client.js';
import { buildDailyBriefContext } from '../llm/daily-brief-context.js';
import { buildDailyBriefUserPrompt } from '../llm/daily-brief-prompt.js';
import { buildSystemPrompt } from '../llm/prompts.js';
import { readTraderProfile } from '../llm/trader-profile.js';
import { UsersService } from '../users/users.service.js';
import { TradesService } from '../portfolio/trades.service.js';

export interface BriefEvent { title: string; detail: string; eventAt: string }
export interface WatchTrigger { kind: 'BREAKOUT' | 'MOMENTUM'; symbol: string; title: string; detail: string }

export interface DailyBriefResponse {
  generatedAt: string;
  refreshAfterSeconds: number;
  session: MarketSession;
  marketDataAvailable: boolean;
  mood: Mood;
  events: BriefEvent[];
  queue: QueueItem[];
  movers: MoverRow[];
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

/** Longest a mover's headline lookup may hold up the Brief. */
const HEADLINE_TIMEOUT_MS = 4000;

/** UTC offset of America/New_York at noon UTC on a calendar date, in hours (-4 or -5). */
function newYorkOffsetHours(date: string): number {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' })
    .formatToParts(new Date(`${date}T12:00:00Z`))
    .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-5';
  const match = /GMT([+-]\d+)/.exec(part);
  return match ? Number(match[1]) : -5;
}

/** News that can explain the move on screen: from 24h before the most recent session's 09:30 ET open, or the last 24h, whichever reaches further back. */
export function headlineWindowStart(now: Date): Date {
  const session = lastExpectedSession(now);
  const open = new Date(`${session}T09:30:00Z`);
  open.setUTCHours(open.getUTCHours() - newYorkOffsetHours(session));
  const day = 24 * 60 * 60 * 1000;
  return new Date(Math.min(now.getTime() - day, open.getTime() - day));
}

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
  queue: QueueItem[];
  movers: MoverRow[];
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
    // Optional for the same reason: without it there are no thesis checks.
    private readonly trades?: TradesService,
    // Optional for the same reason: without it movers carry no headline.
    private readonly news?: NewsService,
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
    const [portfolio, watched, calendar, moodQuotes, openEntries] = await Promise.all([
      this.portfolio.getPortfolio({ refresh }),
      this.watchlist.list({ refresh }),
      this.calendar.week(isoDate(weekStart), isoDate(weekEnd)),
      this.moodQuotes(refresh),
      this.openTradeEntries(),
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
    const watchTriggers: WatchTrigger[] = [];
    for (const row of watchOnly) {
      if (row.price === null || row.price === undefined || !instrumentBySymbol.has(row.symbol)) continue;
      const notes = buildDailyBriefNotes({ symbol: row.symbol, source: 'WATCHLIST', price: row.price, bars: barsFor(row.symbol), spyBars });
      for (const note of notes) {
        if (isWatchTrigger(note)) {
          watchTriggers.push({ kind: note.kind, symbol: note.symbol, title: note.title, detail: note.detail });
        }
      }
    }

    const events: BriefEvent[] = calendar.events.map((event) => ({ title: event.title, detail: event.detail, eventAt: event.date }));
    const mood = buildMood({ quotes: moodQuotes, indexBars: { SPY: barsFor('SPY'), QQQ: barsFor('QQQ') } });
    const session = computeMarketSession(now);
    const atrBySymbol = new Map<string, number>(
      [...held].flatMap((symbol) => {
        const atr = priorAtr(barsFor(symbol));
        return atr === null ? [] : [[symbol, atr] as const];
      }),
    );
    const queue = buildQueue({
      now,
      session,
      positions: portfolio.positions.map((p: { symbol: string; marketValue: number | null; stale: boolean }) => ({
        symbol: p.symbol, marketValue: p.marketValue ?? null, stale: p.stale,
      })),
      stopTiers: portfolio.stopTiers ?? [],
      stopPlanIssues: (portfolio.atRisk?.stopPlanNeedsUpdate?.positions ?? []).map(
        (p: { symbol: string; issue: string }) => ({ symbol: p.symbol, issue: p.issue }),
      ),
      symbolsWithoutStop: portfolio.atRisk?.positionsWithoutStop?.symbols ?? [],
      partialStops: portfolio.atRisk?.positionsWithPartialStop?.positions ?? [],
      atrBySymbol,
      earningsDateBySymbol: new Map(
        [...held].flatMap((symbol) => {
          const date = instrumentBySymbol.get(symbol)?.nextEarningsDate;
          return date ? [[symbol, date] as const] : [];
        }),
      ),
      theses: openEntries
        .filter((entry) => held.has(entry.symbol))
        .map((entry) => ({
          symbol: entry.symbol,
          direction: entry.direction,
          reasons: entry.reasons,
          entryDate: marketDate(entry.enteredAt),
          bars: barsFor(entry.symbol),
        })),
    });
    const ranked = rankMovers(
      portfolio.positions.map((p) => ({
        symbol: p.symbol, dayChange: p.dayChange ?? null, dayChangePct: p.dayChangePct ?? null,
        dayPnl: p.dayPnl ?? null, extended: p.extended ?? false, stale: p.stale ?? true, session: p.session ?? null,
      })),
      atrBySymbol,
      new Map(openEntries.map((e) => [e.symbol, e.reasons])),
    );
    const movers = await this.attachHeadlines(ranked, now);
    const narrative = await this.buildNarrative(now, { session, mood, events, queue, movers, watchTriggers });

    return {
      generatedAt: now.toISOString(), refreshAfterSeconds: 300, session,
      marketDataAvailable: calendar.available, mood, events, queue, movers, watchTriggers,
      narrative: narrative?.text ?? null, narrativeAt: narrative?.at.toISOString() ?? null,
    };
  }

  /** One headline per mover (see headlineWindowStart). Never throws or waits long: news is enrichment. */
  private async attachHeadlines(movers: MoverRow[], now: Date): Promise<MoverRow[]> {
    if (!this.news || movers.length === 0) return movers;
    const since = headlineWindowStart(now);
    return Promise.all(movers.map(async (m) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`timed out after ${HEADLINE_TIMEOUT_MS}ms`)), HEADLINE_TIMEOUT_MS);
        });
        return { ...m, headline: await Promise.race([this.news!.latestHeadline(m.symbol, since), timeout]) };
      } catch (err) {
        this.logger.warn(`daily brief headline for ${m.symbol} failed: ${err instanceof Error ? err.message : String(err)}`);
        return { ...m, headline: null };
      } finally {
        clearTimeout(timer);
      }
    }));
  }

  /** Never throws: thesis checks are an extra, not something the brief depends on. */
  private async openTradeEntries(): Promise<Awaited<ReturnType<TradesService['openTradeEntries']>>> {
    if (!this.trades) return [];
    try {
      return await this.trades.openTradeEntries();
    } catch (err) {
      this.logger.warn(`daily brief thesis read failed: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
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
      return new Map([...quotes].map(([symbol, q]) => [symbol, { price: q.price, previousClose: q.previousClose, stale: q.stale, extended: q.extended, session: q.session, regularPrice: q.regularPrice }]));
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
      session: facts.session,
      day: now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }),
      events: facts.watchTriggers.map((n) => [n.kind, n.symbol]),
      queue: facts.queue.map((q) => [q.kind, q.symbol]),
      // Sorted by symbol: two movers swapping rank is not news worth a model call.
      movers: facts.movers.map((m) => [m.symbol, m.headline?.url ?? null]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
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
      const context = buildDailyBriefContext({
        generatedAt: now.toISOString(),
        ...facts,
        movers: facts.movers.map((m) => ({
          symbol: m.symbol, changePct: m.changePct, atrMultiple: m.atrMultiple, dollarChange: m.dollarChange,
          extended: m.extended, stale: m.stale,
          headline: m.headline ? { title: m.headline.title, source: m.headline.source } : null,
        })),
      });
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
