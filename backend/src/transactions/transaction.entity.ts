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

  /**
   * How this exit came about, on a reducing fill only. NULL means it has not
   * been classified yet — which the exit statistics report rather than
   * quietly treating as discretionary. Opening fills are always NULL.
   */
  @Column({ type: 'varchar', nullable: true })
  exitKind: 'STOP' | 'DISCRETIONARY' | null;

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

  /**
   * The broker's net amount for this fill, as it reports it: signed
   * quantity x price (negative on a buy), with the fee NOT included — the fee
   * is charged to cash separately, so the fill's cash impact is this figure
   * minus the fee. Entered by hand from the broker's confirmation; it sets the
   * stored price (price = |reportedNetCash| / quantity) and catches drift
   * between what we derive and what really happened. Never read back into
   * `deriveCash`, which works from price, quantity and fee.
   */
  @Column('numeric', {
    precision: 20,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  reportedNetCash: number | null;

  /** The platform's cash balance immediately after this fill. Diagnostic only, see `reportedNetCash`. */
  @Column('numeric', {
    precision: 20,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  reportedBalance: number | null;

  @CreateDateColumn()
  createdAt: Date;
}
