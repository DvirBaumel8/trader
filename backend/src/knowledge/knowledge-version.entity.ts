import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
import type { Edge, GraphNode } from './graph.js';

/** One saved version of a graph; history is never rewritten. */
@Entity('knowledge_versions')
@Unique(['graphId', 'version'])
export class KnowledgeVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  graphId: string;

  @Column({ type: 'int' })
  version: number;

  @Column()
  message: string;

  @Column({ type: 'jsonb' })
  nodes: GraphNode[];

  @Column({ type: 'jsonb' })
  edges: Edge[];

  /** True for the version written by a delete. */
  @Column({ type: 'boolean', default: false })
  deleted: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
