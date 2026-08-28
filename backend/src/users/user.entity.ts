import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { numericTransformer } from '../common/numeric.transformer.js';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ default: 'me' })
  displayName: string;

  @Column('numeric', {
    precision: 12,
    scale: 2,
    default: 4,
    transformer: numericTransformer,
  })
  defaultFee: number;

  @CreateDateColumn()
  createdAt: Date;
}
