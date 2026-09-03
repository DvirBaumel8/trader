import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from '../common/numeric.transformer.js';

/**
 * A confirmed link between a reducing fill and the stop tier it executed.
 * Always the owner's own decision — the price matcher only ever supplies the
 * default the entry sheet offers, never the stored record.
 *
 * One row per (fill, tier) pair: a fill that spans two tiers writes two
 * rows, and a partially executed tier writes a row whose `quantity` is less
 * than the tier's own. This is why the link is a table.
 */
@Entity('stop_executions')
export class StopExecution {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  stopLevelId: string;

  @Index()
  @Column('uuid')
  transactionId: string;

  /** Shares of this tier that this fill executed. Always positive. */
  @Column('numeric', { precision: 20, scale: 8, transformer: numericTransformer })
  quantity: number;

  @Column('timestamp', { default: () => 'now()' })
  confirmedAt: Date;
}
