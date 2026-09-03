import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TradeIdea } from './trade-idea.entity.js';
import { UsersService } from '../users/users.service.js';

/**
 * What a history row needs to let the owner decide whether to open it: which
 * ticker, when, the numbers, and a taste of the prose. Deliberately excludes
 * `factsSnapshot` — the whole prompt, running to a few KB, and the one field
 * guaranteed to make a list heavy — and the full `opinion`, truncated
 * server-side into `preview` instead.
 */
export interface TradeIdeaListRow {
  id: string;
  createdAt: string;
  symbol: string;
  entryPrice: number;
  stop: number | null;
  target: number | null;
  riskReward: number | null;
  preview: string;
}

/** The full record, including the facts snapshot — only fetched one at a time. */
export interface TradeIdeaDetail extends Omit<TradeIdeaListRow, 'preview'> {
  opinion: string;
  factsSnapshot: string;
  priceStale: boolean;
  model: string;
}

const PREVIEW_LENGTH = 160;

function toPreview(opinion: string): string {
  const flat = opinion.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_LENGTH
    ? `${flat.slice(0, PREVIEW_LENGTH).trimEnd()}…`
    : flat;
}

function toDetail(row: TradeIdea): TradeIdeaDetail {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    symbol: row.symbol,
    entryPrice: row.entryPrice,
    stop: row.stop,
    target: row.target,
    riskReward: row.riskReward,
    opinion: row.opinion,
    factsSnapshot: row.factsSnapshot,
    priceStale: row.priceStale,
    model: row.model,
  };
}

/**
 * Read and delete for saved trade ideas. The write lives in
 * `trade-idea.service.ts`, next to the call that produces the opinion.
 *
 * `userId` is threaded through every query — even though today there is
 * exactly one user — so one user's id can never fetch or delete another's
 * row; an unknown or foreign id looks identical to the caller (404), matching
 * the pattern in ai-summary.service.ts and journal.service.ts.
 */
@Injectable()
export class TradeIdeaHistoryService {
  constructor(
    @InjectRepository(TradeIdea)
    private readonly ideas: Repository<TradeIdea>,
    private readonly users: UsersService,
  ) {}

  async list(): Promise<TradeIdeaListRow[]> {
    const owner = await this.users.ensureDefaultUser();
    // factsSnapshot is left out of the selection entirely. `opinion` is still
    // fetched, to build the preview, but truncated before it leaves here.
    const rows = await this.ideas
      .createQueryBuilder('i')
      .select([
        'i.id',
        'i.symbol',
        'i.entryPrice',
        'i.stop',
        'i.target',
        'i.riskReward',
        'i.opinion',
        'i.createdAt',
      ])
      .where('i.userId = :userId', { userId: owner.id })
      .orderBy('i.createdAt', 'DESC')
      .getMany();

    return rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      symbol: row.symbol,
      entryPrice: row.entryPrice,
      stop: row.stop,
      target: row.target,
      riskReward: row.riskReward,
      preview: toPreview(row.opinion),
    }));
  }

  async findOne(id: string): Promise<TradeIdeaDetail> {
    const owner = await this.users.ensureDefaultUser();
    const row = await this.ideas.findOne({ where: { id, userId: owner.id } });
    if (!row) throw new NotFoundException('Trade idea not found');
    return toDetail(row);
  }

  async remove(id: string): Promise<void> {
    const owner = await this.users.ensureDefaultUser();
    const result = await this.ideas.delete({ id, userId: owner.id });
    if (!result.affected) throw new NotFoundException('Trade idea not found');
  }
}
