import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
import type { Edge, GraphNode } from './graph.js';

/** The current version of one user's graph for one ticker. */
@Entity('knowledge_graphs')
@Unique(['userId', 'symbol'])
export class KnowledgeGraph {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  userId: string;

  /** Upper-case. */
  @Column()
  symbol: string;

  @Column({ type: 'int' })
  version: number;

  @Column({ type: 'jsonb' })
  nodes: GraphNode[];

  @Column({ type: 'jsonb' })
  edges: Edge[];

  @Column({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastViewedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  /** Set by the service when a version is saved, so marking a graph viewed does not move it. */
  @Column({ type: 'timestamptz' })
  updatedAt: Date;
}
