import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LlmClient, LlmFailure, type LlmFailureKind } from './llm.client.js';
import { TradeIdea } from './trade-idea.entity.js';
import { UsersService } from '../users/users.service.js';
import { AiOutcomeService } from './ai-outcome.service.js';
import { ERROR_COPY } from './llm.service.js';
import { buildSystemPrompt } from './prompts.js';
import { buildTradeIdeaPrompt } from './trade-idea-prompt.js';
import {
  buildBookSection,
  buildRecordSection,
  substituteBookPlaceholders,
} from './trade-idea-context.js';
import { parseProposedLevels, stripLevelsBlock } from './trade-idea-parse.js';
import { streamTradeIdeaBody } from './trade-idea-stream.js';
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
import { readTraderProfile } from './trader-profile.js';

export interface TradeIdeaResult {
  id: string | null;
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

/** The final line of `analyseStream` — everything `TradeIdeaResult` carries
 * except `opinion` itself, which the streamed `{"delta": "..."}` lines
 * (already LEVELS-free and placeholder-substituted) already are. */
export type TradeIdeaStreamDone = Omit<TradeIdeaResult, 'opinion'> & {
  done: true;
};

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
    private readonly outcomes: AiOutcomeService,
  ) {}

  /** Everything `analyse` and `analyseStream` share: the facts, the book,
   * the usual risk, and the assembled prompt. Neither the model call nor
   * persistence lives here, so both callers stay free to handle those
   * differently. */
  private async buildIdeaContext(upper: string, note?: string) {
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
        readTraderProfile(),
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
      note,
    });

    return { facts, book, usualRisk, system, user };
  }

  async analyse(symbol: string, note?: string): Promise<TradeIdeaResult> {
    const upper = symbol.trim().toUpperCase();

    // Short-circuit before any market data is fetched: with no key there is
    // no opinion to give, and hitting Yahoo would spend a request on an
    // answer that cannot be produced.
    if (!this.llm.isConfigured()) {
      return {
        id: null,
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

    const { facts, book, usualRisk, system, user } = await this.buildIdeaContext(upper, note);

    let raw: string;
    try {
      raw = await this.llm.complete({
        system,
        user,
        grounded: false,
        // Short, structured output (a verdict plus a LEVELS block) — measured
        // at ~3s against 9-18s for the provider's own automatic budget, with
        // no visible loss of answer quality. See llm.client.ts's thinkingLevel
        // comment for where that measurement came from.
        thinkingLevel: 'MINIMAL',
      });
    } catch (err) {
      const kind: LlmFailureKind =
        err instanceof LlmFailure ? err.kind : 'unknown';
      this.logger.warn(
        `Trade idea call failed for ${upper} (${kind}): ${(err as Error).message}`,
      );
      return {
        id: null,
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
    // Substituted before anything else touches the text, so both the live
    // response and the persisted row carry the real figure — never the
    // model's own transcription of it. See substituteBookPlaceholders.
    const opinion = substituteBookPlaceholders(stripLevelsBlock(raw).trim(), book);

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
    const owner = await this.users.currentUser();
    const saved = await this.ideas.save(
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

    // Only a readable idea has anything to grade — see the entity's own
    // doc comment on why an unreadable one is still saved.
    if (levels) {
      await this.outcomes.recordOutcome('trade_idea', saved.id);
    }

    return {
      id: saved.id,
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

  /**
   * Same call as `analyse`, streamed. Yields newline-delimited JSON — see
   * `LlmService.portfolioSummaryStream`'s doc comment for the general shape.
   * The hard part lives in `streamTradeIdeaBody`: unlike a meta block, the
   * trailing LEVELS block has no closing tag, and `{{WEIGHT:LMND}}`-style
   * placeholders can appear anywhere in the body rather than in one fixed
   * spot — both must never reach the screen raw. Every `{"delta": ...}`
   * line here is already LEVELS-free and placeholder-substituted; nothing
   * further needs doing to it before display.
   */
  async *analyseStream(symbol: string, note?: string): AsyncGenerator<string> {
    const emit = (data: TradeIdeaStreamDone) => `${JSON.stringify(data)}\n`;
    const upper = symbol.trim().toUpperCase();

    if (!this.llm.isConfigured()) {
      yield emit({
        done: true,
        configured: false,
        symbol: upper,
        facts: null,
        levels: null,
        risk: null,
        levelsUnreadable: false,
        error: null,
        errorKind: null,
        id: null,
      });
      return;
    }

    const { facts, book, usualRisk, system, user } = await this.buildIdeaContext(upper, note);

    try {
      const raw = this.llm.completeStream({
        system,
        user,
        grounded: false,
        thinkingLevel: 'MINIMAL',
      });
      const body = streamTradeIdeaBody(raw, book);
      // Manually driven, not `for await...of` — see the identical comment
      // in `TradeReviewService.reviewTradeStream` for why.
      let next = await body.next();
      while (!next.done) {
        yield `${JSON.stringify({ delta: next.value })}\n`;
        next = await body.next();
      }
      const rawText = next.value;

      const levels = parseProposedLevels(rawText);
      const opinion = substituteBookPlaceholders(stripLevelsBlock(rawText).trim(), book);
      const risk = levels
        ? computeTradeRisk({
            entryPrice: facts.price,
            stop: levels.stop,
            target: levels.target,
            usualRisk,
          })
        : null;

      const owner = await this.users.currentUser();
      const saved = await this.ideas.save(
        this.ideas.create({
          userId: owner.id,
          symbol: upper,
          entryPrice: facts.price,
          priceStale: facts.stale,
          stop: levels?.stop ?? null,
          target: levels?.target ?? null,
          riskReward: risk?.riskReward ?? null,
          opinion,
          factsSnapshot: user,
          model: this.llm.modelName(),
        }),
      );

      if (levels) {
        await this.outcomes.recordOutcome('trade_idea', saved.id);
      }

      yield emit({
        done: true,
        configured: true,
        symbol: upper,
        facts,
        levels,
        risk,
        levelsUnreadable: levels === null,
        error: null,
        errorKind: null,
        id: saved.id,
      });
    } catch (err) {
      const kind: LlmFailureKind = err instanceof LlmFailure ? err.kind : 'unknown';
      this.logger.warn(
        `Trade idea stream failed for ${upper} (${kind}): ${(err as Error).message}`,
      );
      yield emit({
        done: true,
        configured: true,
        symbol: upper,
        facts,
        levels: null,
        risk: null,
        levelsUnreadable: false,
        error: ERROR_COPY[kind],
        errorKind: kind,
        id: null,
      });
    }
  }
}
