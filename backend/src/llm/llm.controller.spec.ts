import { describe, expect, it, vi } from 'vitest';
import { LlmController } from './llm.controller.js';
import type { TradeIdeaService } from './trade-idea.service.js';
import type { TradeIdeaHistoryService } from './trade-idea-history.service.js';
import type { LlmService } from './llm.service.js';
import type { AiSummaryService } from './ai-summary.service.js';
import type { TradeReviewService } from './trade-review.service.js';
import type { SymbolPatternService } from './symbol-pattern.service.js';

function fakeSummaries(): AiSummaryService {
  return {
    list: vi.fn(),
    findOne: vi.fn(),
    remove: vi.fn(),
    create: vi.fn(),
  } as unknown as AiSummaryService;
}

/** Unused by these tests; present only so the constructor is satisfied. */
function fakeTradeIdeas(): TradeIdeaService {
  return { analyse: vi.fn() } as unknown as TradeIdeaService;
}

/** Unused by these tests; present only so the constructor is satisfied. */
function fakeTradeReviews(): TradeReviewService {
  return {
    reviewTrade: vi.fn(),
    getReview: vi.fn(),
    reviewTradeStream: vi.fn(),
  } as unknown as TradeReviewService;
}

function fakeTradeIdeaHistory(): TradeIdeaHistoryService {
  return {
    list: vi.fn(),
    findOne: vi.fn(),
    remove: vi.fn(),
  } as unknown as TradeIdeaHistoryService;
}

/** Unused by these tests; present only so the constructor is satisfied. */
function fakeSymbolPatterns(): SymbolPatternService {
  return {
    getLatest: vi.fn(),
    generate: vi.fn(),
    generateStream: vi.fn(),
  } as unknown as SymbolPatternService;
}

describe('LlmController', () => {
  it('POST /ai/portfolio-summary returns whatever the service produces, unconfigured included', async () => {
    const unconfigured = {
      configured: false,
      summary: null,
      factsAsOf: null,
      error: null,
      id: null,
    };
    const llm = {
      portfolioSummary: vi.fn().mockResolvedValue(unconfigured),
    } as unknown as LlmService;
    const controller = new LlmController(
      llm,
      fakeSummaries(),
      fakeTradeIdeas(),
      fakeTradeIdeaHistory(),
      fakeTradeReviews(),
      fakeSymbolPatterns(),
    );

    const result = await controller.portfolioSummary();

    expect(result).toBe(unconfigured);
    expect(llm.portfolioSummary).toHaveBeenCalledTimes(1);
  });

  it('POST /ai/portfolio-summary/stream sets the ndjson content type and writes every yielded line, in order', async () => {
    async function* lines() {
      yield '{"delta":"You are "}\n';
      yield '{"delta":"up 4.2%."}\n';
      yield '{"done":true,"configured":true,"factsAsOf":"x","error":null,"errorKind":null,"id":"1"}\n';
    }
    const llm = {
      portfolioSummaryStream: vi.fn().mockReturnValue(lines()),
    } as unknown as LlmService;
    const controller = new LlmController(
      llm,
      fakeSummaries(),
      fakeTradeIdeas(),
      fakeTradeIdeaHistory(),
      fakeTradeReviews(),
      fakeSymbolPatterns(),
    );
    const res = {
      setHeader: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
    };

    await controller.portfolioSummaryStream(res as never);

    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/x-ndjson; charset=utf-8',
    );
    expect(res.write.mock.calls.map((c) => c[0])).toEqual([
      '{"delta":"You are "}\n',
      '{"delta":"up 4.2%."}\n',
      '{"done":true,"configured":true,"factsAsOf":"x","error":null,"errorKind":null,"id":"1"}\n',
    ]);
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('POST /ai/trade-reviews/:tradeId/stream writes every yielded line and sets the ndjson content type', async () => {
    async function* lines() {
      yield '{"delta":"Solid execution."}\n';
      yield '{"done":true,"configured":true,"tradeId":"t1","symbol":"NVDA","score":"A","verdict":"x","facts":null,"createdAt":"x","error":null,"errorKind":null}\n';
    }
    const tradeReviews = fakeTradeReviews();
    (tradeReviews.reviewTradeStream as ReturnType<typeof vi.fn>).mockReturnValue(lines());
    const controller = new LlmController(
      {} as LlmService,
      fakeSummaries(),
      fakeTradeIdeas(),
      fakeTradeIdeaHistory(),
      tradeReviews,
      fakeSymbolPatterns(),
    );
    const res = { setHeader: vi.fn(), write: vi.fn(), end: vi.fn() };

    await controller.reviewTradeStream('t1', res as never);

    expect(tradeReviews.reviewTradeStream).toHaveBeenCalledWith('t1');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/x-ndjson; charset=utf-8',
    );
    expect(res.write.mock.calls.map((c) => c[0])).toEqual([
      '{"delta":"Solid execution."}\n',
      '{"done":true,"configured":true,"tradeId":"t1","symbol":"NVDA","score":"A","verdict":"x","facts":null,"createdAt":"x","error":null,"errorKind":null}\n',
    ]);
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('POST /ai/symbol-patterns/:symbol/stream defaults range to ALL and writes every yielded line', async () => {
    async function* lines() {
      yield '{"delta":"You tend to hold winners"}\n';
      yield '{"done":true,"configured":true,"symbol":"NVDA","range":"ALL","headline":"x","facts":null,"createdAt":"x","error":null,"errorKind":null}\n';
    }
    const symbolPatterns = fakeSymbolPatterns();
    (symbolPatterns.generateStream as ReturnType<typeof vi.fn>).mockReturnValue(lines());
    const controller = new LlmController(
      {} as LlmService,
      fakeSummaries(),
      fakeTradeIdeas(),
      fakeTradeIdeaHistory(),
      fakeTradeReviews(),
      symbolPatterns,
    );
    const res = { setHeader: vi.fn(), write: vi.fn(), end: vi.fn() };

    await controller.generateSymbolPatternStream('nvda', undefined, res as never);

    expect(symbolPatterns.generateStream).toHaveBeenCalledWith('nvda', 'ALL');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/x-ndjson; charset=utf-8',
    );
    expect(res.write.mock.calls.map((c) => c[0])).toEqual([
      '{"delta":"You tend to hold winners"}\n',
      '{"done":true,"configured":true,"symbol":"NVDA","range":"ALL","headline":"x","facts":null,"createdAt":"x","error":null,"errorKind":null}\n',
    ]);
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('POST /ai/symbol-patterns/:symbol/stream passes through a valid range', async () => {
    async function* lines() {
      yield '{"done":true,"configured":true,"symbol":"NVDA","range":"1M","headline":null,"facts":null,"createdAt":null,"error":null,"errorKind":null}\n';
    }
    const symbolPatterns = fakeSymbolPatterns();
    (symbolPatterns.generateStream as ReturnType<typeof vi.fn>).mockReturnValue(lines());
    const controller = new LlmController(
      {} as LlmService,
      fakeSummaries(),
      fakeTradeIdeas(),
      fakeTradeIdeaHistory(),
      fakeTradeReviews(),
      symbolPatterns,
    );
    const res = { setHeader: vi.fn(), write: vi.fn(), end: vi.fn() };

    await controller.generateSymbolPatternStream('nvda', '1M', res as never);

    expect(symbolPatterns.generateStream).toHaveBeenCalledWith('nvda', '1M');
  });

  it('GET /ai/summaries delegates to AiSummaryService.list', async () => {
    const rows = [{ id: '1', createdAt: 'x', factsAsOf: 'y', preview: 'z' }];
    const summaries = fakeSummaries();
    (summaries.list as ReturnType<typeof vi.fn>).mockResolvedValue(rows);
    const controller = new LlmController(
      {} as LlmService,
      summaries,
      fakeTradeIdeas(),
      fakeTradeIdeaHistory(),
      fakeTradeReviews(),
      fakeSymbolPatterns(),
    );

    const result = await controller.list();

    expect(result).toBe(rows);
    expect(summaries.list).toHaveBeenCalledTimes(1);
  });

  it('GET /ai/summaries/:id delegates to AiSummaryService.findOne', async () => {
    const detail = { id: '1', summary: 's' };
    const summaries = fakeSummaries();
    (summaries.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(detail);
    const controller = new LlmController(
      {} as LlmService,
      summaries,
      fakeTradeIdeas(),
      fakeTradeIdeaHistory(),
      fakeTradeReviews(),
      fakeSymbolPatterns(),
    );

    const result = await controller.findOne('1');

    expect(result).toBe(detail);
    expect(summaries.findOne).toHaveBeenCalledWith('1');
  });

  it('DELETE /ai/summaries/:id delegates to AiSummaryService.remove', async () => {
    const summaries = fakeSummaries();
    (summaries.remove as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const controller = new LlmController(
      {} as LlmService,
      summaries,
      fakeTradeIdeas(),
      fakeTradeIdeaHistory(),
      fakeTradeReviews(),
      fakeSymbolPatterns(),
    );

    const result = await controller.remove('1');

    expect(result).toEqual({ ok: true });
    expect(summaries.remove).toHaveBeenCalledWith('1');
  });
});
