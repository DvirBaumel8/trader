import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A persisted AI pattern read: how the owner has actually traded one symbol,
 * compared to his own overall record over the same window. Retrospective
 * only — never a buy/sell opinion, which is `TradeIdea`'s job.
 *
 * Kept one row per generation, like `TradeReview`, rather than one row per
 * (userId, symbol, range): switching ranges should never lose a read he
 * already paid for in another one, and regenerating should never destroy
 * the read that was there before it.
 */
@Entity('symbol_pattern_reads')
export class SymbolPatternRead {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Index()
  @Column({ type: 'varchar' })
  symbol: string;

  @Column({ type: 'varchar' })
  range: string;

  /** A brief one-line takeaway — what must survive collapsing the card. */
  @Column({ type: 'varchar' })
  headline: string;

  /** The markdown body of the pattern read. */
  @Column({ type: 'text' })
  read: string;

  /** JSON-serialized snapshot of the facts the model was given. */
  @Column({ type: 'text' })
  factsSnapshot: string;

  /** Which model generated this read (e.g. gemini-2.5-flash). */
  @Column({ type: 'varchar' })
  model: string;

  @CreateDateColumn()
  createdAt: Date;
}
