import { describe, expect, it, vi } from 'vitest';
import { LlmController } from './llm.controller.js';
import type { LlmService } from './llm.service.js';

describe('LlmController', () => {
  it('POST /ai/portfolio-summary returns whatever the service produces, unconfigured included', async () => {
    const unconfigured = {
      configured: false,
      summary: null,
      factsAsOf: null,
      error: null,
    };
    const service = {
      portfolioSummary: vi.fn().mockResolvedValue(unconfigured),
    } as unknown as LlmService;
    const controller = new LlmController(service);

    const result = await controller.portfolioSummary();

    expect(result).toBe(unconfigured);
    expect(service.portfolioSummary).toHaveBeenCalledTimes(1);
  });
});
