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
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROFILE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../docs/trader-profile.md',
);

export interface TradeReviewResult {
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
  ) {}

  async getReview(tradeId: string): Promise<TradeReviewResult | null> {
    const user = await this.users.ensureDefaultUser();
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

  async reviewTrade(tradeId: string): Promise<TradeReviewResult> {
    const user = await this.users.ensureDefaultUser();
    const tradeData = await this.trades.getTrade(tradeId);
    if (!tradeData) {
      throw new NotFoundException(`Trade ${tradeId} not found`);
    }

    const { trade, fills, stopLevels } = tradeData;

    // Extract journal entries and tags
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

    if (!this.llm.isConfigured()) {
      return {
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

    const profileText = await this.readProfile();
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

      return {
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

  private async readProfile(): Promise<string | null> {
    try {
      return await readFile(PROFILE_PATH, 'utf-8');
    } catch {
      return null;
    }
  }
}
