import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { LlmClient, LlmFailure, type LlmFailureKind } from './llm.client.js';
import { SymbolPatternRead } from './symbol-pattern.entity.js';
import { UsersService } from '../users/users.service.js';
import { ERROR_COPY } from './llm.service.js';
import { TradesService } from '../portfolio/trades.service.js';
import { JournalEntry } from '../journal/journal-entry.entity.js';
import { rangeStartDate, type Range } from '../common/date-range.js';
import { filterTradesByDate } from '../portfolio/derive-trades.js';
import {
  buildSymbolPatternFacts,
  type SymbolPatternFacts,
} from './symbol-pattern-context.js';
import { buildSymbolPatternPrompt } from './symbol-pattern-prompt.js';
import { parsePatternMeta, stripPatternMeta } from './symbol-pattern-parse.js';
import { readTraderProfile } from './trader-profile.js';

export interface SymbolPatternResult {
  configured: boolean;
  symbol: string;
  range: Range;
  headline: string | null;
  read: string | null;
  facts: SymbolPatternFacts | null;
  createdAt: string | null;
  error: string | null;
  errorKind: LlmFailureKind | null;
}

@Injectable()
export class SymbolPatternService {
  private readonly logger = new Logger(SymbolPatternService.name);

  constructor(
    private readonly llm: LlmClient,
    private readonly trades: TradesService,
    private readonly users: UsersService,
    @InjectRepository(SymbolPatternRead)
    private readonly reads: Repository<SymbolPatternRead>,
    @InjectRepository(JournalEntry)
    private readonly entries: Repository<JournalEntry>,
  ) {}

  /** `range === 'ALL'` -> no lower bound, matching `TradesService`'s own
   * private `resolveFromDate` — the same one-liner around the shared
   * `rangeStartDate`, kept local rather than exposed since it is the only
   * other caller that needs raw, unfiltered-by-tags trades for a window. */
  private resolveFromDate(range: Range): string | null {
    return range === 'ALL'
      ? null
      : rangeStartDate(range, new Date().toISOString().slice(0, 10), '0000-01-01');
  }

  async getLatest(symbol: string, range: Range): Promise<SymbolPatternResult | null> {
    const user = await this.users.currentUser();
    const existing = await this.reads.findOne({
      where: { userId: user.id, symbol: symbol.toUpperCase(), range },
      order: { createdAt: 'DESC' },
    });

    if (!existing) {
      return null;
    }

    let facts: SymbolPatternFacts | null = null;
    try {
      facts = JSON.parse(existing.factsSnapshot);
    } catch {
      facts = null;
    }

    return {
      configured: this.llm.isConfigured(),
      symbol: existing.symbol,
      range: existing.range as Range,
      headline: existing.headline,
      read: existing.read,
      facts,
      createdAt: existing.createdAt.toISOString(),
      error: null,
      errorKind: null,
    };
  }

  async generate(symbol: string, range: Range): Promise<SymbolPatternResult> {
    const user = await this.users.currentUser();

    // Throws NotFoundException for an unknown ticker — the same guard the
    // Stock detail page's own fetch already relies on.
    const summary = await this.trades.getSymbolSummary(symbol, range);
    const overall = await this.trades.getStats(range);

    // The summary's own `trades` have their fills stripped (collapsed onto
    // setups/mistakes for the list screens), so the raw, per-fill trades are
    // fetched again here — this is the only caller that needs an entryId to
    // reach a trade's journal notes.
    const all = await this.trades.deriveAllTrades();
    const forSymbol = all.filter((t) => t.symbol.toUpperCase() === summary.symbol);
    const windowed = filterTradesByDate(forSymbol, this.resolveFromDate(range));
    const entryIds = windowed
      .flatMap((t) => t.fills)
      .map((f) => f.entryId)
      .filter((id): id is string => Boolean(id));

    let notes: string[] = [];
    if (entryIds.length > 0) {
      const journalRows = await this.entries.find({
        where: { id: In(entryIds), userId: user.id },
      });
      notes = journalRows.map((r) => r.body).filter((b) => b.trim().length > 0);
    }

    const facts = buildSymbolPatternFacts({
      symbol: summary.symbol,
      range,
      thisName: {
        closedCount: summary.closedCount,
        winRate: summary.winRate,
        avgWin: summary.avgWin,
        avgLoss: summary.avgLoss,
        avgRisk: summary.avgRisk,
        expectancyR: summary.expectancyR,
        avgPositionSize: summary.avgPositionSize,
        avgHoldingDays: summary.avgHoldingDays,
        totalPnl: summary.totalPnl,
        feesPaid: summary.feesPaid,
      },
      overall: {
        closedCount: overall.closedCount,
        winRate: overall.winRate,
        avgWin: overall.avgWin,
        avgLoss: overall.avgLoss,
        avgRisk: overall.avgRisk,
        expectancyR: overall.expectancyR,
        avgPositionSize: overall.avgPositionSize,
        avgHoldingDays: overall.avgHoldingDays,
      },
      trades: summary.trades,
      notes,
    });

    if (!this.llm.isConfigured()) {
      return {
        configured: false,
        symbol: summary.symbol,
        range,
        headline: null,
        read: null,
        facts,
        createdAt: null,
        error: null,
        errorKind: null,
      };
    }

    const profileText = await readTraderProfile();
    const { system, user: userPrompt } = buildSymbolPatternPrompt(facts, profileText);

    try {
      const rawText = await this.llm.complete({
        system,
        user: userPrompt,
        grounded: false,
      });

      const { headline } = parsePatternMeta(rawText);
      const cleanRead = stripPatternMeta(rawText);

      const record = this.reads.create({
        userId: user.id,
        symbol: summary.symbol,
        range,
        headline,
        read: cleanRead,
        factsSnapshot: JSON.stringify(facts),
        model: this.llm.modelName(),
      });
      await this.reads.save(record);

      return {
        configured: true,
        symbol: summary.symbol,
        range,
        headline,
        read: cleanRead,
        facts,
        createdAt: record.createdAt?.toISOString() ?? new Date().toISOString(),
        error: null,
        errorKind: null,
      };
    } catch (err) {
      const kind: LlmFailureKind = err instanceof LlmFailure ? err.kind : 'unknown';
      this.logger.warn(
        `AI Symbol Pattern call failed (${kind}): ${(err as Error).message}`,
      );
      return {
        configured: true,
        symbol: summary.symbol,
        range,
        headline: null,
        read: null,
        facts,
        createdAt: null,
        error: ERROR_COPY[kind],
        errorKind: kind,
      };
    }
  }
}
