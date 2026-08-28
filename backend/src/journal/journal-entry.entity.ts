import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type EntryKind = 'TRADE' | 'NOTE' | 'CASH';

/**
 * The single timeline. A TRADE entry owns one transaction, a CASH entry owns
 * one cash flow, a NOTE owns neither. Transactions are ONLY ever created
 * through an entry, so there is exactly one write path into the portfolio.
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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
