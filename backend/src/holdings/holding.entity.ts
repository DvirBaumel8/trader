import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

export type Direction = 'LONG' | 'SHORT';

/**
 * A symbol the owner holds. Deliberately no quantity or price. The owner only
 * goes long, so `direction` is always written as 'LONG'; the column stays
 * (NOT NULL, CHECK) so no migration is needed.
 */
@Entity('holdings')
@Unique(['userId', 'instrumentId'])
export class Holding {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Column('uuid')
  instrumentId: string;

  @Column({ type: 'varchar' })
  direction: Direction;

  @CreateDateColumn()
  createdAt: Date;
}
