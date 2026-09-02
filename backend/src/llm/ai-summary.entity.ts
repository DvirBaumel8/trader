import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One persisted AI portfolio summary. Create, read and delete only — there is
 * no update path anywhere in the app, by the owner's explicit choice: the
 * model's words are an immutable record of what it said at a moment in time,
 * and an editable summary still labelled "AI generated" would misrepresent
 * that history later. See llm.service.ts (the only writer) and
 * ai-summary.service.ts (the only reader/deleter).
 *
 * `factsSnapshot` is not optional: without the facts the model actually read,
 * a summary from weeks ago is unreadable, because the reader won't remember
 * what the book looked like when it was written, and the model's judgement
 * can't be assessed against the numbers it was actually given.
 */
@Entity('ai_summaries')
export class AiSummary {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  /** The model's own words, verbatim. */
  @Column('text')
  summary: string;

  /**
   * The FACTS block (portfolio-context.ts's output) exactly as handed to the
   * model — the "book" this summary is a judgement about. Stored verbatim,
   * not recomputed, since today's positions/prices are not what the model saw.
   */
  @Column('text')
  factsSnapshot: string;

  /** e.g. "gemini-2.5-flash" — which model produced this text. */
  @Column({ type: 'varchar' })
  model: string;

  /** Whether Google Search grounding was attached to this call. */
  @Column({ type: 'boolean', default: false })
  grounded: boolean;

  /** portfolio.pricedAt at generation time — what the facts were current as of. */
  @Column({ type: 'timestamptz' })
  factsAsOf: Date;

  @CreateDateColumn()
  createdAt: Date;
}
