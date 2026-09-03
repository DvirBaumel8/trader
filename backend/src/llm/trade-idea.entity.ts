import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from '../common/numeric.transformer.js';

/**
 * One persisted pre-trade opinion. Create, read and delete only, for the same
 * reason as `ai_summaries`: the model's words are a record of what it said
 * before a trade was taken, and an editable one would misrepresent that later.
 *
 * The value of this table is retrospective. "What did the app say before I
 * bought LMND, and was it right?" is a question that only gets more useful
 * with time — which is why the opinion is kept even though nothing about the
 * researched ticker is written to `instruments` or `daily_closes`.
 *
 * `stop`, `target` and `riskReward` are nullable because an answer whose
 * levels could not be read is still worth keeping: it is a record of what was
 * said, minus the numbers the app refused to derive from it. A row with a
 * `stop` and no `riskReward` is not a thing that can exist — the three are
 * written together or not at all.
 */
@Entity('trade_ideas')
export class TradeIdea {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Column({ type: 'varchar' })
  symbol: string;

  /**
   * The live quote at the moment the opinion was asked for — the entry every
   * derived figure was computed from. Stored rather than recomputed: today's
   * price is not the price the risk/reward was based on.
   */
  @Column({ type: 'numeric', precision: 20, scale: 8, transformer: numericTransformer })
  entryPrice: number;

  /** Whether that quote was stale — an opinion is only as good as its price. */
  @Column({ type: 'boolean', default: false })
  priceStale: boolean;

  /** The model's proposed stop, or null when its levels could not be read. */
  @Column({
    type: 'numeric',
    precision: 20,
    scale: 8,
    nullable: true,
    transformer: numericTransformer,
  })
  stop: number | null;

  /** The model's proposed target, or null when its levels could not be read. */
  @Column({
    type: 'numeric',
    precision: 20,
    scale: 8,
    nullable: true,
    transformer: numericTransformer,
  })
  target: number | null;

  /** Computed by the app from the two levels above — never by the model. */
  @Column({
    type: 'numeric',
    precision: 20,
    scale: 8,
    nullable: true,
    transformer: numericTransformer,
  })
  riskReward: number | null;

  /** The model's prose, with the machine-readable LEVELS block already stripped. */
  @Column('text')
  opinion: string;

  /**
   * The facts block exactly as handed to the model, stored verbatim. Without
   * it an opinion from weeks ago cannot be judged: the reader will not
   * remember what the chart looked like, and the model's call cannot be
   * assessed against numbers it was never given.
   */
  @Column('text')
  factsSnapshot: string;

  /** e.g. "gemini-2.5-flash" — which model produced this text. */
  @Column({ type: 'varchar' })
  model: string;

  @CreateDateColumn()
  createdAt: Date;
}
