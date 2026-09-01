import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { numericTransformer } from '../common/numeric.transformer.js';

/**
 * One bar per instrument per trading day.
 *
 * Five prices are stored because they answer different questions. `close` is
 * what the position was actually worth that day. `adjClose` is retroactively
 * restated for dividends and splits, which is what a fair benchmark return
 * needs — an index compared on price alone loses its dividend yield and
 * flatters whoever it is measured against. `open`, `high` and `low` capture
 * the intraday range for candle charts and are nullable, since rows written
 * before Phase 4 have none until the backfill re-runs.
 */
@Entity('daily_closes')
@Unique(['instrumentId', 'date'])
export class DailyClose {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  instrumentId: string;

  /** Trading day as YYYY-MM-DD. A date, not a timestamp: bars are daily. */
  @Index()
  @Column({ type: 'date' })
  date: string;

  @Column('numeric', {
    precision: 20,
    scale: 8,
    transformer: numericTransformer,
  })
  close: number;

  @Column('numeric', {
    precision: 20,
    scale: 8,
    transformer: numericTransformer,
  })
  adjClose: number;

  /**
   * Intraday range, for candle charts. Nullable: rows backfilled before
   * Phase 4 have no values until the backfill is re-run, and a bar Yahoo
   * returns without them is still worth storing for its close.
   */
  @Column('numeric', {
    precision: 20,
    scale: 8,
    nullable: true,
    transformer: numericTransformer,
  })
  open: number | null;

  @Column('numeric', {
    precision: 20,
    scale: 8,
    nullable: true,
    transformer: numericTransformer,
  })
  high: number | null;

  @Column('numeric', {
    precision: 20,
    scale: 8,
    nullable: true,
    transformer: numericTransformer,
  })
  low: number | null;
}
