import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { numericTransformer } from '../common/numeric.transformer.js';

/** Which way the price has to move for a target to be "reached". */
export type TargetDirection = 'ABOVE' | 'BELOW';

/**
 * A ticker the owner is watching but does not own.
 *
 * Deliberately NOT a position and deliberately not in the transaction log:
 * nothing here touches the portfolio, so invariant 1 is untouched — a
 * watchlist item is an intention, and intentions are not holdings.
 *
 * One row per symbol per user: watching the same ticker twice is a mistake,
 * not a feature, and the unique constraint says so rather than leaving two
 * rows to drift apart.
 */
@Entity('watchlist_items')
@Unique(['userId', 'instrumentId'])
export class WatchlistItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Index()
  @Column('uuid')
  instrumentId: string;

  /** The level worth being told about. Null when the ticker is just being watched. */
  @Column('numeric', {
    precision: 20,
    scale: 8,
    nullable: true,
    transformer: numericTransformer,
  })
  targetPrice: number | null;

  /**
   * Which way the price must move to reach the target. Decided by the BACKEND
   * from the price at the time the target was set — above it means "tell me
   * when it gets there", below it means "tell me when it comes back down".
   * Storing it removes the ambiguity at read time, when the current price has
   * moved and the original intent is no longer inferable.
   */
  @Column({ type: 'varchar', nullable: true })
  targetDirection: TargetDirection | null;

  /** Why it is on the list. Free text, same as a journal note. */
  @Column({ type: 'text', default: '' })
  note: string;

  /**
   * When the owner last said "yes, I have seen that this hit".
   *
   * The alert is not a push notification — it appears when he opens the page,
   * which is what he asked for. Without this it would appear every time
   * forever once hit, which is how an alert becomes wallpaper. Cleared by the
   * backend whenever the target itself changes, so a new target always
   * announces itself.
   */
  @Column({ type: 'timestamptz', nullable: true })
  acknowledgedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
