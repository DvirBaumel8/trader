import { Injectable, Logger } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LlmClient } from './llm.client.js';
import { buildPortfolioContext } from './portfolio-context.js';
import { buildSystemPrompt, buildUserPrompt } from './prompts.js';
import { AiSummaryService } from './ai-summary.service.js';
import { PortfolioService } from '../portfolio/portfolio.service.js';
import { PerformanceService } from '../performance/performance.service.js';

// Resolved relative to this compiled file (backend/dist/llm/llm.service.js)
// rather than process.cwd(), so it also works on Render: the repo ships
// whole (see render.yaml's `rootDir: backend`), the profile just lives one
// level above `backend/`, and this stays correct in dev too since Nest
// always runs from dist, never ts-node in place.
const PROFILE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../docs/trader-profile.md',
);

export interface PortfolioSummaryResult {
  configured: boolean;
  summary: string | null;
  factsAsOf: string | null;
  error: string | null;
  /** The saved summary's id, so the frontend can jump straight to it in history. Null when nothing was persisted. */
  id: string | null;
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(
    private readonly llm: LlmClient,
    private readonly portfolio: PortfolioService,
    private readonly performance: PerformanceService,
    private readonly summaries: AiSummaryService,
  ) {}

  isConfigured(): boolean {
    return this.llm.isConfigured();
  }

  /**
   * Always makes a fresh model call — no caching, by the owner's explicit
   * choice, since a stale AI take is worse than a slow one.
   */
  async portfolioSummary(): Promise<PortfolioSummaryResult> {
    if (!this.llm.isConfigured()) {
      return { configured: false, summary: null, factsAsOf: null, error: null, id: null };
    }

    const [portfolio, stats, series] = await Promise.all([
      this.portfolio.getPortfolio(),
      this.portfolio.getStats(),
      this.performance.getSeries('1M'),
    ]);

    const last = series.points.at(-1) ?? null;
    const facts = buildPortfolioContext({
      portfolio: {
        positions: portfolio.positions,
        cash: portfolio.cash,
        positionsValue: portfolio.positionsValue,
        accountValue: portfolio.accountValue,
        pricedAt: portfolio.pricedAt,
        hasStalePrices: portfolio.hasStalePrices,
        atRisk: portfolio.atRisk,
      },
      stats,
      performance:
        series.points.length > 0
          ? {
              range: series.range,
              youReturn: last?.you ?? null,
              deltas: series.deltas,
            }
          : null,
    });

    const profile = await this.readProfile();
    const system = buildSystemPrompt(profile);
    const user = buildUserPrompt(facts);

    try {
      const summary = await this.llm.complete({ system, user, grounded: true });
      // Persisted only on a real result — an unconfigured provider or a
      // failed call leaves nothing worth keeping (see the owner's framing:
      // "once we have the summary"). This is also why there is no separate
      // "save" step: every summary the model actually produces is history.
      const saved = await this.summaries.create({
        summary,
        factsSnapshot: facts,
        model: this.llm.modelName(),
        grounded: true,
        factsAsOf: portfolio.pricedAt,
      });
      return {
        configured: true,
        summary,
        factsAsOf: portfolio.pricedAt,
        error: null,
        id: saved.id,
      };
    } catch (err) {
      // A transient provider failure (rate limit, network, empty response)
      // must not 500 the endpoint — it becomes a clear, non-alarming message
      // in the UI instead. See the "no key configured" path above for the
      // same principle applied to the simpler case.
      this.logger.warn(`AI summary call failed: ${(err as Error).message}`);
      return {
        configured: true,
        summary: null,
        factsAsOf: portfolio.pricedAt,
        error: 'The AI summary could not be generated right now. Try again shortly.',
        id: null,
      };
    }
  }

  private async readProfile(): Promise<string | null> {
    try {
      return await readFile(PROFILE_PATH, 'utf-8');
    } catch {
      // Missing file (not yet interviewed, or a deploy without docs/) is a
      // normal state, not an error — prompts.ts renders an honest fallback.
      return null;
    }
  }
}
