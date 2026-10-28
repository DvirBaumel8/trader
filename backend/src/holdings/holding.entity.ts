import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

export type Direction = 'LONG' | 'SHORT';

/** A symbol the owner holds and which way. Deliberately no quantity or price. */
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
