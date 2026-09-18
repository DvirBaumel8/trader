import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type AiOutcomeFeature = 'trade_idea' | 'symbol_pattern' | 'trade_review';

export type AiOutcomeStatus =
  | 'pending'
  | 'target_hit'
  | 'stop_hit'
  | 'repeated'
  | 'improved'
  | 'expired';

/**
 * One AI opinion's ledger row: does what it said turn out to be right.
 * Written automatically the moment a `TradeIdea`, `SymbolPatternRead` or
 * `TradeReview` row is persisted, then updated in place by
 * `AiOutcomeService.resolvePending` once there's something to compare it
 * against — see that service for the grading rules.
 *
 * This is deliberately the one AI table in this app that is NOT
 * create/read/delete only: every other one (`ai_summaries`, `trade_ideas`,
 * `symbol_pattern_reads`, `trade_reviews`) is an immutable record of what
 * the model said, and mutating it would misrepresent history. This table
 * is not a record of what the model said — it's a record of whether the
 * model turned out to be right, which is only knowable after the fact and
 * needs to be written down after the fact.
 */
@Entity('ai_outcomes')
export class AiOutcome {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Column({ type: 'varchar' })
  feature: AiOutcomeFeature;

  /** The `TradeIdea` / `SymbolPatternRead` / `TradeReview` row this grades. */
  @Column('uuid')
  entityId: string;

  @Column({ type: 'varchar', default: 'pending' })
  status: AiOutcomeStatus;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
