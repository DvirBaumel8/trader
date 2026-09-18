import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { LlmClient, LlmFailure, type LlmFailureKind } from './llm.client.js';
import { TradeReview } from './trade-review.entity.js';
import { UsersService } from '../users/users.service.js';
import { ERROR_COPY } from './llm.service.js';
import { TradesService } from '../portfolio/trades.service.js';
import { JournalEntry } from '../journal/journal-entry.entity.js';
import {
  buildTradeReviewFacts,
  type TradeReviewFacts,
} from './trade-review-context.js';
import { buildTradeReviewPrompt } from './trade-review-prompt.js';
import { parseReviewMeta, stripReviewMeta } from './trade-review-parse.js';
import { readTraderProfile } from './trader-profile.js';
import { streamAfterMetaBlock } from './meta-block-stream.js';
import { AiOutcomeService } from './ai-outcome.service.js';

export interface TradeReviewResult {
  id: string | null;
  configured: boolean;
  tradeId: string;
  symbol: string;
  score: string | null;
  verdict: string | null;
  review: string | null;
  facts: TradeReviewFacts | null;
  createdAt: string | null;
  error: string | null;
  errorKind: LlmFailureKind | null;
}

/** The final line of `reviewTradeStream` — everything `TradeReviewResult`
 * carries except `review` itself, which the streamed `{"delta": "..."}`
 * lines (already meta-block-free) already are. */
export type TradeReviewStreamDone = Omit<TradeReviewResult, 'review'> & {
  done: true;
};

@Injectable()
export class TradeReviewService {
  private readonly logger = new Logger(TradeReviewService.name);

  constructor(
    private readonly llm: LlmClient,
    private readonly trades: TradesService,
    private readonly users: UsersService,
    @InjectRepository(TradeReview)
    private readonly reviews: Repository<TradeReview>,
    @InjectRepository(JournalEntry)
    private readonly entries: Repository<JournalEntry>,
    private readonly outcomes: AiOutcomeService,
  ) {}

  async getReview(tradeId: string): Promise<TradeReviewResult | null> {
    const user = await this.users.currentUser();
    const existing = await this.reviews.findOne({
      where: { userId: user.id, tradeId },
      order: { createdAt: 'DESC' },
    });

    if (!existing) {
      return null;
    }

    let facts: TradeReviewFacts | null = null;
    try {
      facts = JSON.parse(existing.factsSnapshot);
    } catch {
      facts = null;
    }

    return {
      id: existing.id,
      configured: this.llm.isConfigured(),
      tradeId: existing.tradeId,
      symbol: existing.symbol,
      score: existing.score,
      verdict: existing.verdict,
      review: existing.review,
      facts,
      createdAt: existing.createdAt.toISOString(),
      error: null,
      errorKind: null,
    };
  }

  /** Everything `reviewTrade` and `reviewTradeStream` share: the facts and
   * the trade/symbol they're for. Neither the model call nor persistence
   * lives here, so both callers stay free to handle those differently. */
  private async buildReviewFacts(tradeId: string) {
    const user = await this.users.currentUser();
    const tradeData = await this.trades.getTrade(tradeId);
    if (!tradeData) {
      throw new NotFoundException(`Trade ${tradeId} not found`);
    }

    const { trade, fills, stopLevels } = tradeData;

    const entryIds = fills
      .map((f) => f.entryId)
      .filter((id): id is string => Boolean(id));

    let journalNotes: string[] = [];
    if (entryIds.length > 0) {
      const journalRows = await this.entries.find({
        where: { id: In(entryIds), userId: user.id },
      });
      journalNotes = journalRows
        .map((r) => r.body.trim())
        .filter((b) => b.length > 0);
    }

    const tagsByEntry = await this.trades.tagsByEntryId();
    const setups = new Set<string>();
    const mistakes = new Set<string>();
    for (const id of entryIds) {
      const found = tagsByEntry.get(id);
      found?.setups.forEach((s) => setups.add(s));
      found?.mistakes.forEach((m) => mistakes.add(m));
    }

    const facts = buildTradeReviewFacts({
      trade,
      fills,
      stopLevels,
      tags: { setups: [...setups], mistakes: [...mistakes] },
      journalNotes,
    });

    return { user, trade, facts };
  }

  async reviewTrade(tradeId: string): Promise<TradeReviewResult> {
    const { user, trade, facts } = await this.buildReviewFacts(tradeId);

    if (!this.llm.isConfigured()) {
      return {
        id: null,
        configured: false,
        tradeId,
        symbol: trade.symbol,
        score: null,
        verdict: null,
        review: null,
        facts,
        createdAt: null,
        error: null,
        errorKind: null,
      };
    }

    const profileText = await readTraderProfile();
    const { system, user: userPrompt } = buildTradeReviewPrompt(
      facts,
      profileText,
    );

    try {
      const rawText = await this.llm.complete({
        system,
        user: userPrompt,
        grounded: false,
      });

      const { score, verdict } = parseReviewMeta(rawText);
      const cleanReview = stripReviewMeta(rawText);

      // Save to database
      const record = this.reviews.create({
        userId: user.id,
        tradeId,
        symbol: trade.symbol,
        score,
        verdict,
        review: cleanReview,
        factsSnapshot: JSON.stringify(facts),
        model: this.llm.modelName(),
      });
      await this.reviews.save(record);

      // Only worth grading if the review actually named a mistake — see the
      // identical reasoning in SymbolPatternService.generate.
      if (facts.mistakes.length > 0) {
        await this.outcomes.recordPending('trade_review', record.id);
      }

      return {
        id: record.id,
        configured: true,
        tradeId,
        symbol: trade.symbol,
        score,
        verdict,
        review: cleanReview,
        facts,
        createdAt: record.createdAt?.toISOString() ?? new Date().toISOString(),
        error: null,
        errorKind: null,
      };
    } catch (err) {
      const kind: LlmFailureKind =
        err instanceof LlmFailure ? err.kind : 'unknown';
      this.logger.warn(
        `AI Trade Review call failed (${kind}): ${(err as Error).message}`,
      );
      return {
        id: null,
        configured: true,
        tradeId,
        symbol: trade.symbol,
        score: null,
        verdict: null,
        review: null,
        facts,
        createdAt: null,
        error: ERROR_COPY[kind],
        errorKind: kind,
      };
    }
  }

  /**
   * Same call as `reviewTrade`, streamed. Yields newline-delimited JSON —
   * see `LlmService.portfolioSummaryStream`'s doc comment for the general
   * shape. The one addition here: `[REVIEW_META]...[/REVIEW_META]` sits at
   * the START of the raw model text and must never reach the screen, so
   * `streamAfterMetaBlock` buffers it before any `{"delta": ...}` line is
   * yielded — everything after is the review body, streamed untouched.
   */
  async *reviewTradeStream(tradeId: string): AsyncGenerator<string> {
    const emit = (data: TradeReviewStreamDone) => `${JSON.stringify(data)}\n`;
    const { user, trade, facts } = await this.buildReviewFacts(tradeId);

    if (!this.llm.isConfigured()) {
      yield emit({
        id: null,
        done: true,
        configured: false,
        tradeId,
        symbol: trade.symbol,
        score: null,
        verdict: null,
        facts,
        createdAt: null,
        error: null,
        errorKind: null,
      });
      return;
    }

    const profileText = await readTraderProfile();
    const { system, user: userPrompt } = buildTradeReviewPrompt(facts, profileText);

    try {
      const raw = this.llm.completeStream({ system, user: userPrompt, grounded: false });
      const body = streamAfterMetaBlock(raw);
      // Manually driven, not `for await...of`: the meta-stripped body needs
      // relaying chunk by chunk AS it arrives (a plain loop's `yield` stays
      // in this generator's own body, unlike a callback's would), and the
      // full raw text — `body`'s own return value — is still needed once
      // draining finishes, to parse score/verdict from it.
      let next = await body.next();
      while (!next.done) {
        yield `${JSON.stringify({ delta: next.value })}\n`;
        next = await body.next();
      }
      const rawText = next.value;
      const { score, verdict } = parseReviewMeta(rawText);
      const cleanReview = stripReviewMeta(rawText);

      const record = this.reviews.create({
        userId: user.id,
        tradeId,
        symbol: trade.symbol,
        score,
        verdict,
        review: cleanReview,
        factsSnapshot: JSON.stringify(facts),
        model: this.llm.modelName(),
      });
      await this.reviews.save(record);

      // Only worth grading if the review actually named a mistake — see the
      // identical reasoning in SymbolPatternService.generate.
      if (facts.mistakes.length > 0) {
        await this.outcomes.recordPending('trade_review', record.id);
      }

      yield emit({
        id: record.id,
        done: true,
        configured: true,
        tradeId,
        symbol: trade.symbol,
        score,
        verdict,
        facts,
        createdAt: record.createdAt?.toISOString() ?? new Date().toISOString(),
        error: null,
        errorKind: null,
      });
    } catch (err) {
      const kind: LlmFailureKind = err instanceof LlmFailure ? err.kind : 'unknown';
      this.logger.warn(
        `AI Trade Review stream failed for ${tradeId} (${kind}): ${(err as Error).message}`,
      );
      yield emit({
        id: null,
        done: true,
        configured: true,
        tradeId,
        symbol: trade.symbol,
        score: null,
        verdict: null,
        facts,
        createdAt: null,
        error: ERROR_COPY[kind],
        errorKind: kind,
      });
    }
  }
}
