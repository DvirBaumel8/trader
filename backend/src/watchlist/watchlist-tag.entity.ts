import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * Joins a watchlist item to a row in `tags`.
 *
 * Reuses the existing tag table (with type 'WATCH') rather than inventing a
 * second vocabulary store — the reuse-before-invention rule in CLAUDE.md,
 * applied to data as well as UI. Tag labels are the owner's to choose:
 * sector, trading style, conviction, whatever he finds useful.
 */
@Entity('watchlist_item_tags')
@Unique(['itemId', 'tagId'])
export class WatchlistItemTag {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  itemId: string;

  @Index()
  @Column('uuid')
  tagId: string;
}
