import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { numericTransformer } from '../common/numeric.transformer.js';

export type CashDirection = 'DEPOSIT' | 'WITHDRAW';

/**
 * External money movement ONLY. Buys and sells move money between cash and
 * positions internally and are deliberately not cash flows — that distinction
 * is what makes the Phase 3 benchmark comparison honest.
 */
@Entity('cash_flows')
export class CashFlow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Index()
  @Column('uuid')
  entryId: string;

  @Column({ type: 'varchar' })
  direction: CashDirection;

  /** Always positive. Direction comes from `direction`. */
  @Column('numeric', {
    precision: 20,
    scale: 2,
    transformer: numericTransformer,
  })
  amount: number;

  @Index()
  @Column({ type: 'timestamptz' })
  occurredAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
