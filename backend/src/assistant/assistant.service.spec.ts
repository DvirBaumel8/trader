import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AssistantService, FALLBACK_NOTE, RATE_LIMIT_MESSAGE } from './assistant.service.js';
import { LlmRateLimitError } from '../llm/llm.client.js';

function make(llm: { isConfigured?: () => boolean; generateJson: (...a: unknown[]) => Promise<unknown> }, over: Record<string, unknown> = {}) {
  const holdings = { has: vi.fn(async () => false), add: vi.fn(async (s: string) => ({ added: true, symbol: s })), remove: vi.fn(async () => true), list: vi.fn(async () => []) , ...(over.holdings as object) };
  const watchlist = { add: vi.fn(async (s: string) => ({ added: true, symbol: s })), remove: vi.fn(async () => true), list: vi.fn(async () => []), ...(over.watchlist as object) };
  const instruments = { findOrCreate: vi.fn(async (s: string) => { if (s.startsWith('ZZZZ')) throw new NotFoundException(); return { id: s, symbol: s }; }) };
  const service = new AssistantService(holdings as never, watchlist as never, instruments as never, { isConfigured: () => true, ...llm } as never);
  return { service, holdings, watchlist };
}

describe('AssistantService', () => {
  it('buy: adds new, reports already held and unknown', async () => {
    const { service, holdings } = make(
      { generateJson: async () => ({ action: 'buy', symbols: ['LMND', 'NVDA', 'ZZZZ', 'Lemonade'] }) },
      { holdings: { has: vi.fn(async (s: string) => s === 'NVDA') } },
    );
    expect(await service.handle('Bought: LMND NVDA ZZZZ Lemonade')).toEqual({
      kind: 'done',
      message: 'Added: LMND\nAlready held: NVDA\nCouldn\'t find: ZZZZ, LEMONADE',
    });
    expect(holdings.add).toHaveBeenCalledTimes(1);
  });

  it('an unexpected error mid-batch becomes an error reply, not a 500', async () => {
    const { service } = make(
      { generateJson: async () => ({ action: 'buy', symbols: ['NVDA'] }) },
      { holdings: { add: vi.fn(async () => { throw new Error('db down'); }) } },
    );
    expect(await service.handle('bought NVDA')).toEqual({
      kind: 'error',
      message: 'Something went wrong partway through — check Holdings and Watchlist before resending.',
    });
  });

  it('sell: removes and watches; not held is reported and not watched', async () => {
    const { service, watchlist } = make(
      { generateJson: async () => ({ action: 'sell', symbols: ['LMND', 'TSLA'] }) },
      { holdings: { remove: vi.fn(async (s: string) => s === 'LMND') } },
    );
    expect(await service.handle('sold LMND and TSLA')).toEqual({
      kind: 'done',
      message: 'Sold and moved to watchlist: LMND\nNot held: TSLA',
    });
    expect(watchlist.add).toHaveBeenCalledWith('LMND');
    expect(watchlist.add).not.toHaveBeenCalledWith('TSLA');
  });

  it('sell with a full watchlist still sells and says so', async () => {
    const { service } = make(
      { generateJson: async () => ({ action: 'sell', symbols: ['LMND'] }) },
      { watchlist: { add: vi.fn(async () => { throw new BadRequestException('full'); }) } },
    );
    expect(await service.handle('sold LMND')).toEqual({ kind: 'done', message: 'Sold (watchlist full, not added): LMND' });
  });

  it('watch: added, already, full and unknown in one batch', async () => {
    const add = vi.fn(async (s: string) => {
      if (s === 'AMD') return { added: false, symbol: s };
      if (s === 'SMCI') throw new BadRequestException('full');
      if (s === 'ZZZZ') throw new NotFoundException();
      return { added: true, symbol: s };
    });
    const { service } = make({ generateJson: async () => ({ action: 'watch', symbols: ['NVDA', 'AMD', 'SMCI', 'ZZZZ'] }) }, { watchlist: { add } });
    expect(await service.handle('watch NVDA AMD SMCI ZZZZ')).toEqual({
      kind: 'done',
      message: "Watching: NVDA\nAlready watching: AMD\nWatchlist full, not added: SMCI\nCouldn't find: ZZZZ",
    });
  });

  it('unwatch: stopped and not on watchlist', async () => {
    const { service } = make(
      { generateJson: async () => ({ action: 'unwatch', symbols: ['NVDA', 'AMD'] }) },
      { watchlist: { remove: vi.fn(async (s: string) => s === 'NVDA') } },
    );
    expect(await service.handle('unwatch NVDA, AMD')).toEqual({ kind: 'done', message: 'Stopped watching: NVDA\nNot on watchlist: AMD' });
  });

  it('none → prompt without a note', async () => {
    const { service } = make({ generateJson: async () => ({ action: 'none', symbols: [] }) });
    const reply = await service.handle('what about semis', new Date('2026-10-28T12:00:00Z'));
    expect(reply).toMatchObject({ kind: 'prompt' });
    expect(reply).not.toHaveProperty('note');
  });

  it('prompt: New York date and symbol-only holdings', async () => {
    const { service } = make(
      { generateJson: async () => ({ action: 'none', symbols: [] }) },
      { holdings: { list: vi.fn(async () => [{ symbol: 'AMZN', name: null }, { symbol: 'TSLA', name: null }]) } },
    );
    const reply = await service.handle('what about semis', new Date('2026-10-29T00:30:00Z'));
    expect(reply).toMatchObject({ kind: 'prompt' });
    const text = (reply as { text: string }).text;
    expect(text).toContain('Date: Oct 28, 2026 (New York time)');
    expect(text).toContain('My holdings: AMZN, TSLA');
  });

  it('a question never acts even if the model says buy', async () => {
    const { service, holdings } = make({ generateJson: async () => ({ action: 'buy', symbols: ['NVDA'] }) });
    expect((await service.handle('should I buy NVDA?')).kind).toBe('prompt');
    expect(holdings.add).not.toHaveBeenCalled();
  });

  it('model failure → prompt with the fallback note, no writes', async () => {
    const { service, holdings } = make({ generateJson: async () => { throw new Error('429'); } });
    const reply = await service.handle('bought LMND');
    expect(reply).toMatchObject({ kind: 'prompt', note: FALLBACK_NOTE });
    expect(holdings.add).not.toHaveBeenCalled();
  });

  it('rate limit → clear error reply, no prompt, no writes', async () => {
    const { service, holdings } = make({ generateJson: async () => { throw new LlmRateLimitError('429'); } });
    expect(await service.handle('bought LMND')).toEqual({ kind: 'error', message: RATE_LIMIT_MESSAGE });
    expect(holdings.add).not.toHaveBeenCalled();
  });

  it('no API key → prompt with the fallback note, model not called', async () => {
    const generateJson = vi.fn();
    const { service } = make({ isConfigured: () => false, generateJson });
    expect(await service.handle('bought LMND')).toMatchObject({ kind: 'prompt', note: FALLBACK_NOTE });
    expect(generateJson).not.toHaveBeenCalled();
  });

  it('sends only the message and the router instruction to the model', async () => {
    const generateJson = vi.fn(async () => ({ action: 'none', symbols: [] }));
    const { service } = make({ generateJson });
    await service.handle('hello there');
    expect(generateJson).toHaveBeenCalledWith(expect.objectContaining({ user: 'hello there', timeoutMs: 5000 }));
  });
});
