import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { numericTransformer } from '../common/numeric.transformer.js';

/**
 * A broker-charged cost outside any trade — margin interest, to start.
 * Deliberately NOT a cash flow, the mirror image of dividend.entity.ts.
 *
 * A withdrawal is capital the owner took out; an interest charge is a cost
 * the account incurred. Storing it as a withdrawal would deflate contributed
 * capital and, in the benchmark comparison, make a real expense look like
 * money removed — overstating performance against the index. Cash goes down
 * either way, but only a withdrawal is a capital movement.
 */
@Entity('interest_charges')
export class InterestCharge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Index()
  @Column('uuid')
  entryId: string;

  /** Always positive. Direction is implicit: an interest charge only ever reduces cash. */
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
