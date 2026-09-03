import { Injectable, Logger } from '@nestjs/common';
import { LlmClient, LlmFailure, type LlmFailureKind } from './llm.client.js';
import { ERROR_COPY } from './llm.service.js';
import { buildSystemPrompt } from './prompts.js';
import { buildTradeIdeaPrompt } from './trade-idea-prompt.js';
import { parseProposedLevels, stripLevelsBlock } from './trade-idea-parse.js';
import {
  TickerFactsService,
  type TickerFacts,
} from '../market-data/ticker-facts.service.js';
import { PortfolioService } from '../portfolio/portfolio.service.js';
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

    // A NotFoundException (unknown ticker) or ServiceUnavailableException
    // (provider down) propagates deliberately: those are different failures
    // from "the model could not answer", and flattening them into this
    // result shape would hide which one happened.
    const facts = await this.tickerFacts.get(upper);
    const usualRisk = (await this.portfolio.getStats()).avgRisk ?? null;

    const system = buildSystemPrompt(await this.readProfile());
    const user = buildTradeIdeaPrompt(facts, usualRisk);

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
