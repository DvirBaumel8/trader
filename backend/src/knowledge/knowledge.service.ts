import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { InstrumentsService } from '../instruments/instruments.service.js';
import { UsersService } from '../users/users.service.js';
import { Edge, GraphInput, GraphNode, isNew, stampNodes, validateGraph } from './graph.js';
import { KnowledgeGraph } from './knowledge-graph.entity.js';
import { KnowledgeVersion } from './knowledge-version.entity.js';

export interface GraphView {
  symbol: string;
  version: number;
  updatedAt: string;
  lastViewedAt: string | null;
  nodes: GraphNode[];
  edges: Edge[];
}

export interface GraphSummary {
  symbol: string;
  nodeCount: number;
  updatedAt: string;
  hasNew: boolean;
}

const UNIQUE_VIOLATION = '23505';

function normalize(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function view(g: KnowledgeGraph): GraphView {
  return {
    symbol: g.symbol,
    version: g.version,
    updatedAt: g.updatedAt.toISOString(),
    lastViewedAt: g.lastViewedAt ? g.lastViewedAt.toISOString() : null,
    nodes: g.nodes,
    edges: g.edges,
  };
}

function problems(errors: string[]): never {
  throw new BadRequestException({ message: errors.join('; ') });
}

@Injectable()
export class KnowledgeService {
  constructor(
    @InjectRepository(KnowledgeGraph) private readonly graphs: Repository<KnowledgeGraph>,
    @InjectRepository(KnowledgeVersion) private readonly versionRows: Repository<KnowledgeVersion>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly instruments: InstrumentsService,
    private readonly users: UsersService,
  ) {}

  async list(): Promise<GraphSummary[]> {
    const user = await this.users.currentUser();
    const rows = await this.graphs.find({ where: { userId: user.id } });
    return rows
      .filter((g) => g.deletedAt === null)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map((g) => {
        const viewed = g.lastViewedAt ? g.lastViewedAt.toISOString() : null;
        return {
          symbol: g.symbol,
          nodeCount: g.nodes.length,
          updatedAt: g.updatedAt.toISOString(),
          hasNew: g.nodes.some((n) => isNew(n, viewed)),
        };
      });
  }

  async get(symbol: string): Promise<GraphView> {
    const user = await this.users.currentUser();
    return view(await this.live(user.id, normalize(symbol)));
  }

  async markViewed(symbol: string): Promise<{ ok: true }> {
    const user = await this.users.currentUser();
    const graph = await this.live(user.id, normalize(symbol));
    await this.graphs.update({ id: graph.id }, { lastViewedAt: new Date() });
    return { ok: true };
  }

  /** Newest first. Available for a deleted graph too, so there is something to revert to. */
  async versions(symbol: string): Promise<{ version: number; message: string; createdAt: string }[]> {
    const user = await this.users.currentUser();
    const graph = await this.graphs.findOne({ where: { userId: user.id, symbol: normalize(symbol) } });
    if (!graph) throw new NotFoundException(`No knowledge on ${normalize(symbol)}`);
    const rows = await this.versionRows.find({ where: { graphId: graph.id } });
    return rows
      .sort((a, b) => b.version - a.version)
      .map((v) => ({ version: v.version, message: v.message, createdAt: v.createdAt.toISOString() }));
  }

  /** Creates the graph (`baseVersion` 0) or saves a new version of it. */
  async put(symbolInput: string, baseVersion: number, message: string, input: GraphInput): Promise<GraphView> {
    const symbol = normalize(symbolInput);
    const user = await this.users.currentUser();
    const errors = validateGraph(input);
    if (errors.length > 0) problems(errors);

    if (baseVersion === 0) {
      // Only a brand-new graph needs the ticker checked; an existing one passed it already.
      const existing = await this.graphs.findOne({ where: { userId: user.id, symbol } });
      if (!existing) await this.instruments.findOrCreate(symbol);
    }

    return this.write(user.id, symbol, baseVersion, message, (current, now) => ({
      nodes: stampNodes(input.nodes, current?.nodes ?? [], now),
      edges: input.edges.map((e) => ({ from: e.from, to: e.to, label: e.label })),
      deleted: false,
    }));
  }

  /** Saves an old version's content as a new version. Also brings back a deleted graph. */
  async revert(symbolInput: string, baseVersion: number, version: number, message: string): Promise<GraphView> {
    const symbol = normalize(symbolInput);
    const user = await this.users.currentUser();
    return this.write(
      user.id,
      symbol,
      baseVersion,
      message,
      (current, now, old) => ({
        // Restored content that differs from the current graph counts as updated now, so it shows as new.
        nodes: stampNodes(old!.nodes, current?.nodes ?? [], now),
        edges: old!.edges,
        deleted: false,
      }),
      version,
    );
  }

  /** Hides the graph, saved as a version so a revert can bring it back. */
  async remove(symbolInput: string, baseVersion: number, message: string): Promise<{ ok: true }> {
    const symbol = normalize(symbolInput);
    const user = await this.users.currentUser();
    await this.write(
      user.id,
      symbol,
      baseVersion,
      message,
      (current) => ({ nodes: current!.nodes, edges: current!.edges, deleted: true }),
      undefined,
      true,
    );
    return { ok: true };
  }

  private async live(userId: string, symbol: string): Promise<KnowledgeGraph> {
    const graph = await this.graphs.findOne({ where: { userId, symbol } });
    if (!graph || graph.deletedAt !== null) throw new NotFoundException(`No knowledge on ${symbol}`);
    return graph;
  }

  /**
   * The one write path: lock the graph row, check the caller's base version,
   * build the next content, then save the row and its new version together.
   * A stale base version is a 409 and nothing is written.
   */
  private async write(
    userId: string,
    symbol: string,
    baseVersion: number,
    message: string,
    build: (
      current: KnowledgeGraph | null,
      now: string,
      old: KnowledgeVersion | null,
    ) => { nodes: GraphNode[]; edges: Edge[]; deleted: boolean },
    revertTo?: number,
    requireLive = false,
  ): Promise<GraphView> {
    try {
      return await this.dataSource.transaction(async (manager: EntityManager) => {
        const current = await manager.findOne(KnowledgeGraph, {
          where: { userId, symbol },
          lock: { mode: 'pessimistic_write' },
        });
        if (!current && revertTo !== undefined) throw new NotFoundException(`No knowledge on ${symbol}`);
        if (current && requireLive && current.deletedAt !== null) {
          throw new NotFoundException(`No knowledge on ${symbol}`);
        }
        if (!current && requireLive) throw new NotFoundException(`No knowledge on ${symbol}`);
        const currentVersion = current?.version ?? 0;
        if (baseVersion !== currentVersion) {
          throw new ConflictException(
            `${symbol} is at version ${currentVersion}, not ${baseVersion}. Read it again and retry.`,
          );
        }

        let old: KnowledgeVersion | null = null;
        if (revertTo !== undefined) {
          old = await manager.findOne(KnowledgeVersion, { where: { graphId: current!.id, version: revertTo } });
          if (!old) throw new NotFoundException(`${symbol} has no version ${revertTo}`);
        }

        const nowDate = new Date();
        const next = build(current, nowDate.toISOString(), old);
        const graph = current ?? manager.create(KnowledgeGraph, { userId, symbol, lastViewedAt: null });
        graph.version = currentVersion + 1;
        graph.nodes = next.nodes;
        graph.edges = next.edges;
        graph.deletedAt = next.deleted ? nowDate : null;
        graph.updatedAt = nowDate;
        const saved = await manager.save(KnowledgeGraph, graph);
        await manager.save(
          KnowledgeVersion,
          manager.create(KnowledgeVersion, {
            graphId: saved.id,
            version: saved.version,
            message,
            nodes: next.nodes,
            edges: next.edges,
            deleted: next.deleted,
          }),
        );
        return view(saved);
      });
    } catch (err) {
      // Two creates of the same graph at once: the loser hits the unique index.
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new ConflictException(`${symbol} was changed by someone else. Read it again and retry.`);
      }
      throw err;
    }
  }
}
