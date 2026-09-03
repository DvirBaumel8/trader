import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiSummary } from './ai-summary.entity.js';
import { UsersService } from '../users/users.service.js';

export interface CreateAiSummaryInput {
  summary: string;
  factsSnapshot: string;
  model: string;
  grounded: boolean;
  /** ISO timestamp — portfolio.pricedAt at generation time. */
  factsAsOf: string;
}

/**
 * What a history row needs to let the owner decide whether to open it:
 * when it was generated and a taste of what it said. Deliberately excludes
 * `factsSnapshot` (can run to a few KB — the whole point of a light list) and
 * the full `summary` (truncated server-side into `preview` instead), plus
 * `model`/`grounded`, which are debugging detail nobody scans a list for.
 */
export interface AiSummaryListRow {
  id: string;
  createdAt: string;
  factsAsOf: string;
  preview: string;
}

/** The full record, including the facts snapshot — only fetched one at a time. */
export interface AiSummaryDetail {
  id: string;
  summary: string;
  factsSnapshot: string;
  model: string;
  grounded: boolean;
  factsAsOf: string;
  createdAt: string;
}

const PREVIEW_LENGTH = 160;

function toPreview(summary: string): string {
  const flat = summary.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_LENGTH
    ? `${flat.slice(0, PREVIEW_LENGTH).trimEnd()}…`
    : flat;
}

function toDetail(row: AiSummary): AiSummaryDetail {
  return {
    id: row.id,
    summary: row.summary,
    factsSnapshot: row.factsSnapshot,
    model: row.model,
    grounded: row.grounded,
    factsAsOf: row.factsAsOf.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * CRD (deliberately no U) for saved AI portfolio summaries. `userId` is
 * threaded through every query — even though today there is exactly one
 * user — so one user's id can never fetch or delete another's row; an
 * unknown or foreign id looks identical to the caller (404), matching
 * journal.service.ts's existing pattern for owned records.
 */
@Injectable()
export class AiSummaryService {
  constructor(
    @InjectRepository(AiSummary)
    private readonly summaries: Repository<AiSummary>,
    private readonly users: UsersService,
  ) {}

  async create(input: CreateAiSummaryInput): Promise<AiSummaryDetail> {
    const user = await this.users.ensureDefaultUser();
    const saved = await this.summaries.save(
      this.summaries.create({
        userId: user.id,
        summary: input.summary,
        factsSnapshot: input.factsSnapshot,
        model: input.model,
        grounded: input.grounded,
        factsAsOf: new Date(input.factsAsOf),
      }),
    );
    return toDetail(saved);
  }

  async list(): Promise<AiSummaryListRow[]> {
    const user = await this.users.ensureDefaultUser();
    // factsSnapshot is left out of the selection entirely — it's the one
    // field guaranteed to be large, and a list of history rows never needs
    // it. `summary` is still fetched (to build the preview) but truncated
    // before it leaves this method.
    const rows = await this.summaries
      .createQueryBuilder('s')
      .select(['s.id', 's.summary', 's.factsAsOf', 's.createdAt'])
      .where('s.userId = :userId', { userId: user.id })
      .orderBy('s.createdAt', 'DESC')
      .getMany();

    return rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      factsAsOf: row.factsAsOf.toISOString(),
      preview: toPreview(row.summary),
    }));
  }

  /**
   * The most recent summary, or null if there is none yet — fed back into the
   * next prompt so the model can say what has CHANGED rather than describing
   * the same book again. `factsSnapshot` is deliberately not selected: the
   * model gets fresh facts every time, and handing it a stale copy alongside
   * them is an invitation to quote the wrong one.
   */
  async findLatest(): Promise<{ summary: string; factsAsOf: Date } | null> {
    const user = await this.users.ensureDefaultUser();
    const row = await this.summaries
      .createQueryBuilder('s')
      .select(['s.summary', 's.factsAsOf'])
      .where('s.userId = :userId', { userId: user.id })
      .orderBy('s.createdAt', 'DESC')
      .limit(1)
      .getOne();
    return row ? { summary: row.summary, factsAsOf: row.factsAsOf } : null;
  }

  async findOne(id: string): Promise<AiSummaryDetail> {
    const user = await this.users.ensureDefaultUser();
    const row = await this.summaries.findOne({ where: { id, userId: user.id } });
    if (!row) throw new NotFoundException('Summary not found');
    return toDetail(row);
  }

  async remove(id: string): Promise<void> {
    const user = await this.users.ensureDefaultUser();
    const result = await this.summaries.delete({ id, userId: user.id });
    if (!result.affected) throw new NotFoundException('Summary not found');
  }
}
