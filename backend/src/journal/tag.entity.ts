import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/**
 * 'WATCH' tags belong to watchlist items rather than journal entries — one
 * vocabulary store, joined from two places, rather than a second tags table.
 */
export type TagType = 'SETUP' | 'MISTAKE' | 'WATCH';

/** Reusable across entries, created on the fly from the composer. */
@Entity('tags')
@Unique(['userId', 'type', 'label'])
export class Tag {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Column({ type: 'varchar' })
  type: TagType;

  @Column()
  label: string;

  @CreateDateColumn()
  createdAt: Date;
}
