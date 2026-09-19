import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type EntryKind = 'TRADE' | 'NOTE' | 'CASH' | 'DIVIDEND' | 'INTEREST';

/**
 * The single timeline. A TRADE entry owns one transaction, a CASH entry owns
 * one cash flow, a DIVIDEND owns one dividend row, a NOTE owns nothing.
 * Transactions are ONLY ever created through an entry, so there is exactly one
 * write path into the portfolio.
 */
@Entity('journal_entries')
export class JournalEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Column({ type: 'varchar' })
  kind: EntryKind;

  @Column({ type: 'text', default: '' })
  body: string;

  @Index()
  @Column({ type: 'timestamptz' })
  occurredAt: Date;

  /**
   * Codes from `reasons.ts` — why the fill was taken. Kept here rather than
   * on the transaction because `update()` recreates that row and would drop
   * them; see the AddEntryReasons migration.
   */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  reasons: string[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
