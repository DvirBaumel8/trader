import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiOutcome, type AiOutcomeFeature, type AiOutcomeStatus } from './ai-outcome.entity.js';
import { TradeIdea } from './trade-idea.entity.js';
import { SymbolPatternRead } from './symbol-pattern.entity.js';
import { TradeReview } from './trade-review.entity.js';
import { UsersService } from '../users/users.service.js';
import { TradesService } from '../portfolio/trades.service.js';
import { HistoryService } from '../market-data/history.service.js';
import { computeTradeRisk } from '../portfolio/trade-risk.js';
import type { DerivedTrade } from '../portfolio/derive-trades.js';

/**
 * The automated feedback loop: grades each AI opinion against what actually
 * happened, with no human rating involved. See
 * docs/superpowers/specs/2026-09-18-ai-outcome-tracking-design.md for why.
 */
@Injectable()
export class AiOutcomeService {
  private readonly logger = new Logger(AiOutcomeService.name);

  constructor(
    @InjectRepository(AiOutcome)
    private readonly outcomes: Repository<AiOutcome>,
    @InjectRepository(TradeIdea)
    private readonly ideas: Repository<TradeIdea>,
    @InjectRepository(SymbolPatternRead)
    private readonly reads: Repository<SymbolPatternRead>,
    @InjectRepository(TradeReview)
    private readonly reviews: Repository<TradeReview>,
    private readonly users: UsersService,
    private readonly trades: TradesService,
    private readonly history: HistoryService,
  ) {}

  /** Called by each opinion service right after it persists its own row. */
  async recordPending(feature: AiOutcomeFeature, entityId: string): Promise<void> {
    const user = await this.users.currentUser();
    await this.outcomes.save(
      this.outcomes.create({
        userId: user.id,
        feature,
        entityId,
        status: 'pending',
      }),
    );
  }

  /**
   * Safe wrapper around `recordPending` for the six generation call sites
   * (trade-idea/symbol-pattern/trade-review, both the plain and streamed
   * variant of each). By the time this runs the opinion itself is already
   * saved, so a bookkeeping failure here must never fail the whole request
   * — or, on a streamed call, truncate a response whose deltas have already
   * been yielded. Same catch-and-log-and-continue shape as
   * `HistoryService.liveDailyBars`/`ensureFresh` for the same reason: this
   * is a best-effort secondary write, not the thing the caller asked for.
   */
  async recordOutcome(feature: AiOutcomeFeature, entityId: string): Promise<void> {
    try {
      await this.recordPending(feature, entityId);
    } catch (err) {
      this.logger.warn(
        `Failed to record pending ai_outcomes row for ${feature} ${entityId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Deletes this feature/entity's outcome row(s). Called when the opinion
   * itself is deleted (currently just trade ideas) so a later
   * `resolvePending` pass never finds an orphaned row and grades it
   * `'expired'` — conflating "the user deleted this" with "genuinely
   * expired", which is what `'expired'` means everywhere else.
   */
  async deleteFor(feature: AiOutcomeFeature, entityId: string): Promise<void> {
    await this.outcomes.delete({ feature, entityId });
  }

  /** Resolves what can be resolved, then returns every outcome row. */
  async list(): Promise<AiOutcome[]> {
    await this.resolvePending();
    const user = await this.users.currentUser();
    return this.outcomes.find({
      where: { userId: user.id },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Read-triggered rather than scheduled, same reasoning as
   * `HistoryService.ensureFresh`: no scheduler exists in this app, so
   * freshness is a property of asking, not of a background job having run.
   */
  async resolvePending(): Promise<void> {
    const user = await this.users.currentUser();
    const pending = await this.outcomes.find({
      where: { userId: user.id, status: 'pending' },
    });

    // Fetched once for the whole pass rather than once per row — both are
    // full-table reads plus derivation, and only symbol_pattern/trade_review
    // rows need them at all, so skip the cost entirely when there are none.
    const needsBehavioral = pending.some(
      (row) => row.feature === 'symbol_pattern' || row.feature === 'trade_review',
    );
    const allTrades = needsBehavioral ? await this.trades.deriveAllTrades() : [];
    const tagsByEntryId = needsBehavioral
      ? await this.trades.tagsByEntryId()
      : new Map<string, { setups: string[]; mistakes: string[] }>();

    for (const row of pending) {
      try {
        let status: AiOutcomeStatus | null;
        switch (row.feature) {
          case 'trade_idea':
            status = await this.resolveTradeIdea(row);
            break;
          case 'symbol_pattern':
          case 'trade_review':
            status = await this.resolveBehavioral(row, allTrades, tagsByEntryId);
            break;
          default:
            // A future fourth feature value must not silently fall into
            // behavioral grading — it has no rule yet, so it stays pending.
            this.logger.warn(
              `Unexpected ai_outcomes feature "${row.feature}" on row ${row.id}; leaving unresolved`,
            );
            status = null;
            break;
        }
        if (status) {
          row.status = status;
          row.resolvedAt = new Date();
          await this.outcomes.save(row);
        }
      } catch (err) {
        // One row's failure — a missing related row, a malformed
        // factsSnapshot, anything else — must never take down the rest of
        // the pass, and must never make every other already-resolved row
        // in it invisible to the caller. See the finding this guards.
        this.logger.warn(
          `Failed to resolve ai_outcomes row ${row.id} (${row.feature}): ${(err as Error).message}`,
        );
      }
    }
  }

  /** 30 days: matches the swing-trade holding period already implied
   * elsewhere in the app (see the spec doc). */
  private static readonly TRADE_IDEA_EXPIRY_DAYS = 30;

  private async resolveTradeIdea(row: AiOutcome): Promise<AiOutcomeStatus | null> {
    const idea = await this.ideas.findOne({ where: { id: row.entityId } });
    if (!idea || idea.stop === null || idea.target === null) return 'expired';

    // Direction isn't stored on TradeIdea — re-derived through the same
    // three-way check `computeTradeRisk` uses at generation time, not a
    // simpler two-way inference. A malformed idea whose stop and target sit
    // on the SAME side of entry is neither a valid long nor a valid short;
    // computeTradeRisk returns null for exactly that case, and there is
    // nothing sane to grade — that's resolved as 'expired' below rather
    // than silently coerced into one direction and graded anyway.
    const risk = computeTradeRisk({
      entryPrice: idea.entryPrice,
      stop: idea.stop,
      target: idea.target,
      usualRisk: null,
    });
    if (!risk) return 'expired';
    const isLong = risk.direction === 'LONG';

    const bars = await this.history.liveDailyBars(idea.symbol, idea.createdAt);
    // Daily bars carry no intraday timestamps, so the idea's own creation-day
    // bar spans the WHOLE session — including hours before the idea was
    // generated. Grading starts from the next trading day onward; the day-0
    // bar is skipped rather than walked.
    const createdDateStr = idea.createdAt.toISOString().slice(0, 10);
    for (const bar of bars) {
      if (bar.date === createdDateStr) continue;
      if (bar.low === null || bar.high === null) continue;
      const stopCrossed = isLong ? bar.low <= idea.stop : bar.high >= idea.stop;
      const targetCrossed = isLong ? bar.high >= idea.target : bar.low <= idea.target;
      // Both crossed the same bar: read it as the stop filling first — the
      // conservative assumption, matching how a real stop order behaves
      // when price gaps through both levels.
      if (stopCrossed) return 'stop_hit';
      if (targetCrossed) return 'target_hit';
    }

    const ageDays = (Date.now() - idea.createdAt.getTime()) / 86_400_000;
    return ageDays > AiOutcomeService.TRADE_IDEA_EXPIRY_DAYS ? 'expired' : null;
  }

  /** Longer than trade-idea's 30 days: a behavior change is slower to
   * observe than a price move — the trader has to make and close another
   * trade in the name, not just wait for a quote to move. */
  private static readonly BEHAVIORAL_EXPIRY_DAYS = 90;

  private async resolveBehavioral(
    row: AiOutcome,
    allTrades: DerivedTrade[],
    tagsByEntryId: Map<string, { setups: string[]; mistakes: string[] }>,
  ): Promise<AiOutcomeStatus | null> {
    const opinion =
      row.feature === 'symbol_pattern'
        ? await this.reads.findOne({ where: { id: row.entityId } })
        : await this.reviews.findOne({ where: { id: row.entityId } });
    if (!opinion) return 'expired';

    // A malformed factsSnapshot's JSON.parse throwing is caught by
    // resolvePending's per-row try/catch, same as any other per-row
    // failure — no separate guard needed here.
    const namedMistakes =
      row.feature === 'symbol_pattern'
        ? new Set(
            (JSON.parse(opinion.factsSnapshot) as { trades: { mistakes?: string[] }[] }).trades
              .flatMap((t) => t.mistakes ?? []),
          )
        : new Set((JSON.parse(opinion.factsSnapshot) as { mistakes: string[] }).mistakes);

    const nextTrade = allTrades
      .filter(
        (t) =>
          t.symbol.toUpperCase() === opinion.symbol.toUpperCase() &&
          !t.isOpen &&
          t.enteredAt > opinion.createdAt,
      )
      .sort((a, b) => a.enteredAt.getTime() - b.enteredAt.getTime())[0];

    if (!nextTrade) {
      const ageDays = (Date.now() - opinion.createdAt.getTime()) / 86_400_000;
      return ageDays > AiOutcomeService.BEHAVIORAL_EXPIRY_DAYS ? 'expired' : null;
    }

    const tradeMistakes = new Set(
      nextTrade.fills
        .map((f) => f.entryId)
        .filter((id): id is string => Boolean(id))
        .flatMap((id) => tagsByEntryId.get(id)?.mistakes ?? []),
    );

    const repeated = [...namedMistakes].some((m) => tradeMistakes.has(m));
    return repeated ? 'repeated' : 'improved';
  }
}
