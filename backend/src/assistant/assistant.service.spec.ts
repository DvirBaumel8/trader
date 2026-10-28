import { describe, expect, it, vi } from 'vitest';
import { AssistantService } from './assistant.service.js';

describe('AssistantService.maCheck', () => {
  it("says it couldn't get a price when the provider has none", async () => {
    const service = new AssistantService(
      {} as never,
      {} as never,
      { findOrCreate: vi.fn(async () => ({ id: 'i1', symbol: 'GOOGL' })) } as never,
      { getQuote: vi.fn(async () => null) } as never,
      { ensurePriced: vi.fn(), ensureFresh: vi.fn() } as never,
      { find: vi.fn() } as never,
    );
    expect(await service.handle('is GOOGL above 150 SMA')).toEqual({
      kind: 'error',
      message: "Couldn't get GOOGL's price right now.",
    });
  });
});
