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

    for (const row of pending) {
      const status =
        row.feature === 'trade_idea'
          ? await this.resolveTradeIdea(row)
          : await this.resolveBehavioral(row);
      if (status) {
        row.status = status;
        row.resolvedAt = new Date();
        await this.outcomes.save(row);
      }
    }
  }

  /** 30 days: matches the swing-trade holding period already implied
   * elsewhere in the app (see the spec doc). */
  private static readonly TRADE_IDEA_EXPIRY_DAYS = 30;

  private async resolveTradeIdea(row: AiOutcome): Promise<AiOutcomeStatus | null> {
    const idea = await this.ideas.findOne({ where: { id: row.entityId } });
    if (!idea || idea.stop === null || idea.target === null) return 'expired';

    // Direction isn't stored on TradeIdea — re-derived the same way
    // `computeTradeRisk` does at generation time, rather than storing it
    // twice.
    const isLong = idea.stop < idea.entryPrice && idea.target > idea.entryPrice;

    const bars = await this.history.liveDailyBars(idea.symbol, idea.createdAt);
    for (const bar of bars) {
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

  private async resolveBehavioral(row: AiOutcome): Promise<AiOutcomeStatus | null> {
    const opinion =
      row.feature === 'symbol_pattern'
        ? await this.reads.findOne({ where: { id: row.entityId } })
        : await this.reviews.findOne({ where: { id: row.entityId } });
    if (!opinion) return 'expired';

    const namedMistakes =
      row.feature === 'symbol_pattern'
        ? new Set(
            (JSON.parse(opinion.factsSnapshot) as { trades: { mistakes?: string[] }[] }).trades
              .flatMap((t) => t.mistakes ?? []),
          )
        : new Set((JSON.parse(opinion.factsSnapshot) as { mistakes: string[] }).mistakes);

    const allTrades = await this.trades.deriveAllTrades();
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

    const tagsByEntryId = await this.trades.tagsByEntryId();
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
