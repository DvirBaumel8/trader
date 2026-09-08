import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A persisted AI post-mortem and discipline review for a trade.
 *
 * Evaluates trade execution against the owner's trading rules and plan:
 * - Was an initial stop placed immediately upon entry?
 * - Were stops respected or widened/loosened?
 * - Did execution suffer from slippage or hesitation?
 * - Was the trade sized appropriately?
 * - Did the trader follow good process regardless of whether P&L was positive or negative?
 */
@Entity('trade_reviews')
export class TradeReview {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Index()
  @Column({ type: 'varchar' })
  tradeId: string;

  @Column({ type: 'varchar' })
  symbol: string;

  /** Grade score: 'A', 'B', 'C', 'D', or 'F'. */
  @Column({ type: 'varchar' })
  score: string;

  /** A brief punchy verdict headline, e.g. "Disciplined Cut at Initial Stop" */
  @Column({ type: 'varchar' })
  verdict: string;

  /** The markdown body of the post-mortem discipline review. */
  @Column({ type: 'text' })
  review: string;

  /** JSON-serialized snapshot of facts evaluated by the app. */
  @Column({ type: 'text' })
  factsSnapshot: string;

  /** Which model generated this review (e.g. gemini-3.8-flash). */
  @Column({ type: 'varchar' })
  model: string;

  @CreateDateColumn()
  createdAt: Date;
}
