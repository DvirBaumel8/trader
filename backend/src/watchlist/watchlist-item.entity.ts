import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * A ticker the owner is watching. Symbols only: the target, note and
 * acknowledgement columns from the old watchlist stay in the table, unmapped
 * and unused (see docs/superpowers/specs/2026-10-28-trader-rebuild-design.md).
 */
@Entity('watchlist_items')
@Unique(['userId', 'instrumentId'])
export class WatchlistItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Index()
  @Column('uuid')
  instrumentId: string;

  @CreateDateColumn()
  createdAt: Date;
}
