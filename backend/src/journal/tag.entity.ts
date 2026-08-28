import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

export type TagType = 'SETUP' | 'MISTAKE';

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
