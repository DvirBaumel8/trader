import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type InstrumentType = 'STOCK' | 'ETF';

@Entity('instruments')
export class Instrument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  symbol: string;

  @Column({ nullable: true, type: 'varchar' })
  name: string | null;

  @Column({ type: 'varchar', default: 'STOCK' })
  type: InstrumentType;

  /** SPY and QQQ get price history without ever appearing as holdings. */
  @Column({ default: false })
  isBenchmark: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
