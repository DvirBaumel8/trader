import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from '../common/numeric.transformer.js';

export type StopKind = 'FIXED' | 'TRAILING';

/**
 * One tier of a stop plan, attached to the opening fill. The owner scales out:
 * part of the position exits at one level, the rest lower. A single stop is
 * simply the one-row case.
 *
 * These are IMMUTABLE in normal use — there is no trailing-stop control in the
 * UI, because a discretionary trail rewrites risk retroactively and inflates
 * expectancy. A percentage TRAILING level is different: the rule is fixed at
 * entry, so only the level moves, and risk at entry stays knowable.
 */
@Entity('stop_levels')
export class StopLevel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  transactionId: string;

  @Column({ type: 'varchar' })
  kind: StopKind;

  /** FIXED only: the price. Null for a trailing level. */
  @Column('numeric', {
    precision: 20,
    scale: 8,
    nullable: true,
    transformer: numericTransformer,
  })
  price: number | null;

  /** TRAILING only: percent below the high, e.g. 8 means 8%. */
  @Column('numeric', {
    precision: 8,
    scale: 4,
    nullable: true,
    transformer: numericTransformer,
  })
  trailPercent: number | null;

  /** Shares exiting at this level. May total less than the position. */
  @Column('numeric', {
    precision: 20,
    scale: 8,
    transformer: numericTransformer,
  })
  quantity: number;

  @Column('int', { default: 0 })
  ordinal: number;
}
