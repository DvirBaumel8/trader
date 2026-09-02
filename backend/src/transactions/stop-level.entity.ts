import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from '../common/numeric.transformer.js';

export type StopKind = 'FIXED' | 'TRAILING';

/**
 * One tier of a stop plan, attached to the opening fill. The owner scales out:
 * part of the position exits at one level, the rest lower. A single stop is
 * simply the one-row case.
 *
 * Rows are IMMUTABLE once written — trailing a stop never edits or deletes a
 * row, it appends a new revision (see `revisionSeq`). That is what keeps the
 * stop set at entry recoverable even after the owner has trailed it many
 * times: overwriting in place, which is what this table used to do, is
 * exactly what destroyed every original stop in the real data and left every
 * closed trade with a null R-multiple. A percentage TRAILING level's rule is
 * fixed at entry, so only the level's implied price moves with the market —
 * that alone never needed a new revision, only a FIXED level being replaced
 * by the owner's own hand does.
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

  /**
   * Groups the tiers written together into one revision, and orders
   * revisions for a transaction: 0 is the first ever recorded, increasing
   * from there. The *entry* stop that defines risk and R is the rows with
   * the lowest `revisionSeq`; the *current* stop the dashboard and chart
   * draw is the rows with the highest. Only `derive-trades.ts`
   * (`selectEntryStops`/`selectCurrentStops`) should make that distinction —
   * everywhere else should already be reading one or the other by name.
   */
  @Index()
  @Column('int', { default: 0 })
  revisionSeq: number;

  /**
   * When this revision was recorded. NULL on every row written before this
   * column existed — those rows are still correctly the *current* stop, but
   * their true set-time is gone (overwritten by the old delete-and-rewrite
   * behaviour before anyone could record it), so they must never be read as
   * "the stop set at entry". A NULL `createdAt` on revision 0 is exactly how
   * `selectEntryStops` recognises an unknown-vintage stop and reports risk
   * as null instead of computing an R from a stop that was actually already
   * trailed.
   */
  @Column('timestamp', { nullable: true })
  createdAt: Date | null;
}
