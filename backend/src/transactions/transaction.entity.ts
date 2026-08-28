import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { numericTransformer } from '../common/numeric.transformer.js';

export type Side = 'BUY' | 'SELL';

@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Index()
  @Column('uuid')
  entryId: string;

  @Index()
  @Column('uuid')
  instrumentId: string;

  @Column({ type: 'varchar' })
  side: Side;

  /** Always positive. Direction comes from `side`; shorts fall out of derivation. */
  @Column('numeric', {
    precision: 20,
    scale: 8,
    transformer: numericTransformer,
  })
  quantity: number;

  @Column('numeric', {
    precision: 20,
    scale: 8,
    transformer: numericTransformer,
  })
  price: number;

  @Column('numeric', {
    precision: 12,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  fee: number;

  /**
   * The profit target planned at entry. Nullable — optional like the stop.
   * Captured from Phase 2 onward so a planned R:R can be displayed later
   * without a backfill, even though nothing renders it yet.
   */
  @Column('numeric', {
    precision: 20,
    scale: 8,
    nullable: true,
    transformer: numericTransformer,
  })
  plannedTarget: number | null;

  @Index()
  @Column({ type: 'timestamptz' })
  executedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
