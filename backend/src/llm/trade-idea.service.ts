import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LlmClient, LlmFailure, type LlmFailureKind } from './llm.client.js';
import { TradeIdea } from './trade-idea.entity.js';
import { UsersService } from '../users/users.service.js';
import { ERROR_COPY } from './llm.service.js';
import { buildSystemPrompt } from './prompts.js';
import { buildTradeIdeaPrompt } from './trade-idea-prompt.js';
import { buildBookSection, buildRecordSection } from './trade-idea-context.js';
import { parseProposedLevels, stripLevelsBlock } from './trade-idea-parse.js';
import {
  TickerFactsService,
  type TickerFacts,
} from '../market-data/ticker-facts.service.js';
import { PortfolioService } from '../portfolio/portfolio.service.js';
import { TradesService } from '../portfolio/trades.service.js';
import {
  computeTradeRisk,
  type TradeRiskResult,
} from '../portfolio/trade-risk.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const PROFILE_PATH = join(process.cwd(), '..', 'docs', 'trader-profile.md');

export interface TradeIdeaResult {
  configured: boolean;
  symbol: string;
  facts: TickerFacts | null;
  opinion: string | null;
  levels: { stop: number; target: number } | null;
  risk: TradeRiskResult | null;
  /** True when the model answered but its levels could not be read. */
  levelsUnreadable: boolean;
  error: string | null;
  errorKind: LlmFailureKind | null;
}

/**
 * A pre-trade opinion: name a ticker, hear what the app and the model make of
 * buying it now.
 *
 * The division of labour is the point. The app computes the chart facts and,
 * from the model's two proposed levels, every figure that follows. The model
 * judges: whether this fits how the owner trades, whether the stock is worth
 * buying, whether the risk/reward is worth taking — and it may draw on its own
 * knowledge of the business, which is the one place in this codebase where
 * unverified information is allowed, because only the model can supply it.
 *
 * It may never state a number it was not given, and it never computes a ratio.
 */
@Injectable()
export class TradeIdeaService {
  private readonly logger = new Logger(TradeIdeaService.name);

  constructor(
    private readonly llm: LlmClient,
    private readonly tickerFacts: TickerFactsService,
    private readonly portfolio: PortfolioService,
    private readonly trades: TradesService,
    @InjectRepository(TradeIdea)
    private readonly ideas: Repository<TradeIdea>,
    private readonly users: UsersService,
  ) {}

  async analyse(symbol: string): Promise<TradeIdeaResult> {
    const upper = symbol.trim().toUpperCase();

    // Short-circuit before any market data is fetched: with no key there is
    // no opinion to give, and hitting Yahoo would spend a request on an
    // answer that cannot be produced.
    if (!this.llm.isConfigured()) {
      return {
        configured: false,
        symbol: upper,
        facts: null,
        opinion: null,
        levels: null,
        risk: null,
        levelsUnreadable: false,
        error: null,
        errorKind: null,
      };
    }

    // The book and the record, not just the chart. Without them the model
    // answered "should I open this?" when he already held 4,600 shares of the
    // name — see trade-idea-context.ts.
    //
    // All four are gathered at once. They used to run one after another —
    // the facts (two provider round trips), then the book and record, then
    // the profile off disk — and none of them needs anything from the
    // others, so the request simply waited through the sum of them before
    // the model was even asked. `getPortfolio` alone is documented at 1.1s
    // and 2.6s in real use.
    const [factsResult, statsResult, bookResult, profileResult] =
      await Promise.allSettled([
        this.tickerFacts.get(upper),
        this.trades.getStats(),
        this.portfolio.getPortfolio(),
        this.readProfile(),
      ]);

    // Checked in the order they used to run, so which failure a caller sees
    // is unchanged. A NotFoundException (unknown ticker) or
    // ServiceUnavailableException (provider down) still propagates from the
    // facts before anything else is considered — those are different
    // failures from "the model could not answer", and running the gathering
    // concurrently must not let an unrelated one overtake them.
    if (factsResult.status === 'rejected') throw factsResult.reason;
    if (statsResult.status === 'rejected') throw statsResult.reason;
    if (bookResult.status === 'rejected') throw bookResult.reason;
    if (profileResult.status === 'rejected') throw profileResult.reason;

    const facts = factsResult.value;
    const stats = statsResult.value;
    const book = bookResult.value;
    const usualRisk = stats.avgRisk ?? null;

    const system = buildSystemPrompt(profileResult.value);
    const user = buildTradeIdeaPrompt(facts, usualRisk, {
      book: buildBookSection(book, upper),
      record: buildRecordSection(stats, upper),
    });

    let raw: string;
    try {
      raw = await this.llm.complete({ system, user, grounded: false });
    } catch (err) {
      const kind: LlmFailureKind =
        err instanceof LlmFailure ? err.kind : 'unknown';
      this.logger.warn(
        `Trade idea call failed for ${upper} (${kind}): ${(err as Error).message}`,
      );
      return {
        configured: true,
        symbol: upper,
        facts,
        opinion: null,
        levels: null,
        risk: null,
        levelsUnreadable: false,
        error: ERROR_COPY[kind],
        errorKind: kind,
      };
    }

    const levels = parseProposedLevels(raw);
    const opinion = stripLevelsBlock(raw).trim();

    // No levels means no derived numbers at all — not a partial set, not a
    // guess at the missing one. The caller says so explicitly rather than
    // rendering a risk section with blanks in it.
    const risk = levels
      ? computeTradeRisk({
          entryPrice: facts.price,
          stop: levels.stop,
          target: levels.target,
          usualRisk,
        })
      : null;

    // Saved on the success path only, mirroring LlmService: an unconfigured
    // provider or a failed call has already returned above, so a history of
    // ideas never fills up with rows recording that nothing was said. An
    // unreadable-levels answer IS saved — it is a real opinion, minus numbers.
    const owner = await this.users.ensureDefaultUser();
    await this.ideas.save(
      this.ideas.create({
        userId: owner.id,
        symbol: upper,
        entryPrice: facts.price,
        priceStale: facts.stale,
        stop: levels?.stop ?? null,
        target: levels?.target ?? null,
        riskReward: risk?.riskReward ?? null,
        opinion,
        // The prompt the model actually read, verbatim — the same reason
        // ai_summaries keeps its facts block.
        factsSnapshot: user,
        model: this.llm.modelName(),
      }),
    );

    return {
      configured: true,
      symbol: upper,
      facts,
      opinion,
      levels,
      risk,
      levelsUnreadable: levels === null,
      error: null,
      errorKind: null,
    };
  }

  /** The owner's trading profile, or null when the file is missing. */
  private async readProfile(): Promise<string | null> {
    try {
      return await readFile(PROFILE_PATH, 'utf-8');
    } catch {
      return null;
    }
  }
}
