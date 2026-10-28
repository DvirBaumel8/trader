import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AssistantService } from './assistant.service.js';

describe('AssistantService.maCheck', () => {
  it("says it couldn't get a price when the provider has none", async () => {
    const service = new AssistantService(
      {} as never,
      {} as never,
      { findOrCreate: vi.fn(async () => ({ id: 'i1', symbol: 'GOOGL' })) } as never,
      { getQuote: vi.fn(async () => null) } as never,
      { ensureDepth: vi.fn(async () => 'ok'), ensureFresh: vi.fn() } as never,
      { find: vi.fn() } as never,
    );
    expect(await service.handle('is GOOGL above 150 SMA')).toEqual({
      kind: 'error',
      message: "Couldn't get GOOGL's price right now.",
    });
  });

  it("says history couldn't be fetched when the top-up failed and the stored history is short", async () => {
    const service = new AssistantService(
      {} as never,
      {} as never,
      { findOrCreate: vi.fn(async () => ({ id: 'i1', symbol: 'AAPL' })) } as never,
      { getQuote: vi.fn(async () => ({ price: 200, stale: false, session: 'REGULAR' })) } as never,
      { ensureDepth: vi.fn(async () => 'failed'), ensureFresh: vi.fn() } as never,
      { find: vi.fn(async () => [{ close: 1 }, { close: 2 }]) } as never,
    );
    expect(await service.handle('is AAPL above 50 SMA')).toEqual({
      kind: 'error',
      message: "Couldn't get AAPL's price history right now.",
    });
  });

  it('turns a full watchlist into a chat error and lets other errors propagate', async () => {
    const msg = 'The watchlist holds 50 tickers at most. Remove one before adding another.';
    const make = (err: Error) =>
      new AssistantService(
        {} as never,
        { add: vi.fn(async () => { throw err; }) } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );
    expect(await make(new BadRequestException(msg)).handle('watch NVDA')).toEqual({
      kind: 'error',
      message: msg,
    });
    await expect(make(new Error('boom')).handle('watch NVDA')).rejects.toThrow('boom');
  });
});
