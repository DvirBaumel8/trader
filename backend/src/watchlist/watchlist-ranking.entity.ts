import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * One computed ranking of the whole watchlist, kept so the Watch tab opens
 * instantly and a model call happens once a day rather than once a visit.
 *
 * `factsSnapshot` is not optional, for the same reason `ai_summaries` keeps
 * one: an answer whose inputs are gone cannot be audited, and "why did it say
 * that" is a question he will ask. The facts are what the model actually read.
 */
@Entity('watchlist_rankings')
export class WatchlistRanking {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  /** When the ranking was computed — shown in the UI, never hidden. */
  @Index()
  @Column({ type: 'timestamptz' })
  rankedAt: Date;

  /** Which model produced it, recorded alongside the answer. */
  @Column()
  model: string;

  /** The ranked rows, as JSON. See RankedTicker in llm/watchlist-ranking-parse.ts. */
  @Column('text')
  payload: string;

  /** The three views the model was given, as the rendered prompt text — the same thing the model actually read, verbatim, not a JSON re-encoding of it. */
  @Column('text')
  factsSnapshot: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
