import { describe, expect, it, vi } from 'vitest';
import { LlmController } from './llm.controller.js';
import type { LlmService } from './llm.service.js';
import type { AiSummaryService } from './ai-summary.service.js';

function fakeSummaries(): AiSummaryService {
  return {
    list: vi.fn(),
    findOne: vi.fn(),
    remove: vi.fn(),
    create: vi.fn(),
  } as unknown as AiSummaryService;
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
    const controller = new LlmController(llm, fakeSummaries());

    const result = await controller.portfolioSummary();

    expect(result).toBe(unconfigured);
    expect(llm.portfolioSummary).toHaveBeenCalledTimes(1);
  });

  it('GET /ai/summaries delegates to AiSummaryService.list', async () => {
    const rows = [{ id: '1', createdAt: 'x', factsAsOf: 'y', preview: 'z' }];
    const summaries = fakeSummaries();
    (summaries.list as ReturnType<typeof vi.fn>).mockResolvedValue(rows);
    const controller = new LlmController({} as LlmService, summaries);

    const result = await controller.list();

    expect(result).toBe(rows);
    expect(summaries.list).toHaveBeenCalledTimes(1);
  });

  it('GET /ai/summaries/:id delegates to AiSummaryService.findOne', async () => {
    const detail = { id: '1', summary: 's' };
    const summaries = fakeSummaries();
    (summaries.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(detail);
    const controller = new LlmController({} as LlmService, summaries);

    const result = await controller.findOne('1');

    expect(result).toBe(detail);
    expect(summaries.findOne).toHaveBeenCalledWith('1');
  });

  it('DELETE /ai/summaries/:id delegates to AiSummaryService.remove', async () => {
    const summaries = fakeSummaries();
    (summaries.remove as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const controller = new LlmController({} as LlmService, summaries);

    const result = await controller.remove('1');

    expect(result).toEqual({ ok: true });
    expect(summaries.remove).toHaveBeenCalledWith('1');
  });
});
