import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiOutcome, type AiOutcomeFeature } from './ai-outcome.entity.js';
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
   * Filled in by Task 8.
   */
  async resolvePending(): Promise<void> {
    // Implemented in Task 8.
  }
}
