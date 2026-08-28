import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { numericTransformer } from '../common/numeric.transformer.js';

/**
 * Income paid by a holding. Deliberately NOT a cash flow.
 *
 * A deposit is external capital the owner added; a dividend is return the
 * portfolio generated. Storing them together would inflate contributed capital
 * and, in the Phase 3 benchmark, make earned income look like money added —
 * understating performance against the index. Cash goes up either way, but only
 * a deposit counts as a contribution.
 */
@Entity('dividends')
export class Dividend {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Index()
  @Column('uuid')
  entryId: string;

  /** Which holding paid it. */
  @Index()
  @Column('uuid')
  instrumentId: string;

  /** Always positive. Cash received after any withholding. */
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
