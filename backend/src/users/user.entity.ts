import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { numericTransformer } from '../common/numeric.transformer.js';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ default: 'me' })
  displayName: string;

  /**
   * All nullable, all deliberately. The original owner row predates accounts
   * and has none of them; he signs in with the shared APP_PASSWORD until he
   * attaches an email. Requiring these would mean inventing credentials for
   * him in a migration, which is how a deploy locks out its only user.
   */
  @Column({ type: 'varchar', nullable: true })
  email: string | null;

  @Column({ type: 'varchar', nullable: true })
  passwordHash: string | null;

  /** Google's stable subject id. Not the email — people change those. */
  @Column({ type: 'varchar', nullable: true })
  googleId: string | null;

  @Column({ type: 'varchar', nullable: true })
  avatarUrl: string | null;

  /** Last successful sign-in, so the app can greet a returning user. */
  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  @Column('numeric', {
    precision: 12,
    scale: 2,
    default: 4,
    transformer: numericTransformer,
  })
  defaultFee: number;

  /**
   * A manually-entered snapshot of the broker's own "month-to-date interest"
   * figure — not a journal entry, since the broker has not posted a dated
   * transaction for it yet, only accrued it daily into the live cash it
   * shows. Display-only: see PortfolioService.getFees.
   */
  @Column('numeric', {
    precision: 12,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  interestAccrualAmount: number | null;

  /** The date the snapshot above was taken, YYYY-MM-DD. */
  @Column({ type: 'date', nullable: true })
  interestAccrualAsOf: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
