import { describe, expect, it, vi } from 'vitest';
import { TickerFactsService } from './ticker-facts.service.js';
import type { YahooClient } from './yahoo.client.js';
import type { FundamentalsService } from './fundamentals.service.js';

function bars() {
  return Array.from({ length: 60 }, (_, i) => ({
    date: `2026-0${i < 30 ? 7 : 8}-${String((i % 28) + 1).padStart(2, '0')}`,
    close: 300 + i,
    adjClose: 300 + i,
    open: 300 + i,
    high: 301 + i,
    low: 299 + i,
    volume: 1_000_000,
  }));
}

function serviceWith(peRatio: number | null, fundamentalsPe: number | null) {
  const yahoo = {
    quote: async () => ({
      symbol: 'APP',
      name: 'Applovin Corporation',
      price: 320,
      currency: 'USD',
      session: 'CLOSED' as const,
      extended: false,
      regularPrice: 320,
      peRatio,
    }),
    dailyBars: async () => bars(),
  } as unknown as YahooClient;

  const peFromFundamentals = vi.fn(async () => fundamentalsPe);
  const fundamentals = {
    peRatio: peFromFundamentals,
  } as unknown as FundamentalsService;

  return {
    service: new TickerFactsService(yahoo, fundamentals),
    peFromFundamentals,
  };
}

describe('P/E when the quote provider cannot supply one', () => {
  it('falls back to the fundamentals provider', async () => {
    // In production Yahoo's crumb-gated quote endpoint is blocked, so the
    // price arrives from its chart endpoint with no P/E attached.
    const { service } = serviceWith(null, 38.1);

    expect((await service.get('APP')).peRatio).toBe(38.1);
  });

  it('prefers the quote provider when it has one, and asks for nothing else', async () => {
    // Locally the real quote works and already carries a trailing P/E; a
    // second provider call there would be waste.
    const { service, peFromFundamentals } = serviceWith(37.4, 99);

    expect((await service.get('APP')).peRatio).toBe(37.4);
    expect(peFromFundamentals).not.toHaveBeenCalled();
  });

  it('stays null when neither provider has one', async () => {
    const { service } = serviceWith(null, null);

    expect((await service.get('APP')).peRatio).toBeNull();
  });
});
