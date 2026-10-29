import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** An API key for a command-line tool. Only the sha256 of the key is stored. */
@Entity('api_keys')
export class ApiKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  userId: string;

  @Column()
  name: string;

  @Column({ type: 'varchar', unique: true })
  keyHash: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null;
}
