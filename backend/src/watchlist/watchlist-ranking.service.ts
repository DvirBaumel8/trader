import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { WatchlistRanking } from './watchlist-ranking.entity.js';
import { WatchlistService, WATCHLIST_LIMIT } from './watchlist.service.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { DailyClose } from '../market-data/daily-close.entity.js';
import { MarketDataService } from '../market-data/market-data.service.js';
import { computeIndicators, type IndicatorSet } from '../market-data/indicators.js';
import type { ConsensusResult, RawBar } from '../market-data/yahoo.client.js';
import { LlmClient, LlmFailure, type LlmFailureKind } from '../llm/llm.client.js';
import {
  buildRankingUserPrompt,
  RANKING_SYSTEM_PROMPT,
  type RankingCandidate,
} from '../llm/watchlist-ranking-prompt.js';
import { parseRanking, type RankedTicker } from '../llm/watchlist-ranking-parse.js';
import { buildBookSection, buildRecordSection } from '../llm/trade-idea-context.js';
import { readTraderProfile } from '../llm/trader-profile.js';
import { settleInChunks } from '../common/settle-in-chunks.js';
import { PortfolioService } from '../portfolio/portfolio.service.js';
import { TradesService } from '../portfolio/trades.service.js';
import { UsersService } from '../users/users.service.js';

/** Older than this, and the stored ranking is shown as stale rather than fresh. */
const STALE_MS = 24 * 60 * 60 * 1000;

/**
 * Routed to the cheaper Flash-Lite model rather than the default (Flash):
 * a ranking is a background, on-demand batch job, not the latency-sensitive
 * per-click feature trade-idea and symbol-pattern are, and Flash-Lite's
 * free-tier quota is meaningfully larger — conserving Flash's tighter one
 * for the features that need it more.
 */
const RANKING_MODEL = 'gemini-2.5-flash-lite';

/**
 * The watchlist has no single ticker to ask "do I already hold THIS one" or
 * "my history in THIS one" about — it asks about every candidate at once —
 * so `buildBookSection` / `buildRecordSection` are called with `null` for
 * those two callouts. `RankingCandidate.trades` carries the per-ticker
 * history a ranking DOES want, rendered separately per candidate by
 * `watchlist-ranking-prompt.ts`'s own `renderHistory`.
 */
const NO_SINGLE_TICKER = null;

/**
 * How many `getConsensus` calls run at once. Firing all fifty watchlist
 * tickers' worth at once is fifty concurrent `quoteSummary` requests to
 * Yahoo from one Render IP — a project that already has recorded trouble
 * with Yahoo fundamentals from there.
 */
const CONSENSUS_CONCURRENCY = 8;

export interface RankingResponse {
  configured: boolean;
  /** ISO timestamp; null when a ranking has never been computed. */
  rankedAt: string | null;
  model: string | null;
  order: RankedTicker[];
  reasoning: string | null;
  /** Watchlist tickers the model failed to place. Never silently dropped. */
  missing: string[];
  /** True when `rankedAt` is over 24h old. */
  stale: boolean;
}

interface StoredPayload {
  order: RankedTicker[];
  reasoning: string;
  missing: string[];
}

/** All-null indicators for a candidate with no usable price — see `refresh`. */
function emptyIndicators(barsAvailable: number): IndicatorSet {
  return {
    sma20: null,
    sma50: null,
    sma150: null,
    sma200: null,
    percentFromSma20: null,
    percentFromSma50: null,
    percentFromSma150: null,
    percentFromSma200: null,
    high52w: null,
    low52w: null,
    percentFromHigh52w: null,
    percentFromLow52w: null,
    atr14: null,
    atrPercentOfPrice: null,
    relativeVolume: null,
    barsAvailable,
  };
}

/**
 * Ranks the whole watchlist, best to worst, in ONE model call — the
 * integration point of the feature: the street (bought-in consensus), the
 * tape (computed from stored bars) and him (book, record, tags and notes),
 * assembled into a single prompt, parsed, cached, and served.
 *
 * `current()` never calls the model — it reads the newest stored row and
 * flags it stale past 24h. Only `refresh()` spends a model call, and it
 * spends exactly one for the entire list: ranking is comparison, and a model
 * shown one ticker at a time cannot compare.
 */
@Injectable()
export class WatchlistRankingService {
  private readonly logger = new Logger(WatchlistRankingService.name);

  constructor(
    @InjectRepository(WatchlistRanking)
    private readonly rankings: Repository<WatchlistRanking>,
    @InjectRepository(Instrument)
    private readonly instruments: Repository<Instrument>,
    @InjectRepository(DailyClose)
    private readonly closes: Repository<DailyClose>,
    private readonly watchlist: WatchlistService,
    private readonly marketData: MarketDataService,
    private readonly portfolio: PortfolioService,
    private readonly trades: TradesService,
    private readonly llm: LlmClient,
    private readonly users: UsersService,
  ) {}

  /** The newest stored ranking for the signed-in user. No model call, ever. */
  async current(): Promise<RankingResponse> {
    return this.toResponse(await this.newestRow());
  }

  /**
   * Gathers the three views for every watchlist ticker, makes ONE model call
   * for the whole list, parses the ranked answer, stores it and returns it.
   */
  async refresh(): Promise<RankingResponse> {
    // Short-circuit before any fetching, as TradeIdeaService does: with no
    // key there is no answer to produce, and reaching the provider or the
    // database for one would be wasted work.
    if (!this.llm.isConfigured()) {
      return this.toResponse(await this.newestRow());
    }

    const rows = await this.watchlist.list();

    // Enforced at the write path (WATCHLIST_LIMIT in watchlist.service.ts),
    // so this should be impossible. Refusing loudly here rather than
    // truncating means the two can never silently disagree about what "the
    // whole list" means.
    if (rows.length > WATCHLIST_LIMIT) {
      throw new BadRequestException(
        `Cannot rank ${rows.length} tickers — the watchlist is capped at ${WATCHLIST_LIMIT}. This should never happen, since the cap is enforced when a ticker is added.`,
      );
    }

    // Nothing to compare, so nothing to ask a model about.
    if (rows.length === 0) {
      return this.toResponse(await this.newestRow());
    }

    const symbols = rows.map((r) => r.symbol);

    // The book, the record and the profile are gathered concurrently, the
    // way TradeIdeaService.analyse gathers its four — none needs anything
    // from the others. Checked afterwards in this same order, so a genuine
    // failure (the database is down) is not overtaken by an unrelated one
    // settling first.
    const [instrumentsResult, statsResult, bookResult, profileResult] =
      await Promise.allSettled([
        this.instruments.find({ where: { symbol: In(symbols) } }),
        this.trades.getStats(),
        this.portfolio.getPortfolio(),
        readTraderProfile(),
      ]);

    if (instrumentsResult.status === 'rejected') throw instrumentsResult.reason;
    if (statsResult.status === 'rejected') throw statsResult.reason;
    if (bookResult.status === 'rejected') throw bookResult.reason;
    if (profileResult.status === 'rejected') throw profileResult.reason;

    const instrumentBySymbol = new Map(
      instrumentsResult.value.map((i) => [i.symbol.toUpperCase(), i]),
    );

    // The tape is COMPUTED, not fetched: every watchlisted ticker already has
    // daily_closes rows from the ensurePriced call `WatchlistService.upsert`
    // makes when it is added, so this reads what the app already has rather
    // than spending a live provider round trip per candidate.
    const instrumentIds = instrumentsResult.value.map((i) => i.id);
    const bars = instrumentIds.length
      ? await this.closes.find({
          where: { instrumentId: In(instrumentIds) },
          order: { date: 'ASC' },
        })
      : [];
    const barsByInstrument = new Map<string, DailyClose[]>();
    for (const bar of bars) {
      const list = barsByInstrument.get(bar.instrumentId);
      if (list) list.push(bar);
      else barsByInstrument.set(bar.instrumentId, [bar]);
    }

    // The street, by contrast, IS fetched — and a miss here is a MISSING
    // VIEW for that one ticker, never a failure of the whole request. Kept
    // out of the allSettled block above (and never rethrown) for exactly
    // that reason. Chunked at CONSENSUS_CONCURRENCY rather than fired all at
    // once — see the constant's comment.
    const consensusSettled = await settleInChunks(symbols, CONSENSUS_CONCURRENCY, (s) =>
      this.marketData.getConsensus(s),
    );
    const consensusBySymbol = new Map<string, ConsensusResult>(
      symbols.map((s, i) => {
        const r = consensusSettled[i];
        return [
          s.toUpperCase(),
          r.status === 'fulfilled' ? r.value : { status: 'unavailable' },
        ] as const;
      }),
    );

    // `no-coverage` is a resolved, ordinary fact about a ticker (ETFs, thin
    // names) and not worth a line in the log. `unavailable` means the
    // provider call itself failed — a blanket Yahoo outage shows up here as
    // most or all of the list coming back unavailable at once, which used to
    // be indistinguishable from fifty ordinary no-coverage tickers.
    const unavailableCount = [...consensusBySymbol.values()].filter(
      (v) => v.status === 'unavailable',
    ).length;
    if (unavailableCount > 0) {
      this.logger.warn(
        `Watchlist ranking: consensus fetch failed (not lack of coverage) for ${unavailableCount}/${symbols.length} tickers`,
      );
    }

    // Cheap: `WatchlistService.list()` (inside `this.watchlist.list()` above)
    // just called `getQuotes` for these same symbols, so this is a cache hit
    // within its 60s TTL, not a second round trip. Needed for P/E, which
    // lives on the quote/fundamentals, not on `IndicatorSet`.
    const quotes = await this.marketData.getQuotes(symbols);

    const candidates: RankingCandidate[] = rows.map((row) => {
      const instrument = instrumentBySymbol.get(row.symbol.toUpperCase());
      const rawBars: RawBar[] = (
        instrument ? barsByInstrument.get(instrument.id) : undefined
      )?.map((b) => ({
        date: b.date,
        close: b.close,
        adjClose: b.adjClose,
        open: b.open,
        high: b.high,
        low: b.low,
        volume: b.volume,
      })) ?? [];

      return {
        symbol: row.symbol,
        name: row.name,
        price: row.price,
        indicators:
          row.price === null
            ? emptyIndicators(rawBars.length)
            : computeIndicators(rawBars, row.price),
        peRatio: quotes.get(row.symbol.toUpperCase())?.peRatio ?? null,
        consensus: consensusBySymbol.get(row.symbol.toUpperCase()) ?? {
          status: 'unavailable',
        },
        targetPrice: row.targetPrice,
        distanceToTarget: row.distanceToTarget,
        tags: row.tags.map((t) => t.label),
        note: row.note,
        trades: statsResult.value.trades,
      };
    });

    const bookSection = buildBookSection(bookResult.value, NO_SINGLE_TICKER);
    const recordSection = buildRecordSection(statsResult.value, NO_SINGLE_TICKER);
    const profile = profileResult.value ?? '(no trading profile on file)';

    const system = RANKING_SYSTEM_PROMPT;
    const userPrompt = buildRankingUserPrompt(candidates, bookSection, recordSection, profile);

    let raw: string;
    try {
      raw = await this.llm.complete({
        system,
        user: userPrompt,
        grounded: false,
        model: RANKING_MODEL,
        // gemini-2.5-flash-lite rejects thinkingConfig outright — confirmed
        // against the real API, not assumed — so this must override even a
        // process-wide LLM_THINKING_LEVEL, not merely omit its own opinion.
        thinkingLevel: 'NONE',
      });
    } catch (err) {
      const kind: LlmFailureKind = err instanceof LlmFailure ? err.kind : 'unknown';
      this.logger.warn(`Watchlist ranking call failed (${kind}): ${(err as Error).message}`);
      // Deliberately a hard failure, not a soft degrade — the opposite of
      // TradeIdeaService, which returns a 200 carrying `error`/`errorKind`
      // because there the model's answer IS the response: a hard failure
      // there would leave the screen with nothing. Here `refresh()` is an
      // action on top of a cache. The row this call would have replaced is
      // untouched, so the previously stored ranking is still exactly what
      // `current()` serves — a 503 correctly tells the refresh button "that
      // attempt failed" while the owner keeps the answer he already had,
      // rather than quietly discarding it under a 200 that looks like
      // success. `kind` is not threaded any further than this log line on
      // purpose: RankingResponse has no error field to carry it (the shape
      // is fixed by the brief, and Task 7 is written against it), and adding
      // one here would be the same widening TradeIdeaResult needed, for a
      // response whose whole point is "nothing changed, try again".
      throw new ServiceUnavailableException(
        'The watchlist ranking could not be computed right now.',
      );
    }

    const parsed = parseRanking(raw, symbols);

    // `parseRanking` never throws — prose that does not fit the `[RANK]`
    // contract degrades to `order: []` with every candidate named in
    // `missing`, documented in watchlist-ranking-parse.ts as "a routine
    // outcome the caller can show as 'no ranking yet'". That is true for a
    // FRESH ranking with nothing stored yet, but `refresh()` is called on
    // top of a cache: saving this would make `current()` (newest row wins)
    // serve an empty order and a `missing` list naming all fifty tickers in
    // place of whatever good ranking was already on file — the exact
    // failure the 503 above exists to prevent, reached through a door that
    // didn't check. Treat an unparseable answer as a failed refresh, same
    // as a thrown model call: log it, leave the previous row exactly as it
    // was, and tell the caller to try again.
    if (parsed.order.length === 0) {
      this.logger.warn(
        `Watchlist ranking unparseable (${raw.length} chars) — previous ranking kept`,
      );
      throw new ServiceUnavailableException(
        'The watchlist ranking could not be computed right now.',
      );
    }

    const owner = await this.users.currentUser();
    const rankedAt = new Date();
    const payload: StoredPayload = {
      order: parsed.order,
      reasoning: parsed.reasoning,
      missing: parsed.missing,
    };
    const saved = await this.rankings.save(
      this.rankings.create({
        userId: owner.id,
        rankedAt,
        model: this.llm.modelName(RANKING_MODEL),
        payload: JSON.stringify(payload),
        // The prompt the model actually read, verbatim — the same reason
        // ai_summaries and trade_ideas keep theirs: an answer whose inputs
        // are gone cannot be audited, and "why did it say that" is a
        // question he will ask.
        factsSnapshot: userPrompt,
      }),
    );

    return this.toResponse(saved);
  }

  private async newestRow(): Promise<WatchlistRanking | null> {
    const user = await this.users.currentUser();
    return this.rankings.findOne({
      where: { userId: user.id },
      order: { rankedAt: 'DESC' },
    });
  }

  private toResponse(row: WatchlistRanking | null): RankingResponse {
    if (!row) {
      return {
        configured: this.llm.isConfigured(),
        rankedAt: null,
        model: null,
        order: [],
        reasoning: null,
        missing: [],
        stale: false,
      };
    }
    const payload = JSON.parse(row.payload) as StoredPayload;
    const stale = Date.now() - row.rankedAt.getTime() > STALE_MS;
    return {
      configured: this.llm.isConfigured(),
      rankedAt: row.rankedAt.toISOString(),
      model: row.model,
      order: payload.order,
      reasoning: payload.reasoning,
      missing: payload.missing,
      stale,
    };
  }
}
